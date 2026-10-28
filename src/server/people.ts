import bcrypt from "bcryptjs";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { type Actor, type Role, fail, isHR, isValidDate, requireAdmin, requireHR, toLocalDate } from "./core";

export const DEFAULT_ONBOARDING = [
  "Sign employment contract",
  "Submit ID and bank details",
  "Collect laptop and accessories",
  "Set up email and accounts",
  "Meet your manager and team",
];

export async function logActivity(db: DB, userId: number, icon: string, text: string) {
  await db.insert(s.activity).values({ userId, icon, text });
}

/** Loads an employee record, but only if it belongs to the given company. */
export async function userInCompany(db: DB, companyId: number, userId: number) {
  const [u] = await db.select().from(s.users).where(and(eq(s.users.id, userId), eq(s.users.companyId, companyId)));
  if (!u) fail("Employee not found.");
  return u!;
}

export type Membership = { userId: number; companyId: number; company: string; role: Role };

/** Companies this account can act in (active employee records only). */
export async function memberships(db: DB, accountId: number): Promise<Membership[]> {
  const rows = await db.select({ userId: s.users.id, companyId: s.users.companyId, company: s.companies.name, role: s.users.role })
    .from(s.users).innerJoin(s.companies, eq(s.users.companyId, s.companies.id))
    .where(and(eq(s.users.accountId, accountId), eq(s.users.active, true))).orderBy(asc(s.users.id));
  return rows as Membership[];
}

export async function verifyLogin(db: DB, email: string, password: string) {
  const [a] = await db.select().from(s.accounts).where(eq(s.accounts.email, email.trim().toLowerCase()));
  if (!a || !(await bcrypt.compare(password, a.passwordHash))) fail("Wrong email or password.");
  const ms = await memberships(db, a!.id);
  if (!ms.length) fail("This account is deactivated. Contact HR.");
  const m = ms[0];
  const [u] = await db.select().from(s.users).where(eq(s.users.id, m.userId));
  return { accountId: a!.id, actor: { id: u.id, role: u.role as Role, name: u.name, companyId: u.companyId } as Actor };
}

/** Re-reads the signed-in person from the database so role changes and deactivation apply immediately. */
export async function resolveActor(db: DB, userId: number, accountId: number): Promise<Actor | null> {
  const [u] = await db.select().from(s.users).where(and(eq(s.users.id, userId), eq(s.users.accountId, accountId), eq(s.users.active, true)));
  return u ? { id: u.id, role: u.role as Role, name: u.name, companyId: u.companyId } : null;
}

/** The employee record this account has in a company, if active. Used to switch companies. */
export async function membershipIn(db: DB, accountId: number, companyId: number) {
  const [u] = await db.select().from(s.users).where(and(eq(s.users.accountId, accountId), eq(s.users.companyId, companyId), eq(s.users.active, true)));
  return u ?? null;
}

export async function changePassword(db: DB, actor: Actor, current: string, next: string) {
  const [u] = await db.select().from(s.users).where(eq(s.users.id, actor.id));
  const [a] = u ? await db.select().from(s.accounts).where(eq(s.accounts.id, u.accountId)) : [];
  if (!a || !(await bcrypt.compare(current, a.passwordHash))) fail("Your current password is wrong.");
  if (next.length < 8) fail("New password must be at least 8 characters.");
  await db.update(s.accounts).set({ passwordHash: await bcrypt.hash(next, 10) }).where(eq(s.accounts.id, a!.id));
}

export type NewEmployee = {
  name: string; email: string; password: string; role?: Role; title?: string; phone?: string;
  departmentId?: number | null; managerId?: number | null; shiftId?: number | null; joinDate?: string;
  basic?: number; allowances?: number; deductions?: number; companyId?: number;
};

async function assertOwned(db: DB, table: typeof s.departments | typeof s.shifts, id: number | null | undefined, companyId: number, what: string) {
  if (!id) return;
  const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.companyId, companyId)));
  if (!row) fail(`${what} not found.`);
}

/**
 * Creates the employee record, this year's leave balances, salary and onboarding checklist.
 * If the email already has an account (they work for another of your companies), that account is linked instead of creating a new login.
 */
export async function createEmployee(db: DB, actor: Actor | null, input: NewEmployee) {
  if (actor) requireHR(actor);
  const companyId = actor?.companyId ?? input.companyId;
  if (!companyId) fail("Company is required.");
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) fail("Name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Enter a valid email.");
  if (input.role === "ADMIN" && actor && actor.role !== "ADMIN") fail("Only admins can create admins.");
  const joinDate = input.joinDate || toLocalDate(new Date());
  if (!isValidDate(joinDate)) fail("Join date is invalid.");

  const [dupe] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.companyId, companyId!), eq(s.users.email, email)));
  if (dupe) fail("An employee with this email already exists.");
  let [acct] = await db.select().from(s.accounts).where(eq(s.accounts.email, email));
  if (!acct && input.password.length < 8) fail("Password must be at least 8 characters.");
  if (input.managerId) {
    const [m] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, input.managerId), eq(s.users.companyId, companyId!)));
    if (!m) fail("Manager not found.");
  }
  await assertOwned(db, s.departments, input.departmentId, companyId!, "Department");
  await assertOwned(db, s.shifts, input.shiftId, companyId!, "Shift");
  if (input.basic != null && input.basic < 0) fail("Salary can't be negative.");

  if (!acct) [acct] = await db.insert(s.accounts).values({ email, name: input.name.trim(), passwordHash: await bcrypt.hash(input.password, 10) }).returning();
  const [u] = await db.insert(s.users).values({
    companyId: companyId!, accountId: acct.id, email, name: input.name.trim(),
    role: input.role ?? "EMPLOYEE", title: input.title ?? "", phone: input.phone ?? "",
    departmentId: input.departmentId ?? null, managerId: input.managerId ?? null,
    shiftId: input.shiftId ?? null, joinDate,
  }).returning();

  const year = Number(joinDate.slice(0, 4));
  const types = await db.select().from(s.leaveTypes).where(eq(s.leaveTypes.companyId, companyId!));
  if (types.length) {
    await db.insert(s.leaveBalances).values(types.map((t) => ({ userId: u.id, leaveTypeId: t.id, year, allotted: t.annualQuota })));
  }
  if (input.basic != null) {
    await db.insert(s.salaryStructures).values({ userId: u.id, basic: input.basic, allowances: input.allowances ?? 0, deductions: input.deductions ?? 0 });
  }
  await db.insert(s.onboardingTasks).values(DEFAULT_ONBOARDING.map((title) => ({ userId: u.id, title })));
  await logActivity(db, u.id, "confetti", `Welcome to the team, ${u.name}!`);
  return u;
}

export async function updateEmployee(db: DB, actor: Actor, id: number, patch: Partial<{
  name: string; title: string; phone: string; departmentId: number | null; managerId: number | null; shiftId: number | null; role: Role;
}>) {
  await userInCompany(db, actor.companyId, id);
  const self = actor.id === id;
  if (!isHR(actor)) {
    if (!self) fail("You can only edit your own profile.");
    const allowed = Object.keys(patch).every((k) => k === "phone");
    if (!allowed) fail("You can only change your phone number. Ask HR for other changes.");
  }
  if (patch.role && patch.role !== undefined) requireAdmin(actor);
  if (patch.managerId === id) fail("An employee can't be their own manager.");
  if (patch.managerId) {
    await userInCompany(db, actor.companyId, patch.managerId).catch(() => fail("Manager not found."));
    // Prevent reporting cycles: walk up from the proposed manager.
    let cur: number | null = patch.managerId;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === id) fail("That would create a reporting loop.");
      const [row] = await db.select({ m: s.users.managerId }).from(s.users).where(eq(s.users.id, cur));
      cur = row?.m ?? null;
    }
  }
  await assertOwned(db, s.departments, patch.departmentId, actor.companyId, "Department");
  await assertOwned(db, s.shifts, patch.shiftId, actor.companyId, "Shift");
  if (patch.name !== undefined && !patch.name.trim()) fail("Name is required.");
  const [u] = await db.update(s.users).set(patch).where(eq(s.users.id, id)).returning();
  return u;
}

export async function setActive(db: DB, actor: Actor, id: number, active: boolean) {
  requireHR(actor);
  if (actor.id === id) fail("You can't deactivate yourself.");
  await userInCompany(db, actor.companyId, id);
  await db.update(s.users).set({ active }).where(eq(s.users.id, id));
}

export async function directory(db: DB, companyId: number, q = "", departmentId?: number) {
  const conds = [eq(s.users.companyId, companyId), eq(s.users.active, true)];
  if (q.trim()) conds.push(or(ilike(s.users.name, `%${q.trim()}%`), ilike(s.users.email, `%${q.trim()}%`), ilike(s.users.title, `%${q.trim()}%`))!);
  if (departmentId) conds.push(eq(s.users.departmentId, departmentId));
  return db.select({
    id: s.users.id, name: s.users.name, email: s.users.email, title: s.users.title, role: s.users.role,
    phone: s.users.phone, department: s.departments.name, managerId: s.users.managerId,
  }).from(s.users).leftJoin(s.departments, eq(s.users.departmentId, s.departments.id))
    .where(and(...conds)).orderBy(asc(s.users.name));
}

export async function getEmployee(db: DB, companyId: number, id: number) {
  const [u] = await db.select({
    id: s.users.id, name: s.users.name, email: s.users.email, title: s.users.title, role: s.users.role, phone: s.users.phone,
    departmentId: s.users.departmentId, department: s.departments.name, managerId: s.users.managerId, shiftId: s.users.shiftId,
    joinDate: s.users.joinDate, active: s.users.active,
  }).from(s.users).leftJoin(s.departments, eq(s.users.departmentId, s.departments.id))
    .where(and(eq(s.users.id, id), eq(s.users.companyId, companyId)));
  return u ?? null;
}

export type OrgNode = { id: number; name: string; title: string; reports: OrgNode[] };
export async function orgChart(db: DB, companyId: number): Promise<OrgNode[]> {
  const all = await db.select({ id: s.users.id, name: s.users.name, title: s.users.title, managerId: s.users.managerId })
    .from(s.users).where(and(eq(s.users.companyId, companyId), eq(s.users.active, true))).orderBy(asc(s.users.name));
  const ids = new Set(all.map((u) => u.id));
  const build = (mid: number | null): OrgNode[] =>
    all.filter((u) => (mid === null ? !u.managerId || !ids.has(u.managerId) : u.managerId === mid))
      .map((u) => ({ id: u.id, name: u.name, title: u.title, reports: build(u.id) }));
  return build(null);
}

// Documents
export async function addDocument(db: DB, actor: Actor, userId: number, title: string, category: string, url: string) {
  if (!isHR(actor) && actor.id !== userId) fail("You can only add documents to your own profile.");
  await userInCompany(db, actor.companyId, userId);
  if (!title.trim()) fail("Title is required.");
  if (!/^https?:\/\//i.test(url)) fail("Link must start with http:// or https://");
  const [d] = await db.insert(s.documents).values({ userId, title: title.trim(), category, url }).returning();
  return d;
}
export async function deleteDocument(db: DB, actor: Actor, id: number) {
  const [d] = await db.select({ d: s.documents, companyId: s.users.companyId }).from(s.documents).innerJoin(s.users, eq(s.documents.userId, s.users.id)).where(eq(s.documents.id, id));
  if (!d || d.companyId !== actor.companyId) fail("Document not found.");
  if (!isHR(actor) && d!.d.userId !== actor.id) fail("You can't delete this document.");
  await db.delete(s.documents).where(eq(s.documents.id, id));
}
export const listDocuments = (db: DB, userId: number) =>
  db.select().from(s.documents).where(eq(s.documents.userId, userId)).orderBy(asc(s.documents.createdAt));

// Assets
export async function createAsset(db: DB, actor: Actor, tag: string, name: string, category: string) {
  requireHR(actor);
  if (!tag.trim() || !name.trim()) fail("Tag and name are required.");
  const [dupe] = await db.select().from(s.assets).where(and(eq(s.assets.companyId, actor.companyId), eq(s.assets.tag, tag.trim())));
  if (dupe) fail("An asset with this tag already exists.");
  const [a] = await db.insert(s.assets).values({ companyId: actor.companyId, tag: tag.trim(), name: name.trim(), category }).returning();
  return a;
}
export async function assignAsset(db: DB, actor: Actor, assetId: number, userId: number | null) {
  requireHR(actor);
  const [a] = await db.select().from(s.assets).where(and(eq(s.assets.id, assetId), eq(s.assets.companyId, actor.companyId)));
  if (!a) fail("Asset not found.");
  if (userId) await userInCompany(db, actor.companyId, userId);
  if (userId && a!.assignedTo) fail("Asset is already assigned. Return it first.");
  await db.update(s.assets).set({ assignedTo: userId, assignedAt: userId ? new Date() : null }).where(eq(s.assets.id, assetId));
  if (userId) await logActivity(db, userId, "device-laptop", `${a!.name} (${a!.tag}) was assigned to you`);
}
export const listAssets = (db: DB, companyId: number) =>
  db.select({ id: s.assets.id, tag: s.assets.tag, name: s.assets.name, category: s.assets.category, assignedTo: s.assets.assignedTo, holder: s.users.name, assignedAt: s.assets.assignedAt })
    .from(s.assets).leftJoin(s.users, eq(s.assets.assignedTo, s.users.id)).where(eq(s.assets.companyId, companyId)).orderBy(asc(s.assets.tag));

// Onboarding
export async function toggleTask(db: DB, actor: Actor, taskId: number) {
  const [t] = await db.select({ t: s.onboardingTasks, companyId: s.users.companyId }).from(s.onboardingTasks).innerJoin(s.users, eq(s.onboardingTasks.userId, s.users.id)).where(eq(s.onboardingTasks.id, taskId));
  if (!t || t.companyId !== actor.companyId) fail("Task not found.");
  if (!isHR(actor) && t!.t.userId !== actor.id) fail("You can't change this task.");
  await db.update(s.onboardingTasks).set({ done: !t!.t.done }).where(eq(s.onboardingTasks.id, taskId));
}
export async function addTask(db: DB, actor: Actor, userId: number, title: string) {
  requireHR(actor);
  await userInCompany(db, actor.companyId, userId);
  if (!title.trim()) fail("Task title is required.");
  await db.insert(s.onboardingTasks).values({ userId, title: title.trim() });
}
export async function onboardingOverview(db: DB, companyId: number) {
  return db.select({
    userId: s.users.id, name: s.users.name,
    total: sql<number>`count(${s.onboardingTasks.id})::int`,
    done: sql<number>`count(*) filter (where ${s.onboardingTasks.done})::int`,
  }).from(s.onboardingTasks).innerJoin(s.users, eq(s.onboardingTasks.userId, s.users.id))
    .where(eq(s.users.companyId, companyId)).groupBy(s.users.id, s.users.name).orderBy(asc(s.users.name));
}
export const listTasks = (db: DB, userId: number) =>
  db.select().from(s.onboardingTasks).where(eq(s.onboardingTasks.userId, userId)).orderBy(asc(s.onboardingTasks.id));
