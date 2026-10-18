import { stdin, stdout } from "node:process";
import { input, password as passwordPrompt } from "@inquirer/prompts";
import { auth } from "../src/server/auth.js";
import { db, migrateGameData } from "../src/server/database.js";

// Owner recovery on the Docker host: gives an existing adult account administrator
// access with a new password and signs it out everywhere. No mail service is needed.
migrateGameData(db);
if (!stdin.isTTY) throw new Error("Kør kommandoen interaktivt i terminalen.");
const username = (await input({ message: "Brugernavn, der skal have administratoradgang:" })).trim().toLowerCase();
const account = db.prepare("SELECT u.id, COALESCE(p.child, 0) AS child FROM user u LEFT JOIN profile p ON p.user_id = u.id WHERE u.username = ?")
  .get(username) as { id: string; child: number } | undefined;
if (!account) throw new Error("Kontoen findes ikke.");
if (account.child) throw new Error("En børnekonto kan ikke være administrator.");
const password = await passwordPrompt({ message: "Ny adgangskode (mindst 8 tegn):", mask: "*" });
if (password.length < 8) throw new Error("Adgangskoden skal have mindst 8 tegn.");
const context = await auth.$context;
await context.internalAdapter.updatePassword(account.id, await context.password.hash(password));
await context.internalAdapter.deleteUserSessions(account.id);
db.prepare("UPDATE user SET role = 'admin', banned = 0, banReason = NULL, banExpires = NULL WHERE id = ?").run(account.id);
stdout.write("Administratoradgang er gendannet. Log ind med den nye adgangskode.\n");
