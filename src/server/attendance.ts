import { and, asc, between, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { type Actor, fail, isValidDate, isValidTime, minutesOf, requireHR, toLocalDate, toLocalTime, eachDate, isWeekend } from "./core";

type Row = typeof s.attendance.$inferSelect;

export function workedMinutes(r: Pick<Row, "checkIn" | "checkOut" | "breakMinutes" | "breakStartedAt">, now = new Date()) {
  if (!r.checkIn) return 0;
  const end = r.checkOut ?? now;
  const openBreak = r.breakStartedAt && !r.checkOut ? Math.floor((now.getTime() - r.breakStartedAt.getTime()) / 60000) : 0;
  return Math.max(0, Math.floor((end.getTime() - r.checkIn.getTime()) / 60000) - r.breakMinutes - openBreak);
}

async function today(db: DB, userId: number, now: Date) {
  const date = toLocalDate(now);
  const [row] = await db.select().from(s.attendance).where(and(eq(s.attendance.userId, userId), eq(s.attendance.date, date)));
  return { date, row };
}

async function isLate(db: DB, userId: number, at: Date) {
  const [u] = await db.select({ shiftId: s.users.shiftId }).from(s.users).where(eq(s.users.id, userId));
  if (!u?.shiftId) return false;
  const [sh] = await db.select().from(s.shifts).where(eq(s.shifts.id, u.shiftId));
  if (!sh) return false;
  return minutesOf(toLocalTime(at)) > minutesOf(sh.startTime) + sh.graceMinutes;
}

export async function checkIn(db: DB, actor: Actor, now = new Date()) {
  const { date, row } = await today(db, actor.id, now);
  if (row?.checkIn) fail("You've already checked in today.");
  const late = await isLate(db, actor.id, now);
  if (row) {
    await db.update(s.attendance).set({ checkIn: now, late }).where(eq(s.attendance.id, row.id));
  } else {
    await db.insert(s.attendance).values({ userId: actor.id, date, checkIn: now, late });
  }
  return { late };
}

export async function checkOut(db: DB, actor: Actor, now = new Date()) {
  const { row } = await today(db, actor.id, now);
  if (!row?.checkIn) fail("You haven't checked in today.");
  if (row!.checkOut) fail("You've already checked out today.");
  let breakMinutes = row!.breakMinutes;
  if (row!.breakStartedAt) breakMinutes += Math.floor((now.getTime() - row!.breakStartedAt.getTime()) / 60000);
  await db.update(s.attendance).set({ checkOut: now, breakMinutes, breakStartedAt: null }).where(eq(s.attendance.id, row!.id));
}

export async function startBreak(db: DB, actor: Actor, now = new Date()) {
  const { row } = await today(db, actor.id, now);
  if (!row?.checkIn || row.checkOut) fail("Check in before taking a break.");
  if (row!.breakStartedAt) fail("You're already on a break.");
  await db.update(s.attendance).set({ breakStartedAt: now }).where(eq(s.attendance.id, row!.id));
}

export async function endBreak(db: DB, actor: Actor, now = new Date()) {
  const { row } = await today(db, actor.id, now);
  if (!row?.breakStartedAt) fail("You're not on a break.");
  const add = Math.floor((now.getTime() - row!.breakStartedAt!.getTime()) / 60000);
  await db.update(s.attendance).set({ breakStartedAt: null, breakMinutes: row!.breakMinutes + add }).where(eq(s.attendance.id, row!.id));
}

export async function todayStatus(db: DB, userId: number, now = new Date()) {
  const { row } = await today(db, userId, now);
  return {
    checkIn: row?.checkIn ?? null, checkOut: row?.checkOut ?? null, onBreak: !!row?.breakStartedAt,
    worked: row ? workedMinutes(row, now) : 0, late: row?.late ?? false,
  };
}

/** Days in a month with worked minutes, plus totals. month = YYYY-MM. */
export async function timesheet(db: DB, userId: number, month: string, now = new Date()) {
  if (!/^\d{4}-\d{2}$/.test(month)) fail("Month must be YYYY-MM.");
  const start = `${month}-01`;
  const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const rows = await db.select().from(s.attendance)
    .where(and(eq(s.attendance.userId, userId), between(s.attendance.date, start, end))).orderBy(asc(s.attendance.date));
  const days = rows.map((r) => ({ ...r, worked: workedMinutes(r, now) }));
  return {
    days,
    totalMinutes: days.reduce((a, d) => a + d.worked, 0),
    lateDays: days.filter((d) => d.late).length,
    presentDays: days.filter((d) => d.checkIn).length,
  };
}

/** Daily worked minutes for the last N days, for the dashboard chart. */
export async function recentHours(db: DB, userId: number, days = 14, now = new Date()) {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(toLocalDate(new Date(now.getTime() - i * 86400000)));
  const rows = await db.select().from(s.attendance)
    .where(and(eq(s.attendance.userId, userId), gte(s.attendance.date, dates[0]), lte(s.attendance.date, dates[dates.length - 1])));
  return dates.map((d) => { const r = rows.find((x) => x.date === d); return { date: d, minutes: r ? workedMinutes(r, now) : 0 }; });
}

// Shifts
export async function createShift(db: DB, actor: Actor, name: string, startTime: string, endTime: string, graceMinutes: number) {
  requireHR(actor);
  if (!name.trim()) fail("Shift name is required.");
  if (!isValidTime(startTime) || !isValidTime(endTime)) fail("Times must be HH:MM.");
  if (graceMinutes < 0 || graceMinutes > 120) fail("Grace period must be 0–120 minutes.");
  const [sh] = await db.insert(s.shifts).values({ companyId: actor.companyId, name: name.trim(), startTime, endTime, graceMinutes }).returning();
  return sh;
}

export async function assignShift(db: DB, actor: Actor, userIds: number[], shiftId: number | null) {
  requireHR(actor);
  if (!userIds.length) fail("Pick at least one employee.");
  if (shiftId) {
    const [sh] = await db.select({ id: s.shifts.id }).from(s.shifts).where(and(eq(s.shifts.id, shiftId), eq(s.shifts.companyId, actor.companyId)));
    if (!sh) fail("Shift not found.");
  }
  const mine = await db.select({ id: s.users.id }).from(s.users).where(and(inArray(s.users.id, userIds), eq(s.users.companyId, actor.companyId)));
  if (mine.length !== new Set(userIds).size) fail("Employee not found.");
  await db.update(s.users).set({ shiftId }).where(inArray(s.users.id, userIds));
}

/** Week grid: each employee x each day, marking shift / weekend / holiday / leave / WFH. */
export async function weekSchedule(db: DB, companyId: number, weekStart: string) {
  if (!isValidDate(weekStart)) fail("Invalid week start.");
  const dates = eachDate(weekStart, new Date(Date.parse(weekStart) + 6 * 86400000).toISOString().slice(0, 10));
  const people = await db.select({ id: s.users.id, name: s.users.name, shift: s.shifts.name, start: s.shifts.startTime, end: s.shifts.endTime })
    .from(s.users).leftJoin(s.shifts, eq(s.users.shiftId, s.shifts.id)).where(and(eq(s.users.companyId, companyId), eq(s.users.active, true))).orderBy(asc(s.users.name));
  const hol = await db.select().from(s.holidays).where(and(eq(s.holidays.companyId, companyId), between(s.holidays.date, dates[0], dates[6])));
  const reqs = (await db.select({ r: s.requests }).from(s.requests).innerJoin(s.users, eq(s.requests.userId, s.users.id)).where(and(
    eq(s.users.companyId, companyId), eq(s.requests.status, "APPROVED"), inArray(s.requests.type, ["LEAVE", "WFH"]),
    lte(s.requests.startDate, dates[6]), gte(s.requests.endDate, dates[0]),
  ))).map((x) => x.r);
  return {
    dates,
    rows: people.map((p) => ({
      ...p,
      cells: dates.map((d) => {
        const h = hol.find((x) => x.date === d);
        if (h) return { kind: "holiday" as const, label: h.name };
        if (isWeekend(d)) return { kind: "off" as const, label: "Off" };
        const r = reqs.find((x) => x.userId === p.id && x.startDate! <= d && x.endDate! >= d);
        if (r) return { kind: r.type === "LEAVE" ? ("leave" as const) : ("wfh" as const), label: r.type === "LEAVE" ? "Leave" : "WFH" };
        return p.shift ? { kind: "shift" as const, label: `${p.start}–${p.end}` } : { kind: "none" as const, label: "—" };
      }),
    })),
  };
}

/** Admin view: who's in today. */
export async function whosIn(db: DB, companyId: number, now = new Date()) {
  const date = toLocalDate(now);
  return db.select({ userId: s.attendance.userId, name: s.users.name, checkIn: s.attendance.checkIn, checkOut: s.attendance.checkOut, late: s.attendance.late })
    .from(s.attendance).innerJoin(s.users, eq(s.attendance.userId, s.users.id)).where(and(eq(s.users.companyId, companyId), eq(s.attendance.date, date))).orderBy(asc(s.users.name));
}
