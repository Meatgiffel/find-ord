import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins";
import { db, authSecret } from "./database.js";

export const baseURL = process.env.BASE_URL || "http://localhost:3000";
const lanHttpUrl = process.env.LAN_HTTP_URL?.trim();
if (lanHttpUrl && new URL(lanHttpUrl).protocol !== "http:") throw new Error("LAN_HTTP_URL skal være en HTTP-adresse.");
export const trustedOrigins = [baseURL, ...(lanHttpUrl ? [lanHttpUrl] : []), "http://localhost:5173", ...(process.env.TRUSTED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)];

function createAuth(url: string) { return betterAuth({
  database: db,
  baseURL: url,
  secret: authSecret(),
  trustedOrigins,
  emailAndPassword: { enabled: true, disableSignUp: false },
  plugins: [username(), admin()],
  advanced: { useSecureCookies: url.startsWith("https:"), database: { validateSchema: false } }
}); }

export const auth = createAuth(baseURL);
export const lanAuth = lanHttpUrl ? createAuth(lanHttpUrl) : null;
const lanHost = lanHttpUrl ? new URL(lanHttpUrl).host.toLowerCase() : null;
export function authForHost(host: string | undefined) {
  return lanAuth && host?.toLowerCase() === lanHost ? lanAuth : auth;
}
