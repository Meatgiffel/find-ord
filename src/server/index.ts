import express, { type Request, type Response } from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { getMigrations } from "better-auth/db/migration";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { auth, authForHost, baseURL, CLIENT_IP_HEADER, lanAuth, trustedOrigins } from "./auth.js";
import { dataFile, db, migrateGameData } from "./database.js";
import { finishSetup, prepareSetupToken, setupNeeded, setupTokenMatches } from "./setup.js";
import { importBundledCor } from "./lexicon.js";
import { achievementsForUser, statsForUser } from "./achievements.js";
import { campaignNeeds, campaignsForUser, refillCampaign, startCampaign } from "./campaigns.js";
import { PuzzleSupply, SupplyBusyError, workerGenerator } from "./supply.js";
import { applyGameEvents, loadGameForUser, type GameRow } from "./game-sync.js";
import { AVATARS, CATEGORIES, CATEGORY_TAG_VERSION, WORD_LIST_VERSION, availableLevels, campaignLevels, type CategoryId, type LevelId } from "../shared/words.js";
import type { Move, Puzzle } from "../shared/game.js";
import { VALIDATION_VERSION, validatePuzzle } from "../shared/validation.js";
import { CHILD_POLICY_VERSION } from "../shared/safety.js";

await (await getMigrations(auth.options)).runMigrations();
migrateGameData(db);
const corpus = await importBundledCor(db);
// LOG_LEVEL=error keeps only failures; the default "info" also logs startup and shutdown.
const logInfo = process.env.LOG_LEVEL === "error" ? () => {} : (text: string) => console.log(text);
logInfo(`COR ${corpus.imported} ordformer indlæst.`);
// Puzzles are generated in a worker thread and a few are kept ready per combination.
const supply = new PuzzleSupply(db, workerGenerator(Number(process.env.GENERATION_TIMEOUT_MS || 5000)), {
  queueLimit: Number(process.env.GENERATION_QUEUE_LIMIT || 8), maxCached: Number(process.env.PUZZLE_CACHE_LIMIT || 300)
});
const pruned = supply.prune();
if (pruned) logInfo(`${pruned} cachede baner fra en ældre ordliste eller politik er fjernet.`);
const setupToken = prepareSetupToken(db, dataFile);
if (setupToken) console.log(`Ingen konti endnu. Opret første administrator på ${baseURL}/?opsaetning=${setupToken}`);

// Each new game or campaign refill generates puzzles on this process. Limit how many
// one account can request, so a single client cannot keep the server busy.
const creationLimit = Number(process.env.GAME_CREATION_LIMIT || 60);
const creationWindowMs = 10 * 60 * 1000;
const creations = new Map<string, number[]>();
function creationAllowed(userId: string): boolean {
  const now = Date.now();
  const recent = (creations.get(userId) ?? []).filter((time) => now - time < creationWindowMs);
  if (recent.length >= creationLimit) { creations.set(userId, recent); return false; }
  recent.push(now);
  creations.set(userId, recent);
  return true;
}
const CREATION_LIMITED = "Du har hentet mange nye baner på kort tid. Vent lidt, og prøv igen.";

type SessionUser = { id: string; name: string; role?: string | null; username?: string | null };
const app = express();
app.disable("x-powered-by");
// TRUST_PROXY names the reverse proxy allowed to report the client address (Express
// "trust proxy" syntax, e.g. "loopback" or "192.168.50.0/24"). Without it the socket
// address is used. Either way the value replaces any header a client sends itself.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
app.use((req, _res, next) => {
  req.headers[CLIENT_IP_HEADER] = req.ip ?? req.socket.remoteAddress ?? "unknown";
  next();
});

function error(res: Response, status: number, message: string): void { res.status(status).json({ error: message }); }
function originAllowed(req: Request): boolean {
  const origin = req.get("origin");
  return Boolean(origin && trustedOrigins.includes(origin));
}
async function user(req: Request, res: Response): Promise<SessionUser | null> {
  const session = await authForHost(req.get("host")).api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user) { error(res, 401, "Log ind for at fortsætte."); return null; }
  return session.user as SessionUser;
}
function childFor(userId: string): boolean {
  return Boolean((db.prepare("SELECT child FROM profile WHERE user_id = ?").get(userId) as { child: number } | undefined)?.child);
}
function serializedGame(row: GameRow) {
  return { puzzle: JSON.parse(row.puzzle) as Puzzle, found: JSON.parse(row.found) as string[], hints: JSON.parse(row.hints) as string[], completed: Boolean(row.completed), abandoned: Boolean(row.abandoned), revision: row.revision };
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));
// Account creation goes through the admin API. Better Auth's public sign-up endpoint is closed.
app.use("/api/auth/sign-up", (_req, res) => error(res, 403, "En administrator opretter brugerkonti."));
const authHandler = toNodeHandler(auth);
const lanAuthHandler = lanAuth ? toNodeHandler(lanAuth) : null;
app.all("/api/auth/*", (req, res) => {
  if (lanAuthHandler && authForHost(req.get("host")) === lanAuth) return lanAuthHandler(req, res);
  return authHandler(req, res);
});
app.use(express.json({ limit: "128kb" }));
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD" && !originAllowed(req)) return error(res, 403, "Ugyldig afsender.");
  next();
});

app.get("/api/me", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  const avatar = (db.prepare("SELECT avatar FROM profile WHERE user_id = ?").get(current.id) as { avatar: string | null } | undefined)?.avatar ?? null;
  res.json({ id: current.id, name: current.name, username: current.username, role: current.role, child: childFor(current.id), avatar,
    puzzleVersions: { rules: 1, validation: VALIDATION_VERSION, words: WORD_LIST_VERSION,
      categories: CATEGORY_TAG_VERSION, childPolicy: CHILD_POLICY_VERSION } });
});

app.get("/api/categories", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  const child = childFor(current.id);
  res.json(Object.entries(CATEGORIES).map(([id, category]) => ({ id, name: category.name, levels: availableLevels(id as CategoryId, child) })));
});

app.get("/api/achievements", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  res.json(achievementsForUser(db, current.id));
});

app.get("/api/stats", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  res.json(statsForUser(db, current.id));
});

const campaignSchema = z.object({ level: z.enum(["let", "normal", "svaer", "ekspert"]) });
app.get("/api/campaigns", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  res.json(campaignsForUser(db, current.id, childFor(current.id)));
});
app.post("/api/campaigns", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Vælg en gyldig sværhedsgrad.");
  if (!campaignLevels(childFor(current.id)).includes(parsed.data.level)) return error(res, 400, "Dette niveau er endnu ikke tilgængeligt i kampagner.");
  if (!creationAllowed(current.id)) return error(res, 429, CREATION_LIMITED);
  const child = childFor(current.id);
  try {
    const existing = db.prepare("SELECT id FROM campaign WHERE user_id = ? AND level = ?").get(current.id, parsed.data.level) as { id: string } | undefined;
    const needs = campaignNeeds(db, existing?.id ?? null, current.id, parsed.data.level, child);
    await supply.prepare(needs.categories, parsed.data.level, child, needs.count);
    res.json(startCampaign(db, current.id, parsed.data.level, child, (category, level, kid) => supply.takeCached(category, level, kid)));
  } catch (cause) { generationError(res, cause, "Kampagnen kunne ikke oprettes. Prøv igen."); }
});
app.post("/api/campaigns/:id/refill", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  if (!creationAllowed(current.id)) return error(res, 429, CREATION_LIMITED);
  const child = childFor(current.id);
  const campaign = db.prepare("SELECT level FROM campaign WHERE id = ? AND user_id = ?").get(req.params.id, current.id) as { level: LevelId } | undefined;
  if (!campaign) return error(res, 404, "Kampagnen blev ikke fundet.");
  try {
    const needs = campaignNeeds(db, req.params.id, current.id, campaign.level, child);
    await supply.prepare(needs.categories, campaign.level, child, needs.count);
    const result = refillCampaign(db, req.params.id, current.id, child, (category, level, kid) => supply.takeCached(category, level, kid));
    if (!result) return error(res, 404, "Kampagnen blev ikke fundet.");
    res.json(result);
  } catch (cause) { generationError(res, cause, "Nye kampagnebaner kunne ikke hentes. Prøv igen."); }
});

// A full queue or a generation timeout is reported with Retry-After, so the client can explain it.
function generationError(res: Response, cause: unknown, fallback: string) {
  if (cause instanceof SupplyBusyError) { res.setHeader("Retry-After", "5"); return error(res, 503, cause.message); }
  console.error("Banegenerering fejlede:", cause instanceof Error ? cause.message : cause);
  res.setHeader("Retry-After", "2");
  error(res, 503, fallback);
}

const newGameSchema = z.object({
  category: z.enum(Object.keys(CATEGORIES) as [CategoryId, ...CategoryId[]]), level: z.enum(["let", "normal", "svaer", "ekspert"]),
  requestId: z.string().uuid().optional()
});
app.post("/api/games", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  const input = newGameSchema.safeParse(req.body);
  if (!input.success) return error(res, 400, "Vælg en gyldig kategori og sværhedsgrad.");
  const { category, level, requestId } = input.data;
  // The same request ID with the same choices returns the game it created; other choices are refused.
  const params = JSON.stringify({ category, level });
  const repeated = () => requestId ? db.prepare("SELECT params, game_id FROM game_request WHERE user_id = ? AND request_id = ?").get(current.id, requestId) as { params: string; game_id: string } | undefined : undefined;
  const earlier = repeated();
  if (earlier) {
    if (earlier.params !== params) return error(res, 409, "Forespørgslen er allerede brugt til en anden bane.");
    const game = loadGameForUser(db, earlier.game_id, current.id);
    return game ? res.json(serializedGame(game)) : error(res, 410, "Banen fra forespørgslen findes ikke længere.");
  }
  const child = childFor(current.id);
  if (!availableLevels(category, child).includes(level as LevelId)) return error(res, 400, "Dette niveau er endnu ikke tilgængeligt i kategorien.");
  if (!creationAllowed(current.id)) return error(res, 429, CREATION_LIMITED);
  let puzzle: Puzzle;
  try { puzzle = await supply.take(category, level, child); }
  catch (cause) { return generationError(res, cause, "Banen kunne ikke dannes. Prøv igen."); }
  const stored = db.transaction(() => {
    // A parallel request with the same ID may have finished while this one waited.
    const raced = repeated();
    if (raced) return raced.params === params ? raced.game_id : null;
    db.prepare("INSERT INTO game (id, user_id, category, level, puzzle) VALUES (?, ?, ?, ?, ?)")
      .run(puzzle.id, current.id, category, level, JSON.stringify(puzzle));
    if (requestId) db.prepare("INSERT INTO game_request (user_id, request_id, params, game_id) VALUES (?, ?, ?, ?)").run(current.id, requestId, params, puzzle.id);
    return puzzle.id;
  })();
  if (stored === null) return error(res, 409, "Forespørgslen er allerede brugt til en anden bane.");
  if (stored !== puzzle.id) { const game = loadGameForUser(db, stored, current.id); return game ? res.json(serializedGame(game)) : error(res, 410, "Banen fra forespørgslen findes ikke længere."); }
  res.status(201).json({ puzzle, found: [], hints: [], completed: false, abandoned: false, revision: 0 });
});

app.get("/api/games", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  // Unfinished single games, so another device or a new login can continue them.
  // Campaign games are delivered through /api/campaigns.
  const rows = db.prepare(`SELECT * FROM game WHERE user_id = ? AND completed = 0 AND abandoned = 0
    AND id NOT IN (SELECT game_id FROM campaign_game) ORDER BY created_at DESC LIMIT 30`).all(current.id) as GameRow[];
  const games = rows.map(serializedGame);
  const isChild = childFor(current.id);
  res.json(games.filter((game) => game.puzzle.child === isChild && validatePuzzle(game.puzzle) === null));
});

app.get("/api/games/:id", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  const row = loadGameForUser(db, req.params.id, current.id);
  if (!row) return error(res, 404, "Banen blev ikke fundet.");
  const game = serializedGame(row);
  if (game.puzzle.child !== childFor(current.id) || validatePuzzle(game.puzzle)) return error(res, 410, "Banen er udgået efter en ændring i ordlisten, kategorien eller sikkerhedskontrollen.");
  res.json(game);
});

const point = z.object({ row: z.number().int().nonnegative(), col: z.number().int().nonnegative() });
const eventSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["find", "hint", "complete", "abandon"]),
  word: z.string().optional(),
  start: point.optional(),
  end: point.optional()
});
app.post("/api/games/:id/sync", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  const parsed = z.object({ events: z.array(eventSchema).max(500) }).safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Ugyldige spilhændelser.");
  const row = loadGameForUser(db, req.params.id, current.id);
  if (!row) return error(res, 404, "Banen blev ikke fundet.");
  // A game retired by a version or policy change still accepts its owner's moves, so
  // offline progress is not lost. Events are checked against the stored grid and
  // sync returns no puzzle content.
  try {
    res.json(applyGameEvents(db, row, current.id, parsed.data.events as Move[]));
  } catch (cause) {
    return error(res, 409, cause instanceof Error ? cause.message : "Synkronisering mislykkedes.");
  }
});

app.get("/api/setup", (_req, res) => res.json({ needed: setupNeeded(db) }));

// Creates the first administrator once, with the one-time token from the server log.
let setupRunning = false;
const setupSchema = z.object({ token: z.string(), username: z.string().regex(/^[a-zA-Z0-9_.-]{3,30}$/), name: z.string().trim().min(1).max(80), password: z.string().min(8) });
app.post("/api/setup", async (req, res) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Udfyld opsætningskode, brugernavn (3–30 tegn), navn og adgangskode (mindst 8 tegn).");
  if (setupRunning || !setupNeeded(db)) return error(res, 409, "Opsætningen er allerede gennemført. Log ind.");
  if (!setupTokenMatches(dataFile, parsed.data.token)) return error(res, 403, "Opsætningskoden er forkert. Find linket i serverens log.");
  setupRunning = true;
  try {
    const { username, name, password } = parsed.data;
    const created = await auth.api.signUpEmail({ body: { email: `${username.toLowerCase()}@users.find-ord.invalid`, name, password, username } });
    if (!created.user) throw new Error("Administratoren kunne ikke oprettes.");
    try {
      db.transaction(() => {
        db.prepare("UPDATE user SET role = 'admin' WHERE id = ?").run(created.user.id);
        db.prepare("INSERT INTO profile (user_id, child) VALUES (?, 0)").run(created.user.id);
      })();
    } catch (cause) {
      // Never leave a non-admin first account behind; setup stays open for a new attempt.
      db.prepare("DELETE FROM user WHERE id = ?").run(created.user.id);
      throw cause;
    }
    finishSetup(dataFile);
    res.status(201).json({ username: username.toLowerCase() });
  } catch { error(res, 500, "Administratoren kunne ikke oprettes. Prøv igen."); }
  finally { setupRunning = false; }
});

const accountSchema = z.object({ username: z.string().regex(/^[a-zA-Z0-9_.-]{3,30}$/), name: z.string().trim().min(1).max(80), password: z.string().min(8), child: z.boolean() });
app.get("/api/accounts", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  if (current.role !== "admin") return error(res, 403, "Kun administrator kan se konti.");
  const rows = db.prepare(`SELECT u.id, u.name, u.username, u.role, COALESCE(u.banned, 0) AS banned, COALESCE(p.child, 0) AS child,
    p.avatar, COALESCE(p.policy_version, 1) AS policyVersion FROM user u LEFT JOIN profile p ON p.user_id = u.id ORDER BY u.name`).all();
  res.json(rows);
});

const profileSchema = z.object({ name: z.string().trim().min(1).max(80), avatar: z.enum(Object.keys(AVATARS) as [string, ...string[]]).nullable() });
app.patch("/api/profile", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Skriv et navn på 1–80 tegn, og vælg en af de indbyggede avatarer.");
  await authForHost(req.get("host")).api.updateUser({ body: { name: parsed.data.name }, headers: fromNodeHeaders(req.headers) });
  db.prepare("UPDATE profile SET avatar = ? WHERE user_id = ?").run(parsed.data.avatar, current.id);
  res.json({ name: parsed.data.name, avatar: parsed.data.avatar });
});

// Changing the child flag needs the administrator's password and the version the admin
// saw, signs the account out everywhere, and makes its downloaded games stale.
const policySchema = z.object({ child: z.boolean(), adminPassword: z.string().min(1), expectedVersion: z.number().int() });
app.patch("/api/accounts/:id/policy", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  if (current.role !== "admin") return error(res, 403, "Kun administrator kan ændre børneprofiler.");
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Angiv profiltype, din adgangskode og kontoens version.");
  try { await authForHost(req.get("host")).api.verifyPassword({ body: { password: parsed.data.adminPassword }, headers: fromNodeHeaders(req.headers) }); }
  catch { return error(res, 403, "Din adgangskode er forkert."); }
  const target = db.prepare("SELECT u.role, p.child, p.policy_version AS version FROM user u JOIN profile p ON p.user_id = u.id WHERE u.id = ?")
    .get(req.params.id) as { role: string | null; child: number; version: number } | undefined;
  if (!target) return error(res, 404, "Kontoen blev ikke fundet.");
  if (parsed.data.child && target.role?.split(",").includes("admin")) return error(res, 400, "En administrator kan ikke være børnekonto.");
  if (target.version !== parsed.data.expectedVersion) return error(res, 409, "Kontoen er ændret i mellemtiden. Indlæs listen igen.");
  const version = target.version + 1;
  db.transaction(() => {
    db.prepare("UPDATE profile SET child = ?, policy_version = ? WHERE user_id = ?").run(parsed.data.child ? 1 : 0, version, req.params.id);
    db.prepare("DELETE FROM session WHERE userId = ?").run(req.params.id);
  })();
  res.json({ id: req.params.id, child: parsed.data.child, policyVersion: version });
});
app.post("/api/accounts", async (req, res) => {
  const current = await user(req, res); if (!current) return;
  if (current.role !== "admin") return error(res, 403, "Kun administrator kan oprette konti.");
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Udfyld navn, brugernavn og adgangskode (mindst 8 tegn).");
  const { username, name, password, child } = parsed.data;
  // Better Auth stores usernames in lower case, so "Bob" and "bob" are the same account.
  if (db.prepare("SELECT 1 FROM user WHERE username = ?").get(username.toLowerCase())) return error(res, 409, "Brugernavnet er allerede i brug.");
  try {
    const result = await auth.api.signUpEmail({ body: { email: `${username.toLowerCase()}@users.find-ord.invalid`, name, password, username } });
    if (!result.user) throw new Error("Kontoen kunne ikke oprettes.");
    try { db.prepare("INSERT INTO profile (user_id, child) VALUES (?, ?)").run(result.user.id, child ? 1 : 0); }
    catch (cause) {
      // Never leave an account without its intended profile; sessions and credentials cascade.
      db.prepare("DELETE FROM user WHERE id = ?").run(result.user.id);
      throw cause;
    }
    res.status(201).json({ id: result.user.id, name, username, child });
  } catch { error(res, 409, "Brugernavnet findes allerede, eller kontoen kunne ikke oprettes."); }
});

const buildPath = resolve("build");
if (existsSync(buildPath)) {
  app.use(express.static(buildPath, {
    index: false,
    // Vite fingerprints files in /assets, so they never change under the same name.
    // The service worker, manifest and index.html keep max-age=0 so updates are found.
    setHeaders(res, path) { if (path.includes("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); }
  }));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return error(res, 404, "Ukendt API-kald.");
    res.sendFile(resolve(buildPath, "index.html"));
  });
}

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => logInfo(`Find ord lytter på ${port}`));

// Finish open requests and close SQLite cleanly when Docker stops the container.
function shutdown(signal: string) {
  logInfo(`${signal} modtaget; lukker ned.`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    void supply.close().finally(() => {
      db.close();
      process.exit(0);
    });
  });
  server.closeIdleConnections();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
