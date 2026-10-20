import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { findWord, type Puzzle } from "../shared/game.js";
import { freePort, ready } from "./test-server.js";
import { CATEGORIES } from "../shared/words.js";

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
      const readiness = await fetch(`${baseURL}/api/ready`);
      expect(readiness.status).toBe(200);
      expect(await readiness.json()).toMatchObject({ ready: true, problems: [] });
      expect(readiness.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect((await fetch(`${baseURL}/api/health`, { headers: { "X-Request-Id": "proxy-123" } })).headers.get("x-request-id")).toBe("proxy-123");
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
      // A repeated request ID returns the same game; other choices under that ID are refused.
      const requestId = "00000000-0000-4000-8000-0000000000aa";
      const bobCreate = (category: string) => fetch(`${baseURL}/api/games`, {
        method: "POST", headers: { Origin: baseURL, Cookie: bob, "Content-Type": "application/json" },
        body: JSON.stringify({ category, level: "let", requestId })
      });
      const firstTry = await bobCreate("mad");
      expect(firstTry.status).toBe(201);
      const retried = await bobCreate("mad");
      expect(retried.status).toBe(200);
      expect((await retried.json() as { puzzle: { id: string } }).puzzle.id).toBe((await firstTry.json() as { puzzle: { id: string } }).puzzle.id);
      expect((await bobCreate("dyr")).status).toBe(409);
      expect(await listed(bob)).toHaveLength(1);
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
      expect((await fetch(`${baseURL}/api/admin/words`, { headers: { Cookie: alice } })).status).toBe(403);
      const wordAdmin = await (await fetch(`${baseURL}/api/admin/words`, { headers: { Cookie: root } })).json() as { words: Array<{ sources: string[] }>; coverage: unknown[] };
      expect(wordAdmin.coverage).toHaveLength(Object.keys(CATEGORIES).length);
      expect(wordAdmin.words.length).toBeGreaterThan(800);
      expect(wordAdmin.words.every((item) => item.sources.length > 0)).toBe(true);
      const adminCall = (path: string, body: object) => fetch(`${baseURL}/api/auth/admin/${path}`, {
        method: "POST", headers: { Origin: baseURL, Cookie: root, "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      expect((await adminCall("set-role", { userId: ids.kid, role: "admin" })).status).toBe(403);
      expect((await adminCall("update-user", { userId: ids.kid, data: { role: "admin" } })).status).toBe(403);
      expect((await adminCall("set-role", { userId: ids.root, role: "user" })).status).toBe(403);
      expect((await adminCall("remove-user", { userId: ids.root })).status).toBe(403);
      expect((await adminCall("ban-user", { userId: ids.root })).status).toBe(403);
      expect((await adminCall("create-user", { email: "x@users.find-ord.invalid", name: "x", password: "test-password-123" })).status).toBe(403);
      // Child flag: admin password, expected version, signs the account out.
      const kid = await login("kid");
      const policy = (cookie: string, body: object) => fetch(`${baseURL}/api/accounts/${ids.kid}/policy`, {
        method: "PATCH", headers: { Origin: baseURL, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      expect((await policy(alice, { child: false, adminPassword: "test-password-123", expectedVersion: 1 })).status).toBe(403);
      expect((await policy(root, { child: false, adminPassword: "forkert", expectedVersion: 1 })).status).toBe(403);
      const changed = await policy(root, { child: false, adminPassword: "test-password-123", expectedVersion: 1 });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toEqual({ id: ids.kid, child: false, policyVersion: 2 });
      expect((await policy(root, { child: true, adminPassword: "test-password-123", expectedVersion: 1 })).status).toBe(409);
      expect((await fetch(`${baseURL}/api/me`, { headers: { Cookie: kid } })).status).toBe(401);
      expect((await fetch(`${baseURL}/api/accounts/${ids.root}/policy`, {
        method: "PATCH", headers: { Origin: baseURL, Cookie: root, "Content-Type": "application/json" },
        body: JSON.stringify({ child: true, adminPassword: "test-password-123", expectedVersion: 1 })
      })).status).toBe(400);

      // Own profile: name and a built-in avatar.
      const profile = (body: object) => fetch(`${baseURL}/api/profile`, {
        method: "PATCH", headers: { Origin: baseURL, Cookie: alice, "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      expect((await profile({ name: "Alice A.", avatar: "ugle" })).status).toBe(200);
      expect(await (await fetch(`${baseURL}/api/me`, { headers: { Cookie: alice } })).json()).toMatchObject({ name: "Alice A.", avatar: "ugle" });
      expect((await profile({ name: "Alice", avatar: "../../billede.png" })).status).toBe(400);

      // Admin password reset signs the account out; deletion removes all of its data.
      expect((await adminCall("set-user-password", { userId: ids.alice, newPassword: "nyt-password-456" })).status).toBe(200);
      expect((await fetch(`${baseURL}/api/me`, { headers: { Cookie: alice } })).status).toBe(401);
      const relogin = await fetch(`${baseURL}/api/auth/sign-in/username`, {
        method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json" }, body: JSON.stringify({ username: "alice", password: "nyt-password-456" })
      });
      expect(relogin.status).toBe(200);
      const kidAgain = await login("kid");
      expect((await fetch(`${baseURL}/api/games`, {
        method: "POST", headers: { Origin: baseURL, Cookie: kidAgain, "Content-Type": "application/json" }, body: JSON.stringify({ category: "dyr", level: "let" })
      })).status).toBe(201);
      expect((await adminCall("remove-user", { userId: ids.kid })).status).toBe(200);
      const check = new Database(join(directory, "test.sqlite"), { readonly: true });
      const rowsFor = (table: string, column: string, id: string) => (check.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(id) as { count: number }).count;
      for (const [table, column] of [["user", "id"], ["session", "userId"], ["account", "userId"], ["profile", "user_id"], ["game", "user_id"], ["game_event", "user_id"], ["achievement_award", "user_id"], ["challenge", "user_id"], ["hint_credit", "user_id"], ["campaign", "user_id"]]) {
        expect(rowsFor(table, column, ids.kid)).toBe(0);
      }
      expect(rowsFor("game", "user_id", ids.alice)).toBeGreaterThan(0);
      check.close();

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
