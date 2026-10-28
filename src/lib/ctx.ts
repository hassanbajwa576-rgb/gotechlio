import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import * as s from "@/db/schema";
import { migrateDb } from "@/db/migrate";
import { seedDemo } from "@/db/seed";
import { getSession } from "./session";
import { isHR, isManagerish, type Actor } from "@/server/core";
import { memberships, resolveActor } from "@/server/people";

let ready: Promise<void> | null = null;

/** Local (embedded) databases bootstrap themselves; Neon is migrated and seeded by `npm run db:setup`. */
async function ensureReady(db: DB) {
  if (process.env.DATABASE_URL?.startsWith("postgres")) return;
  ready ??= (async () => {
    await migrateDb(db);
    const [{ n }] = await db.select({ n: count() }).from(s.users);
    if (n === 0) await seedDemo(db);
  })();
  await ready;
}

/** The signed-in person, re-read from the database so role changes and deactivation take effect immediately. */
export async function getCtx(): Promise<{ db: DB; actor: Actor; accountId: number }> {
  const db = getDb();
  await ensureReady(db);
  const session = await getSession();
  const actor = session ? await resolveActor(db, session.userId, session.accountId) : null;
  if (!session || !actor) redirect("/login");
  return { db, actor: actor!, accountId: session!.accountId };
}

export async function companiesFor(db: DB, accountId: number) {
  return memberships(db, accountId);
}

export async function requireHRCtx() {
  const c = await getCtx();
  if (!isHR(c.actor)) redirect("/home");
  return c;
}

export async function requireManagerCtx() {
  const c = await getCtx();
  if (!isManagerish(c.actor)) redirect("/home");
  return c;
}

export async function publicDb() {
  const db = getDb();
  await ensureReady(db);
  return db;
}
