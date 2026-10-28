/**
 * One-time production setup: applies migrations to the database in DATABASE_URL and creates the first
 * company with its admin. No demo data is created. Run it again safely; it does nothing once a user exists.
 *
 *   DATABASE_URL=postgres://... ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='long password' COMPANY_NAME='Acme' npm run db:setup
 */
import { count } from "drizzle-orm";
import { createDb } from "@/db";
import * as s from "@/db/schema";
import { migrateDb } from "@/db/migrate";
import { createEmployee } from "@/server/people";
import { seedCompanyDefaults } from "@/server/admin";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) throw new Error("Set DATABASE_URL to your Neon connection string (postgres://...).");
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const companyName = process.env.COMPANY_NAME?.trim() || "My Company";
  if (!email) throw new Error("Set ADMIN_EMAIL.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");

  const db = createDb(url);
  await migrateDb(db, url);
  const [{ n }] = await db.select({ n: count() }).from(s.users);
  if (n > 0) { console.log("Database already has users; nothing to create."); return; }

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
  const [co] = await db.insert(s.companies).values({ name: companyName, slug }).returning();
  await seedCompanyDefaults(db, co.id);
  await createEmployee(db, null, { companyId: co.id, name: process.env.ADMIN_NAME?.trim() || "Admin", email, password, role: "ADMIN", title: "Owner" });
  console.log(`Created company "${companyName}" with admin ${email}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
