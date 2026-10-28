import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, rejects, at } from "./helpers";
import * as a from "@/server/attendance";

let ctx: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => { ctx = await freshDb(); });

describe("check in / out", () => {
  it("rejects check-out and break before check-in", async () => {
    await rejects(a.checkOut(ctx.db, ctx.E, at("2026-10-05", "18:00")), /haven't checked in/);
    await rejects(a.startBreak(ctx.db, ctx.E, at("2026-10-05", "10:00")), /Check in before/);
    await rejects(a.endBreak(ctx.db, ctx.E, at("2026-10-05", "10:00")), /not on a break/);
  });
  it("on-time check-in is not late (within grace)", async () => {
    const r = await a.checkIn(ctx.db, ctx.E, at("2026-10-05", "09:10"));
    expect(r.late).toBe(false);
  });
  it("blocks double check-in", async () => {
    await rejects(a.checkIn(ctx.db, ctx.E, at("2026-10-05", "09:30")), /already checked in/);
  });
  it("computes worked time minus breaks and handles open break at checkout", async () => {
    await a.startBreak(ctx.db, ctx.E, at("2026-10-05", "13:00"));
    await rejects(a.startBreak(ctx.db, ctx.E, at("2026-10-05", "13:05")), /already on a break/);
    const mid = await a.todayStatus(ctx.db, ctx.E.id, at("2026-10-05", "13:30"));
    expect(mid.onBreak).toBe(true);
    expect(mid.worked).toBe(230); // 09:10→13:30 = 260, minus 30 open break
    await a.endBreak(ctx.db, ctx.E, at("2026-10-05", "13:45"));
    await a.startBreak(ctx.db, ctx.E, at("2026-10-05", "16:00"));
    await a.checkOut(ctx.db, ctx.E, at("2026-10-05", "17:10")); // open 70m break auto-closed
    const done = await a.todayStatus(ctx.db, ctx.E.id, at("2026-10-05", "17:30"));
    expect(done.checkOut).not.toBeNull();
    expect(done.worked).toBe(365); // 480 total - 45 break - 70 auto-closed break
    await rejects(a.checkOut(ctx.db, ctx.E, at("2026-10-05", "17:40")), /already checked out/);
  });
});

describe("late detection", () => {
  it("flags check-in after shift start plus grace", async () => {
    const r = await a.checkIn(ctx.db, ctx.E2, at("2026-10-06", "09:16"));
    expect(r.late).toBe(true);
  });
  it("shift 09:00 with 15 min grace treats exactly 09:15 as on time", async () => {
    const r = await a.checkIn(ctx.db, ctx.M, at("2026-10-06", "09:15"));
    expect(r.late).toBe(false);
  });
  it("users without a shift are never late", async () => {
    await a.assignShift(ctx.db, ctx.H, [ctx.A.id], null);
    expect((await a.checkIn(ctx.db, ctx.A, at("2026-10-06", "23:00"))).late).toBe(false);
  });
  it("uses company timezone, not UTC, for the local date", async () => {
    // 23:30 Karachi on Oct 7 = 18:30 UTC Oct 7; 01:00 Karachi Oct 8 = 20:00 UTC Oct 7.
    await a.checkIn(ctx.db, ctx.H, at("2026-10-07", "23:30"));
    await rejects(a.checkIn(ctx.db, ctx.H, at("2026-10-07", "23:45")), /already checked in/);
    await a.checkIn(ctx.db, ctx.E, at("2026-10-08", "01:00")); // new local day, allowed
  });
});

describe("timesheet and recent hours", () => {
  it("summarises a month", async () => {
    const t = await a.timesheet(ctx.db, ctx.E.id, "2026-10", at("2026-10-31", "12:00"));
    expect(t.presentDays).toBeGreaterThanOrEqual(1);
    expect(t.totalMinutes).toBeGreaterThan(0);
  });
  it("rejects a bad month", async () => { await rejects(a.timesheet(ctx.db, ctx.E.id, "2026-1"), /YYYY-MM/); });
  it("returns N days with zeros for absent days", async () => {
    const h = await a.recentHours(ctx.db, ctx.E.id, 14, at("2026-10-08", "12:00"));
    expect(h).toHaveLength(14);
    expect(h[h.length - 1].date).toBe("2026-10-08");
    expect(h.filter((d) => d.minutes === 0).length).toBeGreaterThan(5);
  });
});

describe("shifts", () => {
  it("validates and assigns", async () => {
    await rejects(a.createShift(ctx.db, ctx.E, "x", "09:00", "17:00", 10), /HR or admins/);
    await rejects(a.createShift(ctx.db, ctx.H, "", "09:00", "17:00", 10), /name/);
    await rejects(a.createShift(ctx.db, ctx.H, "Bad", "25:00", "17:00", 10), /HH:MM/);
    await rejects(a.createShift(ctx.db, ctx.H, "Bad", "09:00", "17:00", 500), /Grace/);
    const sh = await a.createShift(ctx.db, ctx.H, "Early", "07:00", "15:00", 5);
    await rejects(a.assignShift(ctx.db, ctx.H, [], sh.id), /at least one/);
    await a.assignShift(ctx.db, ctx.H, [ctx.E2.id], sh.id);
    expect((await a.checkIn(ctx.db, ctx.E2, at("2026-10-12", "07:06"))).late).toBe(true);
  });
});

describe("week schedule and who's in", () => {
  it("marks weekends, holidays and shifts", async () => {
    const w = await a.weekSchedule(ctx.db, ctx.cid, "2026-08-10"); // Mon Aug 10; Aug 14 is a holiday
    expect(w.dates).toHaveLength(7);
    const row = w.rows.find((r) => r.id === ctx.M.id)!;
    expect(row.cells[0].kind).toBe("shift");
    expect(row.cells[4].kind).toBe("holiday");
    expect(row.cells[5].kind).toBe("off");
    await rejects(a.weekSchedule(ctx.db, ctx.cid, "nope"), /Invalid/);
  });
  it("lists who is in today", async () => {
    const list = await a.whosIn(ctx.db, ctx.cid, at("2026-10-06", "12:00"));
    expect(list.map((x) => x.name)).toEqual(expect.arrayContaining(["Zain Ahmed", "Ayesha Khan"]));
  });
});
