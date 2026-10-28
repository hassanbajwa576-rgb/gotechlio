import path from "node:path";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { createDb, type DB } from "@/db";
import * as s from "@/db/schema";
import { seedDemo } from "@/db/seed";
import type { Actor } from "@/server/core";

/** A fresh in-memory database with two demo companies: `cid` (Techlio) and `cid2` (Techlio Labs). */
export async function freshDb() {
  const db = createDb("pglite://memory");
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const seeded = await seedDemo(db);
  const cid = seeded.company.id, cid2 = seeded.company2.id;
  return { db, ...seeded, cid, cid2, ...(await actors(db, cid, cid2)) };
}

export async function actors(db: DB, cid: number, cid2: number) {
  const get = async (email: string, companyId = cid): Promise<Actor> => {
    const [u] = await db.select().from(s.users).where(and(eq(s.users.email, email), eq(s.users.companyId, companyId)));
    return { id: u.id, role: u.role, name: u.name, companyId: u.companyId };
  };
  return {
    A: await get("admin@techlio.co"), H: await get("hr@techlio.co"), M: await get("manager@techlio.co"), E: await get("employee@techlio.co"), E2: await get("zain@techlio.co"),
    /** The same person as A, acting in the second company. */
    A2: await get("admin@techlio.co", cid2), N: await get("noor@labs.example", cid2),
  };
}

export const rejects = async (p: Promise<unknown>, msg?: RegExp) => {
  let err: unknown;
  try { await p; } catch (e) { err = e; }
  if (!err) throw new Error("Expected the call to throw, but it succeeded");
  if (msg && !msg.test((err as Error).message)) throw new Error(`Wrong error: "${(err as Error).message}" didn't match ${msg}`);
};

/** A Date at a local (Asia/Karachi, UTC+5) wall-clock time on a given date. */
export const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:00`);
