import { asc, and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";

export const listUsersLite = (db: DB, companyId: number) =>
  db.select({ id: s.users.id, name: s.users.name, role: s.users.role, managerId: s.users.managerId }).from(s.users)
    .where(and(eq(s.users.companyId, companyId), eq(s.users.active, true))).orderBy(asc(s.users.name));
