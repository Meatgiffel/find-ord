import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { freePort, ready } from "./test-server.js";

describe("opsætning af første administrator", () => {
  it("kræver engangskoden, opretter én administrator og lukker derefter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "find-ord-setup-"));
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    let child: ChildProcess | undefined;
    try {
      child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
        cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATA_FILE: join(directory, "data.sqlite"), BASE_URL: baseURL }, stdio: ["ignore", "pipe", "ignore"]
      });
      let log = "";
      child.stdout!.on("data", (chunk) => { log += chunk; });
      await ready(baseURL, child);
      const token = readFileSync(join(directory, "setup-token"), "utf8").trim();
      expect(log).toContain(`${baseURL}/?opsaetning=${token}`);
      expect(await (await fetch(`${baseURL}/api/setup`)).json()).toEqual({ needed: true });

      const setup = (body: object, origin = baseURL) => fetch(`${baseURL}/api/setup`, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const admin = { username: "Ejer", name: "Ejer", password: "test-password-123" };
      expect((await setup({ ...admin, token }, "http://untrusted.invalid")).status).toBe(403);
      expect((await setup({ ...admin, token: "forkert" })).status).toBe(403);
      expect((await setup({ ...admin, token })).status).toBe(201);
      expect(existsSync(join(directory, "setup-token"))).toBe(false);
      expect(await (await fetch(`${baseURL}/api/setup`)).json()).toEqual({ needed: false });
      expect((await setup({ ...admin, username: "anden", token })).status).toBe(409);

      const login = await fetch(`${baseURL}/api/auth/sign-in/username`, {
        method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json" }, body: JSON.stringify({ username: "ejer", password: "test-password-123" })
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
      expect(await (await fetch(`${baseURL}/api/me`, { headers: { Cookie: cookie } })).json()).toMatchObject({ role: "admin", child: false });
    } finally {
      if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
});
