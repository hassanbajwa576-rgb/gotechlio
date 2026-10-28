import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import ws from "ws";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzlePglite<typeof schema>>;

/** Neon in production (DATABASE_URL=postgres://...), embedded PGlite locally (DATABASE_URL unset or pglite://dir). */
export function createDb(url = process.env.DATABASE_URL): DB {
  if (url && url.startsWith("postgres")) {
    neonConfig.webSocketConstructor = ws;
    return drizzleNeon({ client: new Pool({ connectionString: url }), schema }) as unknown as DB;
  }
  // Keep local data outside the project so the dev file watcher doesn't rebuild on every write.
  const dir = url?.startsWith("pglite://") ? url.slice("pglite://".length) : path.join(os.homedir(), ".gotechlio-pglite");
  return drizzlePglite({ client: new PGlite(dir === "memory" ? undefined : dir), schema });
}

const g = globalThis as unknown as { __db?: DB };
export function getDb(): DB {
  if (!g.__db) g.__db = createDb();
  return g.__db;
}

export { schema };
