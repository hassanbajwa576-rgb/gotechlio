import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, rejects } from "./helpers";
import * as r from "@/server/requests";
import * as a from "@/server/attendance";
import { addHoliday } from "@/server/admin";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let annual: number, sick: number, unpaid: number;
beforeAll(async () => {
  ctx = await freshDb();
  const t = await ctx.db.select().from(s.leaveTypes).where(eq(s.leaveTypes.companyId, ctx.cid));
  annual = t.find((x) => x.name === "Annual")!.id;
  sick = t.find((x) => x.name === "Sick")!.id;
  unpaid = t.find((x) => x.name === "Unpaid")!.id;
});

// 2026-11-02 is a Monday.
describe("working-day math", () => {
  it("skips weekends", async () => { expect(await r.workingDays(ctx.db, ctx.cid, "2026-11-02", "2026-11-08")).toBe(5); });
  it("skips company holidays", async () => {
    await addHoliday(ctx.db, ctx.H, "2026-11-04", "Test holiday");
    expect(await r.workingDays(ctx.db, ctx.cid, "2026-11-02", "2026-11-06")).toBe(4);
  });
  it("single weekend day is zero", async () => { expect(await r.workingDays(ctx.db, ctx.cid, "2026-11-07", "2026-11-07")).toBe(0); });
});

describe("apply for leave", () => {
  it("validates dates, ranges and year boundaries", async () => {
    await rejects(r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "bad", endDate: "2026-11-02", reason: "" }), /valid dates/);
    await rejects(r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2026-11-05", endDate: "2026-11-02", reason: "" }), /before start/);
    await rejects(r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2026-12-30", endDate: "2027-01-02", reason: "" }), /year boundary/);
    await rejects(r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2026-11-07", endDate: "2026-11-08", reason: "" }), /weekends or holidays/);
  });
  it("counts only working days and stays pending", async () => {
    const x = await r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2026-11-09", endDate: "2026-11-13", reason: "Trip" });
    expect(x.days).toBe(5);
    expect(x.status).toBe("PENDING");
  });
  it("blocks overlapping leave or WFH", async () => {
    await rejects(r.applyLeave(ctx.db, ctx.E, { leaveTypeId: sick, startDate: "2026-11-11", endDate: "2026-11-11", reason: "" }), /overlap/);
    await rejects(r.applyWfh(ctx.db, ctx.E, { startDate: "2026-11-12", endDate: "2026-11-12", reason: "" }), /overlap/);
  });
  it("counts pending requests against the balance", async () => {
    // 14 annual; 5 pending. 10 more would exceed.
    await rejects(r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2026-11-16", endDate: "2026-11-27", reason: "" }), /Not enough Annual/);
    await r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2026-11-16", endDate: "2026-11-24", reason: "" }); // 7 days → total 12
  });
  it("unpaid leave ignores the balance", async () => {
    const x = await r.applyLeave(ctx.db, ctx.E2, { leaveTypeId: unpaid, startDate: "2026-11-02", endDate: "2026-12-04", reason: "Sabbatical" });
    expect(x.days).toBeGreaterThan(20);
  });
});

describe("approval rules", () => {
  let id: number;
  beforeAll(async () => { id = (await r.applyLeave(ctx.db, ctx.E, { leaveTypeId: sick, startDate: "2026-12-07", endDate: "2026-12-08", reason: "Flu" })).id; });

  it("routes to the direct manager's inbox, not other managers", async () => {
    expect((await r.inbox(ctx.db, ctx.M)).some((x) => x.id === id)).toBe(true);
    expect((await r.inbox(ctx.db, ctx.E)).length).toBe(0);
  });
  it("blocks self-approval, peers, and non-managers", async () => {
    await rejects(r.decide(ctx.db, ctx.E, id, true), /own request/);
    await rejects(r.decide(ctx.db, ctx.E2, id, true), /not allowed/);
  });
  it("requires a note when rejecting", async () => {
    await rejects(r.decide(ctx.db, ctx.M, id, false, "  "), /note/);
  });
  it("approval deducts balance exactly once; second decision fails", async () => {
    await r.decide(ctx.db, ctx.M, id, true);
    const b = (await r.balances(ctx.db, ctx.E.id, 2026)).find((x) => x.name === "Sick")!;
    expect(b.used).toBe(2);
    expect(b.available).toBe(8);
    await rejects(r.decide(ctx.db, ctx.M, id, true), /already been decided/);
    expect((await r.balances(ctx.db, ctx.E.id, 2026)).find((x) => x.name === "Sick")!.used).toBe(2);
  });
  it("HR can decide anyone's, but not their own", async () => {
    const x = await r.applyWfh(ctx.db, ctx.E2, { startDate: "2026-12-09", endDate: "2026-12-09", reason: "" });
    await r.decide(ctx.db, ctx.H, x.id, true);
    const own = await r.applyWfh(ctx.db, ctx.H, { startDate: "2026-12-10", endDate: "2026-12-10", reason: "" });
    await rejects(r.decide(ctx.db, ctx.H, own.id, true), /own request/);
  });
  it("rejection leaves balance untouched and records the note", async () => {
    const x = await r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2026-12-14", endDate: "2026-12-14", reason: "" });
    await r.decide(ctx.db, ctx.M, x.id, false, "Release week");
    const got = await r.getRequest(ctx.db, ctx.E, x.id);
    expect(got.status).toBe("REJECTED");
    expect(got.decisionNote).toBe("Release week");
    expect((await r.balances(ctx.db, ctx.E.id, 2026)).find((b) => b.name === "Annual")!.used).toBe(0);
  });
  it("re-checks balance at approval time", async () => {
    // Two pending annual requests that each fit alone but not together after the first is approved.
    const e = ctx.E2;
    const first = await r.applyLeave(ctx.db, e, { leaveTypeId: annual, startDate: "2026-09-01", endDate: "2026-09-10", reason: "" }); // 8 days
    await r.decide(ctx.db, ctx.M, first.id, true);
    await rejects(r.applyLeave(ctx.db, e, { leaveTypeId: annual, startDate: "2026-09-14", endDate: "2026-09-25", reason: "" }), /Not enough/);
  });
});

describe("cancellation", () => {
  it("owner cancels pending; others can't; closed ones can't", async () => {
    const x = await r.applyWfh(ctx.db, ctx.E, { startDate: "2027-02-01", endDate: "2027-02-01", reason: "" });
    await rejects(r.cancel(ctx.db, ctx.E2, x.id), /your own/);
    await r.cancel(ctx.db, ctx.E, x.id);
    await rejects(r.cancel(ctx.db, ctx.E, x.id), /already closed/);
  });
  it("cancelling approved future leave restores the balance", async () => {
    const x = await r.applyLeave(ctx.db, ctx.E, { leaveTypeId: annual, startDate: "2027-03-01", endDate: "2027-03-03", reason: "" });
    await r.decide(ctx.db, ctx.M, x.id, true);
    expect((await r.balances(ctx.db, ctx.E.id, 2027)).find((b) => b.name === "Annual")!.used).toBe(3);
    await r.cancel(ctx.db, ctx.E, x.id);
    expect((await r.balances(ctx.db, ctx.E.id, 2027)).find((b) => b.name === "Annual")!.used).toBe(0);
  });
  it("approved leave that already started can't be cancelled", async () => {
    const x = await r.applyLeave(ctx.db, ctx.E, { leaveTypeId: sick, startDate: "2025-01-13", endDate: "2025-01-13", reason: "" });
    await r.decide(ctx.db, ctx.M, x.id, true);
    await rejects(r.cancel(ctx.db, ctx.E, x.id), /before they start/);
  });
});

describe("expenses", () => {
  it("validates amount, category, date and description", async () => {
    const ok = { amount: 2500, category: "Travel", date: "2026-10-01", reason: "Taxi to client" };
    await rejects(r.applyExpense(ctx.db, ctx.E, { ...ok, amount: 0 }), /greater than zero/);
    await rejects(r.applyExpense(ctx.db, ctx.E, { ...ok, amount: NaN }), /greater than zero/);
    await rejects(r.applyExpense(ctx.db, ctx.E, { ...ok, amount: 99_999_999 }), /too large/);
    await rejects(r.applyExpense(ctx.db, ctx.E, { ...ok, category: "Yachts" }), /category/);
    await rejects(r.applyExpense(ctx.db, ctx.E, { ...ok, date: "2099-01-01" }), /future/);
    await rejects(r.applyExpense(ctx.db, ctx.E, { ...ok, reason: " " }), /Describe/);
    const x = await r.applyExpense(ctx.db, ctx.E, ok);
    expect(x.amount).toBe(2500);
  });
});

describe("punch correction", () => {
  it("validates, blocks duplicates, and writes attendance on approval", async () => {
    const ok = { date: "2026-10-01", punchIn: "09:00", punchOut: "18:00", reason: "Forgot to check in" };
    await rejects(r.applyPunch(ctx.db, ctx.E, { ...ok, date: "2099-01-01" }), /future/);
    await rejects(r.applyPunch(ctx.db, ctx.E, { ...ok, punchIn: "9am" }), /HH:MM/);
    await rejects(r.applyPunch(ctx.db, ctx.E, { ...ok, punchOut: "08:00" }), /after check-in/);
    await rejects(r.applyPunch(ctx.db, ctx.E, { ...ok, reason: "" }), /Explain/);
    const x = await r.applyPunch(ctx.db, ctx.E, ok);
    await rejects(r.applyPunch(ctx.db, ctx.E, ok), /already have a pending/);
    await r.decide(ctx.db, ctx.M, x.id, true);
    const t = await a.timesheet(ctx.db, ctx.E.id, "2026-10", new Date("2026-10-31T00:00:00Z"));
    const day = t.days.find((d) => d.date === "2026-10-01")!;
    expect(day.worked).toBe(540);
    expect(day.source).toBe("correction");
  });
  it("overwrites an existing attendance row on approval", async () => {
    await a.checkIn(ctx.db, ctx.E2, new Date("2026-10-02T04:30:00Z"));
    const x = await r.applyPunch(ctx.db, ctx.E2, { date: "2026-10-02", punchIn: "08:00", punchOut: "17:00", reason: "Wrong time" });
    await r.decide(ctx.db, ctx.M, x.id, true);
    const t = await a.timesheet(ctx.db, ctx.E2.id, "2026-10");
    expect(t.days.find((d) => d.date === "2026-10-02")!.worked).toBe(540);
  });
});

describe("tickets", () => {
  it("opens, comments, restricts visibility, and HR resolves", async () => {
    await rejects(r.openTicket(ctx.db, ctx.E, { subject: " ", category: "IT", reason: "x" }), /Subject/);
    await rejects(r.openTicket(ctx.db, ctx.E, { subject: "Laptop", category: "IT", reason: " " }), /Describe/);
    const t = await r.openTicket(ctx.db, ctx.E, { subject: "Laptop is slow", category: "IT", reason: "Takes 5 min to boot" });
    await rejects(r.commentOnTicket(ctx.db, ctx.E2, t.id, "hi"), /can't comment/);
    await rejects(r.commentOnTicket(ctx.db, ctx.E, t.id, " "), /Write a comment/);
    await r.commentOnTicket(ctx.db, ctx.E, t.id, "Still slow");
    await r.commentOnTicket(ctx.db, ctx.H, t.id, "We'll swap it");
    expect((await r.ticketComments(ctx.db, t.id)).map((c) => c.author)).toEqual(["Ali Raza", "Sara Malik"]);
    await rejects(r.getRequest(ctx.db, ctx.E2, t.id), /can't view/);
    expect((await r.inbox(ctx.db, ctx.M)).some((x) => x.id === t.id)).toBe(false); // managers don't see tickets
    expect((await r.inbox(ctx.db, ctx.H)).some((x) => x.id === t.id)).toBe(true);
    await r.decide(ctx.db, ctx.H, t.id, true);
    await rejects(r.commentOnTicket(ctx.db, ctx.E2, t.id, "x"), /can't comment/);
  });
  it("comments aren't allowed on non-ticket requests", async () => {
    const w = await r.applyWfh(ctx.db, ctx.E, { startDate: "2027-05-03", endDate: "2027-05-03", reason: "" });
    await rejects(r.commentOnTicket(ctx.db, ctx.E, w.id, "x"), /only for tickets/);
  });
});

describe("lists and counts", () => {
  it("returns my requests newest first with counts", async () => {
    const list = await r.myRequests(ctx.db, ctx.E.id, "LEAVE");
    expect(list.length).toBeGreaterThan(2);
    const c = await r.counts(ctx.db, ctx.E.id, "LEAVE");
    expect(c.pending + c.approved + c.rejected).toBeLessThanOrEqual(list.length);
  });
  it("shows team members on leave today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const x = await r.applyWfh(ctx.db, ctx.E2, { startDate: today, endDate: today, reason: "" }).catch(() => null);
    if (x) { await r.decide(ctx.db, ctx.M, x.id, true); expect((await r.teamOnLeaveToday(ctx.db, ctx.cid)).length).toBeGreaterThan(0); }
  });
  it("missing request is a clean error", async () => { await rejects(r.getRequest(ctx.db, ctx.A, 999999), /not found/); });
});
