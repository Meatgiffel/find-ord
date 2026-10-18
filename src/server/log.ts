// One JSON object per line. LOG_LEVEL=error keeps only errors. Callers must not pass
// passwords, tokens, usernames or game content; IDs and counts are fine.
const quiet = process.env.LOG_LEVEL === "error";

export function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
  if (level === "info" && quiet) return;
  // The fixed keys win over fields with the same name.
  const line = JSON.stringify(Object.assign({ time: new Date().toISOString(), level, event }, fields, { level, event }));
  if (level === "error") console.error(line); else console.log(line);
}
