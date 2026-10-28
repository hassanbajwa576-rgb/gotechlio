import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { type Actor, fail, isHR, requireHR, round2 } from "./core";
import { logActivity, userInCompany } from "./people";
import { getBalance } from "./requests";

export async function setSalary(db: DB, actor: Actor, userId: number, basic: number, allowances = 0, deductions = 0) {
  requireHR(actor);
  if ([basic, allowances, deductions].some((n) => !Number.isFinite(n) || n < 0)) fail("Salary amounts can't be negative.");
  await userInCompany(db, actor.companyId, userId);
  await db.insert(s.salaryStructures).values({ userId, basic, allowances, deductions })
    .onConflictDoUpdate({ target: s.salaryStructures.userId, set: { basic, allowances, deductions } });
}

export const listSalaries = (db: DB, companyId: number) =>
  db.select({ userId: s.users.id, name: s.users.name, basic: s.salaryStructures.basic, allowances: s.salaryStructures.allowances, deductions: s.salaryStructures.deductions })
    .from(s.users).leftJoin(s.salaryStructures, eq(s.salaryStructures.userId, s.users.id))
    .where(and(eq(s.users.companyId, companyId), eq(s.users.active, true))).orderBy(asc(s.users.name));

/** Unpaid leave days approved inside a month (days clipped to that month). */
async function unpaidDays(db: DB, companyId: number, userId: number, month: string) {
  const rows = await db.select({ start: s.requests.startDate, end: s.requests.endDate, days: s.requests.days })
    .from(s.requests).innerJoin(s.leaveTypes, eq(s.requests.leaveTypeId, s.leaveTypes.id))
    .where(and(eq(s.requests.userId, userId), eq(s.requests.type, "LEAVE"), eq(s.requests.status, "APPROVED"), eq(s.leaveTypes.paid, false)));
  let total = 0;
  for (const r of rows) {
    if (r.start!.slice(0, 7) === month && r.end!.slice(0, 7) === month) total += r.days!;
    else if (r.start!.slice(0, 7) === month || r.end!.slice(0, 7) === month) {
      // Cross-month: count working days that fall in this month.
      const { eachDate, isWeekend } = await import("./core");
      const hol = new Set((await db.select({ d: s.holidays.date }).from(s.holidays).where(eq(s.holidays.companyId, companyId))).map((h) => h.d));
      total += eachDate(r.start!, r.end!).filter((d) => d.slice(0, 7) === month && !isWeekend(d) && !hol.has(d)).length;
    }
  }
  return total;
}

export async function runPayroll(db: DB, actor: Actor, month: string) {
  requireHR(actor);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("Month must be YYYY-MM.");
  const [existing] = await db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.companyId, actor.companyId), eq(s.payrollRuns.month, month)));
  if (existing?.finalized) fail("This month is finalized and can't be re-run.");
  const [cfg] = await db.select().from(s.companies).where(eq(s.companies.id, actor.companyId));
  const taxRate = cfg?.taxRate ?? 0.05;
  const wd = cfg?.workingDaysPerMonth ?? 22;

  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    let run = existing;
    if (run) await tx.delete(s.payslips).where(eq(s.payslips.runId, run.id));
    else [run] = await tx.insert(s.payrollRuns).values({ companyId: actor.companyId, month }).returning();

    const staff = await tx.select({ userId: s.salaryStructures.userId, basic: s.salaryStructures.basic, allowances: s.salaryStructures.allowances, deductions: s.salaryStructures.deductions })
      .from(s.salaryStructures).innerJoin(s.users, eq(s.salaryStructures.userId, s.users.id)).where(and(eq(s.users.companyId, actor.companyId), eq(s.users.active, true)));
    if (!staff.length) fail("No employees have a salary structure yet.");

    for (const e of staff) {
      const unpaid = await unpaidDays(t, actor.companyId, e.userId, month);
      const unpaidDeduction = round2((e.basic / wd) * unpaid);
      // Approved expense claims dated in the month and not yet paid out are reimbursed tax-free.
      const claims = await tx.select().from(s.requests).where(and(
        eq(s.requests.userId, e.userId), eq(s.requests.type, "EXPENSE"), eq(s.requests.status, "APPROVED"),
        sql`${s.requests.payslipId} is null`));
      const reimb = round2(claims.reduce((a, c) => a + (c.amount ?? 0), 0));
      const gross = round2(e.basic + e.allowances - unpaidDeduction);
      const tax = round2(Math.max(0, gross) * taxRate);
      const net = round2(gross - e.deductions - tax + reimb);
      const [p] = await tx.insert(s.payslips).values({
        runId: run!.id, userId: e.userId, basic: e.basic, allowances: e.allowances, reimbursements: reimb,
        unpaidLeaveDays: unpaid, unpaidLeaveDeduction: unpaidDeduction, deductions: e.deductions, tax, gross, net,
      }).returning();
      if (claims.length) await tx.update(s.requests).set({ payslipId: p.id }).where(inArray(s.requests.id, claims.map((c) => c.id)));
    }
    return run!;
  });
}

export async function finalizeRun(db: DB, actor: Actor, runId: number) {
  requireHR(actor);
  const [run] = await db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.id, runId), eq(s.payrollRuns.companyId, actor.companyId)));
  if (!run) fail("Payroll run not found.");
  if (run!.finalized) fail("This run is already finalized.");
  await db.update(s.payrollRuns).set({ finalized: true }).where(eq(s.payrollRuns.id, runId));
  const slips = await db.select({ userId: s.payslips.userId }).from(s.payslips).where(eq(s.payslips.runId, runId));
  for (const p of slips) await logActivity(db, p.userId, "file-invoice", `Your ${run!.month} payslip is ready`);
}

export const listRuns = (db: DB, companyId: number) => db.select().from(s.payrollRuns).where(eq(s.payrollRuns.companyId, companyId)).orderBy(desc(s.payrollRuns.month));

export async function runDetail(db: DB, actor: Actor, runId: number) {
  requireHR(actor);
  const [run] = await db.select({ id: s.payrollRuns.id }).from(s.payrollRuns).where(and(eq(s.payrollRuns.id, runId), eq(s.payrollRuns.companyId, actor.companyId)));
  if (!run) fail("Payroll run not found.");
  return db.select({ id: s.payslips.id, name: s.users.name, gross: s.payslips.gross, tax: s.payslips.tax, net: s.payslips.net, reimbursements: s.payslips.reimbursements })
    .from(s.payslips).innerJoin(s.users, eq(s.payslips.userId, s.users.id)).where(eq(s.payslips.runId, runId)).orderBy(asc(s.users.name));
}

/** An employee only sees payslips from finalized runs. */
export const myPayslips = (db: DB, userId: number) =>
  db.select({ id: s.payslips.id, month: s.payrollRuns.month, gross: s.payslips.gross, net: s.payslips.net })
    .from(s.payslips).innerJoin(s.payrollRuns, eq(s.payslips.runId, s.payrollRuns.id))
    .where(and(eq(s.payslips.userId, userId), eq(s.payrollRuns.finalized, true))).orderBy(desc(s.payrollRuns.month));

export async function getPayslip(db: DB, actor: Actor, id: number) {
  const [p] = await db.select({ p: s.payslips, month: s.payrollRuns.month, finalized: s.payrollRuns.finalized, name: s.users.name, companyId: s.payrollRuns.companyId })
    .from(s.payslips).innerJoin(s.payrollRuns, eq(s.payslips.runId, s.payrollRuns.id)).innerJoin(s.users, eq(s.payslips.userId, s.users.id)).where(eq(s.payslips.id, id));
  if (!p) fail("Payslip not found.");
  const own = p!.p.userId === actor.id && p!.finalized;
  const hrView = isHR(actor) && p!.companyId === actor.companyId;
  if (!own && !hrView) fail("You can't view this payslip.");
  return { ...p!.p, month: p!.month, name: p!.name };
}

/** Final settlement: pro-rated salary for the last month plus unused paid leave encashed. */
export async function finalSettlement(db: DB, actor: Actor, userId: number, lastDay: string) {
  requireHR(actor);
  await userInCompany(db, actor.companyId, userId);
  const [sal] = await db.select().from(s.salaryStructures).where(eq(s.salaryStructures.userId, userId));
  if (!sal) fail("No salary structure for this employee.");
  const [cfg] = await db.select().from(s.companies).where(eq(s.companies.id, actor.companyId));
  const wd = cfg?.workingDaysPerMonth ?? 22;
  const dayOfMonth = Number(lastDay.slice(8, 10));
  const prorated = round2(((sal!.basic + sal!.allowances) / 30) * dayOfMonth);
  const year = Number(lastDay.slice(0, 4));
  const [annual] = await db.select().from(s.leaveTypes).where(and(eq(s.leaveTypes.companyId, actor.companyId), eq(s.leaveTypes.name, "Annual"), eq(s.leaveTypes.paid, true)));
  const bal = annual ? await getBalance(db, userId, annual.id, year) : null;
  const unused = bal ? Math.max(0, bal.allotted - bal.used) : 0;
  const encash = round2((sal!.basic / wd) * unused);
  return { prorated, unusedLeaveDays: unused, leaveEncashment: encash, total: round2(prorated + encash) };
}
