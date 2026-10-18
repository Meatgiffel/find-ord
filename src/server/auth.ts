import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db, authSecret } from "./database.js";

export const baseURL = process.env.BASE_URL || "http://localhost:3000";
const lanHttpUrl = process.env.LAN_HTTP_URL?.trim();
if (lanHttpUrl && new URL(lanHttpUrl).protocol !== "http:") throw new Error("LAN_HTTP_URL skal være en HTTP-adresse.");
export const trustedOrigins = [baseURL, ...(lanHttpUrl ? [lanHttpUrl] : []), "http://localhost:5173", ...(process.env.TRUSTED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)];

function isAdminRole(role: unknown): boolean {
  return (Array.isArray(role) ? role : String(role ?? "").split(",")).map((item) => String(item).trim()).includes("admin");
}

function adminCount(): number {
  return (db.prepare("SELECT COUNT(*) AS count FROM user WHERE role = 'admin' OR role LIKE 'admin,%' OR role LIKE '%,admin' OR role LIKE '%,admin,%'").get() as { count: number }).count;
}

// Account rules on top of Better Auth's admin plugin: child accounts cannot become
// administrators, the last administrator cannot be demoted, banned or removed, and
// accounts are created through /api/accounts so every account gets a profile.
export const guardAccountChanges = createAuthMiddleware(async (ctx) => {
  if (!ctx.path.startsWith("/admin/")) return;
  if (ctx.path === "/admin/create-user") throw new APIError("FORBIDDEN", { message: "Opret konti via appens kontoadministration." });
  const body = (ctx.body ?? {}) as { userId?: string; role?: unknown; data?: { role?: unknown } };
  if (!body.userId) return;
  const target = db.prepare("SELECT u.role, COALESCE(p.child, 0) AS child FROM user u LEFT JOIN profile p ON p.user_id = u.id WHERE u.id = ?")
    .get(body.userId) as { role: string | null; child: number } | undefined;
  if (!target) return;
  const newRole = ctx.path === "/admin/set-role" ? body.role : ctx.path === "/admin/update-user" ? body.data?.role : undefined;
  if (newRole !== undefined && isAdminRole(newRole) && target.child) {
    throw new APIError("FORBIDDEN", { message: "Børnekonti kan ikke være administratorer." });
  }
  const losesAdmin = ["/admin/remove-user", "/admin/ban-user"].includes(ctx.path) || (newRole !== undefined && !isAdminRole(newRole));
  if (losesAdmin && isAdminRole(target.role) && adminCount() <= 1) {
    throw new APIError("FORBIDDEN", { message: "Den sidste administrator kan ikke fjernes." });
  }
});

function createAuth(url: string) { return betterAuth({
  database: db,
  baseURL: url,
  secret: authSecret(),
  trustedOrigins,
  emailAndPassword: { enabled: true, disableSignUp: false },
  plugins: [username(), admin()],
  hooks: { before: guardAccountChanges },
  advanced: { useSecureCookies: url.startsWith("https:"), database: { validateSchema: false } }
}); }

export const auth = createAuth(baseURL);
export const lanAuth = lanHttpUrl ? createAuth(lanHttpUrl) : null;
const lanHost = lanHttpUrl ? new URL(lanHttpUrl).host.toLowerCase() : null;
export function authForHost(host: string | undefined) {
  return lanAuth && host?.toLowerCase() === lanHost ? lanAuth : auth;
}
