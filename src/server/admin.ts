import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { type Actor, fail, isValidDate, requireAdmin, requireHR, toLocalDate } from "./core";
import { DEFAULT_ONBOARDING, logActivity } from "./people";

/** Company settings in the shape the UI expects. */
export async function getSettings(db: DB, companyId: number) {
  const [c] = await db.select().from(s.companies).where(eq(s.companies.id, companyId));
  if (!c) fail("Company not found.");
  return { companyName: c!.name, currency: c!.currency, taxRate: c!.taxRate, workingDaysPerMonth: c!.workingDaysPerMonth };
}

export async function updateSettings(db: DB, actor: Actor, p: Partial<{ companyName: string; currency: string; taxRate: number; workingDaysPerMonth: number }>) {
  requireAdmin(actor);
  if (p.taxRate !== undefined && (p.taxRate < 0 || p.taxRate > 0.6)) fail("Tax rate must be between 0 and 60%.");
  if (p.workingDaysPerMonth !== undefined && (p.workingDaysPerMonth < 10 || p.workingDaysPerMonth > 31)) fail("Working days must be 10 to 31.");
  if (p.companyName !== undefined && !p.companyName.trim()) fail("Company name is required.");
  const { companyName, ...rest } = p;
  await db.update(s.companies).set({ ...rest, ...(companyName !== undefined ? { name: companyName.trim() } : {}) }).where(eq(s.companies.id, actor.companyId));
}

export async function addLeaveType(db: DB, actor: Actor, name: string, annualQuota: number, paid: boolean) {
  requireHR(actor);
  if (!name.trim()) fail("Name is required.");
  if (annualQuota < 0 || annualQuota > 365) fail("Quota must be 0 to 365 days.");
  const [dupe] = await db.select().from(s.leaveTypes).where(and(eq(s.leaveTypes.companyId, actor.companyId), eq(s.leaveTypes.name, name.trim())));
  if (dupe) fail("A leave type with this name already exists.");
  const [t] = await db.insert(s.leaveTypes).values({ companyId: actor.companyId, name: name.trim(), annualQuota, paid }).returning();
  return t;
}
export const listLeaveTypes = (db: DB, companyId: number) => db.select().from(s.leaveTypes).where(eq(s.leaveTypes.companyId, companyId)).orderBy(asc(s.leaveTypes.id));

export async function addHoliday(db: DB, actor: Actor, date: string, name: string) {
  requireHR(actor);
  if (!isValidDate(date)) fail("Pick a valid date.");
  if (!name.trim()) fail("Name is required.");
  const [dupe] = await db.select().from(s.holidays).where(and(eq(s.holidays.companyId, actor.companyId), eq(s.holidays.date, date)));
  if (dupe) fail("There's already a holiday on that date.");
  await db.insert(s.holidays).values({ companyId: actor.companyId, date, name: name.trim() });
}
export async function removeHoliday(db: DB, actor: Actor, id: number) {
  requireHR(actor);
  await db.delete(s.holidays).where(and(eq(s.holidays.id, id), eq(s.holidays.companyId, actor.companyId)));
}
export const listHolidays = (db: DB, companyId: number) => db.select().from(s.holidays).where(eq(s.holidays.companyId, companyId)).orderBy(asc(s.holidays.date));

export async function addDepartment(db: DB, actor: Actor, name: string) {
  requireHR(actor);
  if (!name.trim()) fail("Name is required.");
  const [dupe] = await db.select().from(s.departments).where(and(eq(s.departments.companyId, actor.companyId), eq(s.departments.name, name.trim())));
  if (dupe) fail("This department already exists.");
  const [d] = await db.insert(s.departments).values({ companyId: actor.companyId, name: name.trim() }).returning();
  return d;
}
export const listDepartments = (db: DB, companyId: number) => db.select().from(s.departments).where(eq(s.departments.companyId, companyId)).orderBy(asc(s.departments.name));
export const listShifts = (db: DB, companyId: number) => db.select().from(s.shifts).where(eq(s.shifts.companyId, companyId)).orderBy(asc(s.shifts.id));

const slugify = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";

/** Default leave types, shifts and departments for a brand-new company. */
export async function seedCompanyDefaults(db: DB, companyId: number) {
  await db.insert(s.leaveTypes).values([
    { companyId, name: "Annual", annualQuota: 14, paid: true },
    { companyId, name: "Sick", annualQuota: 10, paid: true },
    { companyId, name: "Casual", annualQuota: 6, paid: true },
    { companyId, name: "Unpaid", annualQuota: 30, paid: false },
  ]);
  await db.insert(s.shifts).values([
    { companyId, name: "Day", startTime: "09:00", endTime: "18:00", graceMinutes: 15 },
    { companyId, name: "Evening", startTime: "15:00", endTime: "00:00", graceMinutes: 15 },
  ]);
  await db.insert(s.departments).values([{ companyId, name: "Management" }, { companyId, name: "Operations" }]);
}

/** Creates a company with defaults and makes the caller's account its admin. Any admin may do this. */
export async function createCompany(db: DB, actor: Actor, name: string) {
  requireAdmin(actor);
  const trimmed = name.trim();
  if (!trimmed) fail("Company name is required.");
  if (trimmed.length > 80) fail("Company name is too long.");
  const [me] = await db.select().from(s.users).where(eq(s.users.id, actor.id));
  let slug = slugify(trimmed);
  for (let i = 2; (await db.select({ id: s.companies.id }).from(s.companies).where(eq(s.companies.slug, slug))).length; i++) slug = `${slugify(trimmed)}-${i}`;
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [c] = await tx.insert(s.companies).values({ name: trimmed, slug }).returning();
    await seedCompanyDefaults(t, c.id);
    const [u] = await tx.insert(s.users).values({ companyId: c.id, accountId: me.accountId, email: me.email, name: me.name, role: "ADMIN", title: "Owner", joinDate: toLocalDate(new Date()) }).returning();
    const types = await tx.select().from(s.leaveTypes).where(eq(s.leaveTypes.companyId, c.id));
    await tx.insert(s.leaveBalances).values(types.map((lt) => ({ userId: u.id, leaveTypeId: lt.id, year: new Date().getFullYear(), allotted: lt.annualQuota })));
    await tx.insert(s.onboardingTasks).values(DEFAULT_ONBOARDING.map((title) => ({ userId: u.id, title })));
    await logActivity(t, u.id, "building", `You created ${c.name}`);
    return { companyId: c.id, userId: u.id };
  });
}
