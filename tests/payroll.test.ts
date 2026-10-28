import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, rejects } from "./helpers";
import * as pay from "@/server/payroll";
import * as r from "@/server/requests";
import { updateSettings } from "@/server/admin";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let unpaid: number;
beforeAll(async () => {
  ctx = await freshDb();
  unpaid = (await ctx.db.select().from(s.leaveTypes).where(eq(s.leaveTypes.companyId, ctx.cid))).find((x) => x.name === "Unpaid")!.id;
});

describe("salary structure", () => {
  it("validates and upserts", async () => {
    await rejects(pay.setSalary(ctx.db, ctx.E, ctx.E.id, 1), /HR or admins/);
    await rejects(pay.setSalary(ctx.db, ctx.H, ctx.E.id, -1), /negative/);
    await rejects(pay.setSalary(ctx.db, ctx.H, ctx.E.id, 100, NaN), /negative/);
    await rejects(pay.setSalary(ctx.db, ctx.H, 9999, 100), /not found/);
    await pay.setSalary(ctx.db, ctx.H, ctx.E.id, 150000, 15000, 2000);
    await pay.setSalary(ctx.db, ctx.H, ctx.E.id, 160000, 15000, 2000);
    expect((await pay.listSalaries(ctx.db, ctx.cid)).find((x) => x.userId === ctx.E.id)!.basic).toBe(160000);
  });
});

describe("payroll run", () => {
  it("rejects invalid months and non-HR", async () => {
    await rejects(pay.runPayroll(ctx.db, ctx.H, "2026-13"), /YYYY-MM/);
    await rejects(pay.runPayroll(ctx.db, ctx.H, "202610"), /YYYY-MM/);
    await rejects(pay.runPayroll(ctx.db, ctx.E, "2026-10"), /HR or admins/);
  });
  it("computes gross, tax and net correctly with 5% tax", async () => {
    await pay.runPayroll(ctx.db, ctx.H, "2026-10");
    const run = (await pay.listRuns(ctx.db, ctx.cid))[0];
    const slip = (await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.E.id)))[0];
    expect(slip.gross).toBe(175000);
    expect(slip.tax).toBe(8750);
    expect(slip.net).toBe(175000 - 2000 - 8750);
    expect(run.finalized).toBe(false);
  });
  it("is re-runnable before finalizing without duplicating payslips", async () => {
    await pay.runPayroll(ctx.db, ctx.H, "2026-10");
    const run = (await pay.listRuns(ctx.db, ctx.cid))[0];
    const slips = await ctx.db.select().from(s.payslips).where(eq(s.payslips.runId, run.id));
    expect(slips.length).toBe(5);
  });
  it("hides payslips from employees until finalized, then shows only their own", async () => {
    const run = (await pay.listRuns(ctx.db, ctx.cid))[0];
    const slip = (await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.E.id)))[0];
    expect(await pay.myPayslips(ctx.db, ctx.E.id)).toHaveLength(0);
    await rejects(pay.getPayslip(ctx.db, ctx.E, slip.id), /can't view/);
    await pay.finalizeRun(ctx.db, ctx.H, run.id);
    expect(await pay.myPayslips(ctx.db, ctx.E.id)).toHaveLength(1);
    expect((await pay.getPayslip(ctx.db, ctx.E, slip.id)).net).toBe(slip.net);
    await rejects(pay.getPayslip(ctx.db, ctx.E2, slip.id), /can't view/);
    expect((await pay.getPayslip(ctx.db, ctx.H, slip.id)).name).toBe("Ali Raza");
  });
  it("can't finalize twice or re-run a finalized month", async () => {
    const run = (await pay.listRuns(ctx.db, ctx.cid))[0];
    await rejects(pay.finalizeRun(ctx.db, ctx.H, run.id), /already finalized/);
    await rejects(pay.runPayroll(ctx.db, ctx.H, "2026-10"), /finalized/);
    await rejects(pay.finalizeRun(ctx.db, ctx.H, 9999), /not found/);
  });
  it("run detail is HR-only", async () => {
    const run = (await pay.listRuns(ctx.db, ctx.cid))[0];
    await rejects(pay.runDetail(ctx.db, ctx.E, run.id), /HR or admins/);
    expect((await pay.runDetail(ctx.db, ctx.H, run.id)).length).toBe(5);
  });
});

describe("unpaid leave deduction", () => {
  it("deducts basic/22 per unpaid working day inside the month", async () => {
    const x = await r.applyLeave(ctx.db, ctx.E2, { leaveTypeId: unpaid, startDate: "2026-11-02", endDate: "2026-11-04", reason: "" });
    await r.decide(ctx.db, ctx.M, x.id, true);
    await pay.runPayroll(ctx.db, ctx.H, "2026-11");
    const slip = (await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.E2.id)).orderBy(s.payslips.id)).pop()!;
    expect(slip.unpaidLeaveDays).toBe(3);
    expect(slip.unpaidLeaveDeduction).toBe(Math.round((140000 / 22) * 3 * 100) / 100);
    expect(slip.gross).toBe(154000 - slip.unpaidLeaveDeduction);
  });
  it("only counts the days that fall in the month for cross-month leave", async () => {
    const x = await r.applyLeave(ctx.db, ctx.M, { leaveTypeId: unpaid, startDate: "2026-11-30", endDate: "2026-12-02", reason: "" });
    await r.decide(ctx.db, ctx.A, x.id, true);
    await pay.runPayroll(ctx.db, ctx.H, "2026-11");
    const nov = (await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.M.id))).pop()!;
    expect(nov.unpaidLeaveDays).toBe(1); // Nov 30 is a Monday
    await pay.runPayroll(ctx.db, ctx.H, "2026-12");
    const dec = (await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.M.id))).pop()!;
    expect(dec.unpaidLeaveDays).toBe(2); // Dec 1–2
  });
});

describe("expense reimbursement", () => {
  it("reimburses approved claims once, tax-free", async () => {
    const x = await r.applyExpense(ctx.db, ctx.E, { amount: 5000, category: "Travel", date: "2026-10-20", reason: "Client visit" });
    const pending = await r.applyExpense(ctx.db, ctx.E, { amount: 700, category: "Meals", date: "2026-10-21", reason: "Lunch" });
    await r.decide(ctx.db, ctx.M, x.id, true);
    await pay.runPayroll(ctx.db, ctx.H, "2027-01");
    const [feb] = [await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.E.id))].map((l) => l.pop()!);
    expect(feb.reimbursements).toBe(5000);
    expect(feb.net).toBe(feb.gross - feb.deductions - feb.tax + 5000);
    await pay.runPayroll(ctx.db, ctx.H, "2027-02");
    const next = (await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.E.id))).pop()!;
    expect(next.reimbursements).toBe(0); // already paid
    await r.decide(ctx.db, ctx.M, pending.id, false, "No receipt");
  });
});

describe("settings and edge cases", () => {
  it("uses the configured tax rate", async () => {
    await rejects(updateSettings(ctx.db, ctx.H, { taxRate: 0.1 }), /Only admins/);
    await rejects(updateSettings(ctx.db, ctx.A, { taxRate: 0.9 }), /0 and 60/);
    await updateSettings(ctx.db, ctx.A, { taxRate: 0.1 });
    await pay.runPayroll(ctx.db, ctx.H, "2027-03");
    const slip = (await ctx.db.select().from(s.payslips).where(eq(s.payslips.userId, ctx.E.id))).pop()!;
    expect(slip.tax).toBe(Math.round(slip.gross * 0.1 * 100) / 100);
  });
  it("fails cleanly with no salary data", async () => {
    const empty = await freshDb();
    await empty.db.delete(s.salaryStructures);
    await rejects(pay.runPayroll(empty.db, empty.H, "2026-10"), /salary structure/);
    const runs = await pay.listRuns(empty.db, empty.cid);
    expect(runs).toHaveLength(0); // transaction rolled back
  });
  it("final settlement pro-rates salary and encashes unused annual leave", async () => {
    const f = await pay.finalSettlement(ctx.db, ctx.H, ctx.E.id, "2026-10-15");
    expect(f.prorated).toBe(Math.round(((160000 + 15000) / 30) * 15 * 100) / 100);
    expect(f.unusedLeaveDays).toBe(14);
    expect(f.total).toBe(f.prorated + f.leaveEncashment);
    await rejects(pay.finalSettlement(ctx.db, ctx.E, ctx.E.id, "2026-10-15"), /HR or admins/);
  });
});
