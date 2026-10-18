// Measures response times with several simultaneous players. It creates accounts, so run
// it against a separate test instance, never against the live data:
//   LOAD_BASE_URL=http://host:3999 LOAD_ADMIN_USER=admin LOAD_ADMIN_PASSWORD=... npm run test:load
import { findWord, type Puzzle } from "../src/shared/game.js";

const base = process.env.LOAD_BASE_URL;
const admin = { username: process.env.LOAD_ADMIN_USER, password: process.env.LOAD_ADMIN_PASSWORD };
const players = Number(process.env.LOAD_PLAYERS || 5);
const rounds = Number(process.env.LOAD_ROUNDS || 4);
if (!base || !admin.username || !admin.password) throw new Error("Sæt LOAD_BASE_URL, LOAD_ADMIN_USER og LOAD_ADMIN_PASSWORD.");

const timings: Record<string, number[]> = {};
async function call(name: string, path: string, cookie: string | null, init: RequestInit = {}) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { ...init, headers: { Origin: base!, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...init.headers } });
  (timings[name] ??= []).push(performance.now() - started);
  if (!response.ok) throw new Error(`${name}: ${response.status} ${await response.text()}`);
  return response;
}
// Logins come from one address here, so they wait for the per-address login limit and
// are not part of the timed results.
async function login(username: string, password: string): Promise<string> {
  for (;;) {
    const response = await fetch(`${base}/api/auth/sign-in/username`, { method: "POST", headers: { Origin: base!, "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (response.ok) return response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
    if (response.status !== 429) throw new Error(`login: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

const adminCookie = await login(admin.username, admin.password);
const run = Date.now().toString(36);
const accounts = await Promise.all(Array.from({ length: players }, async (_, index) => {
  const username = `last${run}${index}`;
  await call("opret konto", "/api/accounts", adminCookie, { method: "POST", body: JSON.stringify({ username, name: `Last ${index}`, password: "load-test-password", child: index % 2 === 1 }) });
  return username;
}));

const cookies: string[] = [];
for (const username of accounts) cookies.push(await login(username, "load-test-password"));

const started = performance.now();
await Promise.all(accounts.map(async (_, index) => {
  const cookie = cookies[index];
  for (let round = 0; round < rounds; round++) {
    const level = (["let", "normal", "svaer", "ekspert"] as const)[(round + index) % 4];
    const created = await call("ny bane", "/api/games", cookie, { method: "POST", body: JSON.stringify({ category: "dyr", level }) });
    const { puzzle } = await created.json() as { puzzle: Puzzle };
    // One request per found word, like a player marking words one at a time.
    for (const word of puzzle.words) {
      const event = { id: crypto.randomUUID(), kind: "find", word, ...findWord(puzzle, word)! };
      await call("ordfund (sync)", `/api/games/${puzzle.id}/sync`, cookie, { method: "POST", body: JSON.stringify({ events: [event] }) });
    }
    await call("ordfund (sync)", `/api/games/${puzzle.id}/sync`, cookie, { method: "POST", body: JSON.stringify({ events: [{ id: crypto.randomUUID(), kind: "complete" }] }) });
    await call("achievements", "/api/achievements", cookie);
    await call("mål", "/api/challenges", cookie);
  }
}));

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
console.log(`${players} samtidige spillere, ${rounds} baner hver, ${Math.round((performance.now() - started) / 1000)} s i alt.`);
console.log("| Handling | Antal | p50 ms | p95 ms | Maks ms |\n|---|---|---|---|---|");
for (const [name, values] of Object.entries(timings)) {
  console.log(`| ${name} | ${values.length} | ${Math.round(percentile(values, 0.5))} | ${Math.round(percentile(values, 0.95))} | ${Math.round(Math.max(...values))} |`);
}
