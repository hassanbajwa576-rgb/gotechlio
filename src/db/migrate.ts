import path from "node:path";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { createDb, type DB } from "./index";

const migrationsFolder = path.join(process.cwd(), "drizzle");

export async function migrateDb(db: DB, url = process.env.DATABASE_URL) {
  if (url && url.startsWith("postgres")) {
    await migrateNeon(db as unknown as NeonDatabase, { migrationsFolder });
  } else {
    await migratePglite(db, { migrationsFolder });
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrateDb(createDb())
    .then(() => { console.log("Migrations applied"); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
