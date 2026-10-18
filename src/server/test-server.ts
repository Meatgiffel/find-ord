import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

// Helpers for integration tests that start the real server on a free port.
export async function freePort(): Promise<number> {
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

export async function ready(baseURL: string, child: ChildProcess): Promise<void> {
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
