import { and, asc, between, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { type Actor, fail, isHR, isValidDate, isValidTime, eachDate, isWeekend, localDateTime, toLocalDate } from "./core";
import { logActivity } from "./people";

export type RequestType = "LEAVE" | "WFH" | "EXPENSE" | "PUNCH" | "TICKET";
type Req = typeof s.requests.$inferSelect;

export const EXPENSE_CATEGORIES = ["Travel", "Meals", "Equipment", "Internet", "Medical", "Other"];

/** Working days in range, excluding weekends and company holidays. */
export async function workingDays(db: DB, companyId: number, start: string, end: string) {
  const hol = await db.select({ date: s.holidays.date }).from(s.holidays).where(and(eq(s.holidays.companyId, companyId), between(s.holidays.date, start, end)));
  const set = new Set(hol.map((h) => h.date));
  return eachDate(start, end).filter((d) => !isWeekend(d) && !set.has(d)).length;
}

export async function getBalance(db: DB, userId: number, leaveTypeId: number, year: number) {
  const [b] = await db.select().from(s.leaveBalances).where(and(
    eq(s.leaveBalances.userId, userId), eq(s.leaveBalances.leaveTypeId, leaveTypeId), eq(s.leaveBalances.year, year)));
  if (b) return b;
  const [owner] = await db.select({ companyId: s.users.companyId }).from(s.users).where(eq(s.users.id, userId));
  const [t] = await db.select().from(s.leaveTypes).where(and(eq(s.leaveTypes.id, leaveTypeId), eq(s.leaveTypes.companyId, owner?.companyId ?? -1)));
  if (!t) fail("Leave type not found.");
  const [created] = await db.insert(s.leaveBalances).values({ userId, leaveTypeId, year, allotted: t!.annualQuota }).returning();
  return created;
}

export async function balances(db: DB, userId: number, year: number) {
  const [owner] = await db.select({ companyId: s.users.companyId }).from(s.users).where(eq(s.users.id, userId));
  const types = await db.select().from(s.leaveTypes).where(eq(s.leaveTypes.companyId, owner?.companyId ?? -1)).orderBy(asc(s.leaveTypes.id));
  const out = [];
  for (const t of types) {
    const b = await getBalance(db, userId, t.id, year);
    const pending = await db.select({ d: sql<number>`coalesce(sum(${s.requests.days}),0)::float` }).from(s.requests).where(and(
      eq(s.requests.userId, userId), eq(s.requests.leaveTypeId, t.id), eq(s.requests.status, "PENDING"),
      sql`extract(year from ${s.requests.startDate}) = ${year}`));
    out.push({ leaveTypeId: t.id, name: t.name, paid: t.paid, allotted: b.allotted, used: b.used, pending: pending[0].d, available: b.allotted - b.used });
  }
  return out;
}

async function assertNoOverlap(db: DB, userId: number, start: string, end: string) {
  const [clash] = await db.select({ id: s.requests.id, type: s.requests.type }).from(s.requests).where(and(
    eq(s.requests.userId, userId), inArray(s.requests.type, ["LEAVE", "WFH"]), inArray(s.requests.status, ["PENDING", "APPROVED"]),
    lte(s.requests.startDate, end), gte(s.requests.endDate, start)));
  if (clash) fail(`These dates overlap an existing ${clash.type === "LEAVE" ? "leave" : "work-from-home"} request.`);
}

function assertRange(start: string, end: string) {
  if (!isValidDate(start) || !isValidDate(end)) fail("Pick valid dates.");
  if (end < start) fail("End date can't be before start date.");
  if (start.slice(0, 4) !== end.slice(0, 4)) fail("Split requests that cross a year boundary.");
}

export async function applyLeave(db: DB, actor: Actor, i: { leaveTypeId: number; startDate: string; endDate: string; reason: string }) {
  assertRange(i.startDate, i.endDate);
  const [t] = await db.select().from(s.leaveTypes).where(and(eq(s.leaveTypes.id, i.leaveTypeId), eq(s.leaveTypes.companyId, actor.companyId)));
  if (!t) fail("Leave type not found.");
  const days = await workingDays(db, actor.companyId, i.startDate, i.endDate);
  if (days === 0) fail("Those dates are all weekends or holidays.");
  await assertNoOverlap(db, actor.id, i.startDate, i.endDate);
  const year = Number(i.startDate.slice(0, 4));
  const b = await getBalance(db, actor.id, i.leaveTypeId, year);
  const [{ pending }] = await db.select({ pending: sql<number>`coalesce(sum(${s.requests.days}),0)::float` }).from(s.requests).where(and(
    eq(s.requests.userId, actor.id), eq(s.requests.leaveTypeId, i.leaveTypeId), eq(s.requests.status, "PENDING"),
    sql`extract(year from ${s.requests.startDate}) = ${year}`));
  if (t!.paid && b.allotted - b.used - pending < days) {
    fail(`Not enough ${t!.name} balance: ${b.allotted - b.used - pending} day(s) available, ${days} requested.`);
  }
  const [r] = await db.insert(s.requests).values({ type: "LEAVE", userId: actor.id, leaveTypeId: i.leaveTypeId, startDate: i.startDate, endDate: i.endDate, days, reason: i.reason }).returning();
  return r;
}

export async function applyWfh(db: DB, actor: Actor, i: { startDate: string; endDate: string; reason: string }) {
  assertRange(i.startDate, i.endDate);
  const days = await workingDays(db, actor.companyId, i.startDate, i.endDate);
  if (days === 0) fail("Those dates are all weekends or holidays.");
  await assertNoOverlap(db, actor.id, i.startDate, i.endDate);
  const [r] = await db.insert(s.requests).values({ type: "WFH", userId: actor.id, startDate: i.startDate, endDate: i.endDate, days, reason: i.reason }).returning();
  return r;
}

export async function applyExpense(db: DB, actor: Actor, i: { amount: number; category: string; date: string; reason: string }) {
  if (!Number.isFinite(i.amount) || i.amount <= 0) fail("Amount must be greater than zero.");
  if (i.amount > 10_000_000) fail("Amount is too large.");
  if (!EXPENSE_CATEGORIES.includes(i.category)) fail("Pick a category.");
  if (!isValidDate(i.date)) fail("Pick the expense date.");
  if (i.date > toLocalDate(new Date())) fail("Expense date can't be in the future.");
  if (!i.reason.trim()) fail("Describe the expense.");
  const [r] = await db.insert(s.requests).values({ type: "EXPENSE", userId: actor.id, amount: i.amount, category: i.category, startDate: i.date, endDate: i.date, reason: i.reason }).returning();
  return r;
}

export async function applyPunch(db: DB, actor: Actor, i: { date: string; punchIn: string; punchOut: string; reason: string }) {
  if (!isValidDate(i.date)) fail("Pick a date.");
  if (i.date > toLocalDate(new Date())) fail("You can't correct a future date.");
  if (!isValidTime(i.punchIn) || !isValidTime(i.punchOut)) fail("Times must be HH:MM.");
  if (i.punchOut <= i.punchIn) fail("Check-out must be after check-in.");
  if (!i.reason.trim()) fail("Explain why the punch needs fixing.");
  const [dupe] = await db.select({ id: s.requests.id }).from(s.requests).where(and(
    eq(s.requests.userId, actor.id), eq(s.requests.type, "PUNCH"), eq(s.requests.status, "PENDING"), eq(s.requests.startDate, i.date)));
  if (dupe) fail("You already have a pending correction for this date.");
  const [r] = await db.insert(s.requests).values({ type: "PUNCH", userId: actor.id, startDate: i.date, endDate: i.date, punchIn: i.punchIn, punchOut: i.punchOut, reason: i.reason }).returning();
  return r;
}

export async function openTicket(db: DB, actor: Actor, i: { subject: string; category: string; reason: string }) {
  if (!i.subject.trim()) fail("Subject is required.");
  if (!i.reason.trim()) fail("Describe the issue.");
  const [r] = await db.insert(s.requests).values({ type: "TICKET", userId: actor.id, subject: i.subject.trim(), category: i.category || "General", reason: i.reason }).returning();
  return r;
}

export async function commentOnTicket(db: DB, actor: Actor, requestId: number, body: string) {
  const r = await load(db, requestId);
  if (r.type !== "TICKET") fail("Comments are only for tickets.");
  if (r.userId !== actor.id && !(isHR(actor) && (await sameCompany(db, actor, r)))) fail("You can't comment on this ticket.");
  if (!body.trim()) fail("Write a comment.");
  await db.insert(s.requestComments).values({ requestId, userId: actor.id, body: body.trim() });
  if (actor.id !== r.userId) await logActivity(db, r.userId, "message", `New reply on ticket "${r.subject}"`);
}

export const ticketComments = (db: DB, requestId: number) =>
  db.select({ id: s.requestComments.id, body: s.requestComments.body, createdAt: s.requestComments.createdAt, author: s.users.name })
    .from(s.requestComments).innerJoin(s.users, eq(s.requestComments.userId, s.users.id))
    .where(eq(s.requestComments.requestId, requestId)).orderBy(asc(s.requestComments.createdAt));

async function load(db: DB, id: number): Promise<Req> {
  const [r] = await db.select().from(s.requests).where(eq(s.requests.id, id));
  if (!r) fail("Request not found.");
  return r!;
}

/** Requests only ever cross company lines by mistake, so every check starts by comparing the requester's company. */
async function sameCompany(db: DB, actor: Actor, r: Req) {
  const [u] = await db.select({ companyId: s.users.companyId }).from(s.users).where(eq(s.users.id, r.userId));
  return u?.companyId === actor.companyId;
}

export async function canDecide(db: DB, actor: Actor, r: Req) {
  if (r.userId === actor.id) return false;
  if (!(await sameCompany(db, actor, r))) return false;
  if (isHR(actor)) return true;
  if (r.type === "TICKET") return false;
  if (actor.role !== "MANAGER") return false;
  const [u] = await db.select({ managerId: s.users.managerId }).from(s.users).where(eq(s.users.id, r.userId));
  return u?.managerId === actor.id;
}

const LABEL: Record<RequestType, string> = { LEAVE: "leave", WFH: "work-from-home", EXPENSE: "expense", PUNCH: "punch correction", TICKET: "ticket" };

export async function decide(db: DB, actor: Actor, id: number, approve: boolean, note = "") {
  const r = await load(db, id);
  if (r.status !== "PENDING") fail("This request has already been decided.");
  if (!(await canDecide(db, actor, r))) fail(r.userId === actor.id ? "You can't approve your own request." : "You're not allowed to decide this request.");
  if (!approve && !note.trim() && r.type !== "TICKET") fail("Add a note explaining the rejection.");

  return db.transaction(async (tx) => {
    if (approve && r.type === "LEAVE") {
      const year = Number(r.startDate!.slice(0, 4));
      const b = await getBalance(tx as unknown as DB, r.userId, r.leaveTypeId!, year);
      const [t] = await tx.select().from(s.leaveTypes).where(eq(s.leaveTypes.id, r.leaveTypeId!));
      if (t.paid && b.allotted - b.used < r.days!) fail("Employee no longer has enough leave balance.");
      await tx.update(s.leaveBalances).set({ used: b.used + r.days! }).where(eq(s.leaveBalances.id, b.id));
    }
    if (approve && r.type === "PUNCH") {
      const checkIn = localDateTime(r.startDate!, r.punchIn!);
      const checkOut = localDateTime(r.startDate!, r.punchOut!);
      const [existing] = await tx.select().from(s.attendance).where(and(eq(s.attendance.userId, r.userId), eq(s.attendance.date, r.startDate!)));
      if (existing) await tx.update(s.attendance).set({ checkIn, checkOut, breakStartedAt: null, source: "correction" }).where(eq(s.attendance.id, existing.id));
      else await tx.insert(s.attendance).values({ userId: r.userId, date: r.startDate!, checkIn, checkOut, source: "correction" });
    }
    const [u] = await tx.update(s.requests).set({
      status: approve ? "APPROVED" : "REJECTED", approverId: actor.id, decisionNote: note || null, decidedAt: new Date(),
    }).where(and(eq(s.requests.id, id), eq(s.requests.status, "PENDING"))).returning();
    if (!u) fail("This request has already been decided.");
    const verb = r.type === "TICKET" ? (approve ? "resolved" : "closed") : approve ? "approved" : "rejected";
    await logActivity(tx as unknown as DB, r.userId, approve ? "check" : "x", `Your ${LABEL[r.type]} request was ${verb}`);
    return u;
  });
}

export async function cancel(db: DB, actor: Actor, id: number) {
  const r = await load(db, id);
  if (r.userId !== actor.id) fail("You can only cancel your own requests.");
  const today = toLocalDate(new Date());
  if (r.status === "APPROVED" && r.type === "LEAVE" && r.startDate! > today) {
    const b = await getBalance(db, r.userId, r.leaveTypeId!, Number(r.startDate!.slice(0, 4)));
    await db.update(s.leaveBalances).set({ used: Math.max(0, b.used - r.days!) }).where(eq(s.leaveBalances.id, b.id));
  } else if (r.status !== "PENDING") {
    fail(r.status === "APPROVED" ? "Approved requests can only be cancelled before they start." : "This request is already closed.");
  }
  await db.update(s.requests).set({ status: "CANCELLED" }).where(eq(s.requests.id, id));
}

const approver = alias(s.users, "approver");
const cols = {
  id: s.requests.id, type: s.requests.type, status: s.requests.status, startDate: s.requests.startDate, endDate: s.requests.endDate,
  days: s.requests.days, amount: s.requests.amount, category: s.requests.category, punchIn: s.requests.punchIn, punchOut: s.requests.punchOut,
  subject: s.requests.subject, reason: s.requests.reason, decisionNote: s.requests.decisionNote, createdAt: s.requests.createdAt,
  userId: s.requests.userId, requester: s.users.name, approver: approver.name, leaveType: s.leaveTypes.name,
};
const base = (db: DB) => db.select(cols).from(s.requests)
  .innerJoin(s.users, eq(s.requests.userId, s.users.id))
  .leftJoin(approver, eq(s.requests.approverId, approver.id))
  .leftJoin(s.leaveTypes, eq(s.requests.leaveTypeId, s.leaveTypes.id));

export const myRequests = (db: DB, userId: number, type: RequestType) =>
  base(db).where(and(eq(s.requests.userId, userId), eq(s.requests.type, type))).orderBy(desc(s.requests.createdAt));

/** Pending requests this actor may decide. */
export async function inbox(db: DB, actor: Actor) {
  if (isHR(actor)) return base(db).where(and(eq(s.users.companyId, actor.companyId), eq(s.requests.status, "PENDING"), ne(s.requests.userId, actor.id))).orderBy(asc(s.requests.createdAt));
  if (actor.role !== "MANAGER") return [];
  return base(db).where(and(eq(s.requests.status, "PENDING"), eq(s.users.managerId, actor.id), ne(s.requests.type, "TICKET"))).orderBy(asc(s.requests.createdAt));
}

export const allTickets = (db: DB, companyId: number) => base(db).where(and(eq(s.users.companyId, companyId), eq(s.requests.type, "TICKET"))).orderBy(desc(s.requests.createdAt));

export async function getRequest(db: DB, actor: Actor, id: number) {
  const [r] = await base(db).where(eq(s.requests.id, id));
  if (!r) fail("Request not found.");
  const raw = await load(db, id);
  const mine = r!.userId === actor.id;
  if (!mine && !((await sameCompany(db, actor, raw)) && (isHR(actor) || (await canDecide(db, actor, raw))))) fail("You can't view this request.");
  return r!;
}

export async function counts(db: DB, userId: number, type: RequestType) {
  const rows = await db.select({ status: s.requests.status, n: sql<number>`count(*)::int` }).from(s.requests)
    .where(and(eq(s.requests.userId, userId), eq(s.requests.type, type))).groupBy(s.requests.status);
  const get = (st: string) => rows.find((r) => r.status === st)?.n ?? 0;
  return { pending: get("PENDING"), approved: get("APPROVED"), rejected: get("REJECTED") };
}

export async function teamOnLeaveToday(db: DB, companyId: number) {
  const t = toLocalDate(new Date());
  return db.select({ name: s.users.name, type: s.requests.type }).from(s.requests).innerJoin(s.users, eq(s.requests.userId, s.users.id))
    .where(and(eq(s.users.companyId, companyId), eq(s.requests.status, "APPROVED"), or(eq(s.requests.type, "LEAVE"), eq(s.requests.type, "WFH")), lte(s.requests.startDate, t), gte(s.requests.endDate, t)));
}
