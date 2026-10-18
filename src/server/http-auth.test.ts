import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { findWord, type Puzzle } from "../shared/game.js";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Ingen testport.");
  const port = address.port;
  const closed = once(server, "close");
  server.close();
  await closed;
  return port;
}

async function ready(baseURL: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Testserveren stoppede med kode ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch { /* Serveren starter stadig. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Testserveren blev ikke klar.");
}

describe("HTTP-adgangskontrol", () => {
  it("afviser offentlig oprettelse, fremmede baner og requests uden gyldig origin", async () => {
    const directory = mkdtempSync(join(tmpdir(), "find-ord-http-"));
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const previous = { DATA_FILE: process.env.DATA_FILE, BASE_URL: process.env.BASE_URL };
    process.env.DATA_FILE = join(directory, "test.sqlite");
    process.env.BASE_URL = baseURL;
    let child: ChildProcess | undefined;
    try {
      const [{ auth }, { db, migrateGameData }, { getMigrations }] = await Promise.all([
        import("./auth.js"), import("./database.js"), import("better-auth/db/migration")
      ]);
      await (await getMigrations(auth.options)).runMigrations();
      migrateGameData(db);
      const ids: Record<string, string> = {};
      for (const username of ["alice", "bob", "root", "kid"]) {
        const result = await auth.api.signUpEmail({ body: {
          email: `${username}@users.find-ord.invalid`, name: username, username, password: "test-password-123"
        } });
        expect(result.user).toBeDefined();
        ids[username] = result.user!.id;
        db.prepare("INSERT INTO profile (user_id, child) VALUES (?, ?)").run(result.user!.id, username === "kid" ? 1 : 0);
      }
      db.prepare("UPDATE user SET role = 'admin' WHERE id = ?").run(ids.root);
      db.close();

      child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port), DATA_FILE: join(directory, "test.sqlite"), BASE_URL: baseURL, GAME_CREATION_LIMIT: "2" },
        stdio: "ignore"
      });
      await ready(baseURL, child);
      expect((await fetch(`${baseURL}/api/me`)).status).toBe(401);
      expect((await fetch(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "extra@example.invalid", name: "extra", password: "test-password-123" })
      })).status).toBe(403);

      async function login(username: string): Promise<string> {
        const response = await fetch(`${baseURL}/api/auth/sign-in/username`, {
          method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: "test-password-123" })
        });
        expect(response.status).toBe(200);
        const cookie = response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
        expect(cookie).toContain("session_token");
        return cookie;
      }
      const alice = await login("alice");
      const bob = await login("bob");
      const create = await fetch(`${baseURL}/api/games`, {
        method: "POST", headers: { Origin: baseURL, Cookie: alice, "Content-Type": "application/json" },
        body: JSON.stringify({ category: "dyr", level: "let" })
      });
      expect(create.status).toBe(201);
      const created = await create.json() as { puzzle: { id: string } };
      expect((await fetch(`${baseURL}/api/games/${created.puzzle.id}`, { headers: { Cookie: alice } })).status).toBe(200);
      const listed = async (cookie: string) => (await (await fetch(`${baseURL}/api/games`, { headers: { Cookie: cookie } })).json() as Array<{ puzzle: { id: string } }>).map((game) => game.puzzle.id);
      expect(await listed(alice)).toEqual([created.puzzle.id]);
      expect(await listed(bob)).toEqual([]);
      expect((await fetch(`${baseURL}/api/games/${created.puzzle.id}`, { headers: { Cookie: bob } })).status).toBe(404);
      expect((await fetch(`${baseURL}/api/games/${created.puzzle.id}/sync`, {
        method: "POST", headers: { Origin: baseURL, Cookie: bob, "Content-Type": "application/json" },
        body: JSON.stringify({ events: [] })
      })).status).toBe(404);
      // A game retired by a version change is not delivered again, but its owner's
      // offline moves are still accepted so progress is not lost.
      const stored = new Database(join(directory, "test.sqlite"));
      const puzzle = JSON.parse((stored.prepare("SELECT puzzle FROM game WHERE id = ?").get(created.puzzle.id) as { puzzle: string }).puzzle) as Puzzle;
      stored.prepare("UPDATE game SET puzzle = ? WHERE id = ?").run(JSON.stringify({ ...puzzle, wordListVersion: 0 }), puzzle.id);
      stored.close();
      expect((await fetch(`${baseURL}/api/games/${puzzle.id}`, { headers: { Cookie: alice } })).status).toBe(410);
      const word = puzzle.words[0];
      const retiredSync = await fetch(`${baseURL}/api/games/${puzzle.id}/sync`, {
        method: "POST", headers: { Origin: baseURL, Cookie: alice, "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ id: "00000000-0000-4000-8000-000000000001", kind: "find", word, ...findWord(puzzle, word) }] })
      });
      expect(retiredSync.status).toBe(200);
      expect((await retiredSync.json() as { found: string[] }).found).toEqual([word]);
      expect((await fetch(`${baseURL}/api/games/${puzzle.id}/sync`, {
        method: "POST", headers: { Origin: baseURL, Cookie: bob, "Content-Type": "application/json" },
        body: JSON.stringify({ events: [] })
      })).status).toBe(404);
      // GAME_CREATION_LIMIT=2: alice already created one game.
      const createAgain = () => fetch(`${baseURL}/api/games`, {
        method: "POST", headers: { Origin: baseURL, Cookie: alice, "Content-Type": "application/json" },
        body: JSON.stringify({ category: "dyr", level: "let" })
      });
      expect((await createAgain()).status).toBe(201);
      expect((await createAgain()).status).toBe(429);
      expect((await fetch(`${baseURL}/api/games`, {
        method: "POST", headers: { Origin: "http://untrusted.invalid", Cookie: alice, "Content-Type": "application/json" },
        body: JSON.stringify({ category: "dyr", level: "let" })
      })).status).toBe(403);
      expect((await fetch(`${baseURL}/api/accounts`, { headers: { Cookie: alice } })).status).toBe(403);

      // Account rules on Better Auth's admin routes.
      const root = await login("root");
      const adminCall = (path: string, body: object) => fetch(`${baseURL}/api/auth/admin/${path}`, {
        method: "POST", headers: { Origin: baseURL, Cookie: root, "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      expect((await adminCall("set-role", { userId: ids.kid, role: "admin" })).status).toBe(403);
      expect((await adminCall("update-user", { userId: ids.kid, data: { role: "admin" } })).status).toBe(403);
      expect((await adminCall("set-role", { userId: ids.root, role: "user" })).status).toBe(403);
      expect((await adminCall("remove-user", { userId: ids.root })).status).toBe(403);
      expect((await adminCall("ban-user", { userId: ids.root })).status).toBe(403);
      expect((await adminCall("create-user", { email: "x@users.find-ord.invalid", name: "x", password: "test-password-123" })).status).toBe(403);
      const duplicate = await fetch(`${baseURL}/api/accounts`, {
        method: "POST", headers: { Origin: baseURL, Cookie: root, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Bob", name: "Bob", password: "test-password-123", child: false })
      });
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json() as { error: string }).error).toBe("Brugernavnet er allerede i brug.");
      expect((await adminCall("set-role", { userId: ids.bob, role: "admin" })).status).toBe(200);
      expect((await adminCall("set-role", { userId: ids.root, role: "user" })).status).toBe(200);
    } finally {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      if (previous.DATA_FILE === undefined) delete process.env.DATA_FILE;
      else process.env.DATA_FILE = previous.DATA_FILE;
      if (previous.BASE_URL === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = previous.BASE_URL;
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
});
