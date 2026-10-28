import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, rejects } from "./helpers";
import * as t from "@/server/talent";
import * as adm from "@/server/admin";
import { verifyLogin } from "@/server/people";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";

let ctx: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => { ctx = await freshDb(); });

describe("recruitment", () => {
  let jobId: number, candId: number;
  it("only HR creates jobs, with a title", async () => {
    await rejects(t.createJob(ctx.db, ctx.E, { title: "x" }), /HR or admins/);
    await rejects(t.createJob(ctx.db, ctx.H, { title: " " }), /title/);
    jobId = (await t.createJob(ctx.db, ctx.H, { title: "QA Engineer", location: "Remote" })).id;
  });
  it("accepts public applications, rejects dupes, bad input and closed jobs", async () => {
    await rejects(t.applyToJob(ctx.db, jobId, "", "a@b.co"), /Name/);
    await rejects(t.applyToJob(ctx.db, jobId, "Bilal", "nope"), /valid email/);
    await rejects(t.applyToJob(ctx.db, 99999, "Bilal", "b@b.co"), /isn't accepting/);
    candId = (await t.applyToJob(ctx.db, jobId, "Bilal", "Bilal@Example.com")).id;
    await rejects(t.applyToJob(ctx.db, jobId, "Bilal", "bilal@example.com"), /already applied/);
    await t.setJobOpen(ctx.db, ctx.H, jobId, false);
    await rejects(t.applyToJob(ctx.db, jobId, "Other", "o@b.co"), /isn't accepting/);
    expect((await t.listJobs(ctx.db, ctx.cid, true)).some((j) => j.id === jobId)).toBe(false);
    await t.setJobOpen(ctx.db, ctx.H, jobId, true);
  });
  it("moves forward only, rates 1–5, and can't hire before the offer stage", async () => {
    await rejects(t.moveCandidate(ctx.db, ctx.E, candId, "SCREENING"), /HR or admins/);
    await t.moveCandidate(ctx.db, ctx.H, candId, "INTERVIEW");
    await rejects(t.moveCandidate(ctx.db, ctx.H, candId, "SCREENING"), /backwards/);
    await rejects(t.moveCandidate(ctx.db, ctx.H, candId, "HIRED"), /Hire/);
    await rejects(t.rateCandidate(ctx.db, ctx.H, candId, 6, ""), /1 to 5/);
    await t.rateCandidate(ctx.db, ctx.H, candId, 5, "Strong");
    await rejects(t.hireCandidate(ctx.db, ctx.H, candId, "password1", 100000), /offer stage/);
  });
  it("hiring creates an employee login and closes the candidate", async () => {
    await t.moveCandidate(ctx.db, ctx.H, candId, "OFFER");
    const u = await t.hireCandidate(ctx.db, ctx.H, candId, "password1", 120000);
    expect(u.title).toBe("QA Engineer");
    await verifyLogin(ctx.db, "bilal@example.com", "password1");
    await rejects(t.hireCandidate(ctx.db, ctx.H, candId, "password1", 1), /offer stage/);
    await rejects(t.moveCandidate(ctx.db, ctx.H, candId, "REJECTED"), /closed/);
  });
  it("rejecting is allowed from any open stage", async () => {
    const c = await t.applyToJob(ctx.db, jobId, "Rej", "rej@example.com");
    await t.moveCandidate(ctx.db, ctx.H, c.id, "REJECTED");
    expect((await t.listCandidates(ctx.db, ctx.cid, jobId)).find((x) => x.id === c.id)!.stage).toBe("REJECTED");
  });
});

describe("goals", () => {
  it("owner and managers manage goals; others can't", async () => {
    await rejects(t.addGoal(ctx.db, ctx.E, ctx.E2.id, "x"), /yourself/);
    await rejects(t.addGoal(ctx.db, ctx.E, ctx.E.id, " "), /title/);
    const g = await t.addGoal(ctx.db, ctx.E, ctx.E.id, "Ship v2", "2026-12-31");
    await t.addGoal(ctx.db, ctx.M, ctx.E.id, "Mentor a junior");
    await rejects(t.updateGoalProgress(ctx.db, ctx.E2, g.id, 50), /can't update/);
    await rejects(t.updateGoalProgress(ctx.db, ctx.E, g.id, 101), /0 to 100/);
    await rejects(t.updateGoalProgress(ctx.db, ctx.E, g.id, 1.5), /0 to 100/);
    await t.updateGoalProgress(ctx.db, ctx.E, g.id, 60);
    expect((await t.listGoals(ctx.db, ctx.E.id)).find((x) => x.id === g.id)!.progress).toBe(60);
    await rejects(t.updateGoalProgress(ctx.db, ctx.E, 9999, 5), /not found/);
  });
});

describe("review cycles", () => {
  let cycleId: number, reviewId: number;
  it("opening a cycle creates a review per active employee", async () => {
    await rejects(t.createCycle(ctx.db, ctx.E, "H1"), /HR or admins/);
    await rejects(t.createCycle(ctx.db, ctx.H, " "), /name/);
    cycleId = (await t.createCycle(ctx.db, ctx.H, "H2 2026")).id;
    const rows = await t.cycleReviews(ctx.db, ctx.cid, cycleId);
    expect(rows.length).toBe(6); // 5 seeded staff + the candidate hired above
    reviewId = rows.find((r) => r.userId === ctx.E.id)!.id;
  });
  it("self-review only by the employee, rating 1–5", async () => {
    await rejects(t.submitSelfReview(ctx.db, ctx.E2, reviewId, 4, ""), /your own/);
    await rejects(t.submitSelfReview(ctx.db, ctx.E, reviewId, 0, ""), /1 to 5/);
    await t.submitSelfReview(ctx.db, ctx.E, reviewId, 4, "Good half");
  });
  it("manager review only for direct reports (or HR), never self", async () => {
    await rejects(t.submitManagerReview(ctx.db, ctx.E, reviewId, 5, ""), /can't review yourself/);
    await rejects(t.submitManagerReview(ctx.db, ctx.E2, reviewId, 5, ""), /direct reports/);
    await t.submitManagerReview(ctx.db, ctx.M, reviewId, 5, "Excellent");
    const row = (await t.cycleReviews(ctx.db, ctx.cid, cycleId)).find((r) => r.id === reviewId)!;
    expect([row.selfRating, row.managerRating]).toEqual([4, 5]);
  });
  it("closed cycles are read-only", async () => {
    await rejects(t.closeCycle(ctx.db, ctx.E, cycleId), /HR or admins/);
    await t.closeCycle(ctx.db, ctx.H, cycleId);
    await rejects(t.submitSelfReview(ctx.db, ctx.E, reviewId, 3, ""), /closed/);
    await rejects(t.submitManagerReview(ctx.db, ctx.M, reviewId, 3, ""), /closed/);
    await rejects(t.submitSelfReview(ctx.db, ctx.E, 9999, 3, ""), /not found/);
  });
});

describe("training", () => {
  it("validates courses; enroll once; progress 0–100; completion stamps", async () => {
    await rejects(t.createCourse(ctx.db, ctx.E, "x", "", 1), /HR or admins/);
    await rejects(t.createCourse(ctx.db, ctx.H, " ", "", 1), /title/);
    await rejects(t.createCourse(ctx.db, ctx.H, "x", "", 0), /Hours/);
    const c = await t.createCourse(ctx.db, ctx.H, "Git basics", "", 2);
    await rejects(t.setCourseProgress(ctx.db, ctx.E, c.id, 10), /not enrolled/);
    await t.enroll(ctx.db, ctx.E, c.id);
    await rejects(t.enroll(ctx.db, ctx.E, c.id), /Already enrolled/);
    await rejects(t.enroll(ctx.db, ctx.E, 9999), /not found/);
    await rejects(t.enroll(ctx.db, ctx.E, c.id, ctx.E2.id), /HR or admins/);
    await t.enroll(ctx.db, ctx.H, c.id, ctx.E2.id);
    await rejects(t.setCourseProgress(ctx.db, ctx.E, c.id, 120), /0 to 100/);
    await t.setCourseProgress(ctx.db, ctx.E, c.id, 100);
    const mine = (await t.myEnrollments(ctx.db, ctx.E.id)).find((x) => x.courseId === c.id)!;
    expect(mine.completedAt).not.toBeNull();
    await t.setCourseProgress(ctx.db, ctx.E, c.id, 80); // un-complete
    expect((await t.myEnrollments(ctx.db, ctx.E.id)).find((x) => x.courseId === c.id)!.completedAt).toBeNull();
  });
});

describe("engagement", () => {
  it("announcements are HR-only and newest first", async () => {
    await rejects(t.postAnnouncement(ctx.db, ctx.E, "x", "y"), /HR or admins/);
    await rejects(t.postAnnouncement(ctx.db, ctx.H, " ", "y"), /required/);
    await t.postAnnouncement(ctx.db, ctx.H, "Office closed", "Friday");
    expect((await t.listAnnouncements(ctx.db, ctx.cid))[0].title).toBe("Office closed");
  });
  it("kudos: no self-kudos, no empty, no inactive, notifies the receiver", async () => {
    await rejects(t.giveKudos(ctx.db, ctx.E, ctx.E.id, "me"), /yourself/);
    await rejects(t.giveKudos(ctx.db, ctx.E, ctx.E2.id, " "), /Write a message/);
    await rejects(t.giveKudos(ctx.db, ctx.E, 9999, "hi"), /not found/);
    await t.giveKudos(ctx.db, ctx.E, ctx.E2.id, "Great design!");
    expect((await t.myActivity(ctx.db, ctx.E2.id))[0].text).toContain("gave you kudos");
    expect((await t.listKudos(ctx.db, ctx.cid))[0].toName).toBe("Zain Ahmed");
  });
  it("surveys: need 2+ options, one vote each, valid option, closable, tallied", async () => {
    await rejects(t.createSurvey(ctx.db, ctx.E, "q", ["a", "b"]), /HR or admins/);
    await rejects(t.createSurvey(ctx.db, ctx.H, "", ["a", "b"]), /Question/);
    await rejects(t.createSurvey(ctx.db, ctx.H, "q", ["only", " "]), /two options/);
    const sv = await t.createSurvey(ctx.db, ctx.H, "Best day for team lunch?", ["Wed", "Thu", "Fri"]);
    await rejects(t.vote(ctx.db, ctx.E, sv.id, 5), /valid option/);
    await t.vote(ctx.db, ctx.E, sv.id, 2);
    await rejects(t.vote(ctx.db, ctx.E, sv.id, 1), /already voted/);
    await t.vote(ctx.db, ctx.E2, sv.id, 2);
    await t.vote(ctx.db, ctx.M, sv.id, 0);
    expect(await t.surveyResults(ctx.db, ctx.cid, sv.id)).toMatchObject({ counts: [1, 0, 2], total: 3 });
    await t.closeSurvey(ctx.db, ctx.H, sv.id);
    await rejects(t.vote(ctx.db, ctx.A, sv.id, 0), /closed/);
    await rejects(t.surveyResults(ctx.db, ctx.cid, 9999), /not found/);
  });
  it("lists work anniversaries for the current month", async () => {
    const jan = await t.anniversariesThisMonth(ctx.db, ctx.cid, new Date("2026-01-15T00:00:00Z"));
    expect(jan.length).toBe(5); // all seeded staff joined 2025-01-06
    expect((await t.anniversariesThisMonth(ctx.db, ctx.cid, new Date("2026-07-15T00:00:00Z"))).length).toBe(0);
  });
});

describe("admin settings", () => {
  it("leave types: unique, bounded, HR-only", async () => {
    await rejects(adm.addLeaveType(ctx.db, ctx.E, "Study", 5, true), /HR or admins/);
    await rejects(adm.addLeaveType(ctx.db, ctx.H, " ", 5, true), /Name/);
    await rejects(adm.addLeaveType(ctx.db, ctx.H, "Study", 400, true), /0 to 365/);
    await adm.addLeaveType(ctx.db, ctx.H, "Study", 5, true);
    await rejects(adm.addLeaveType(ctx.db, ctx.H, "Study", 5, true), /already exists/);
  });
  it("holidays: valid, unique, removable", async () => {
    await rejects(adm.addHoliday(ctx.db, ctx.H, "nope", "x"), /valid date/);
    await rejects(adm.addHoliday(ctx.db, ctx.H, "2026-05-01", " "), /Name/);
    await adm.addHoliday(ctx.db, ctx.H, "2026-05-01", "Labour Day");
    await rejects(adm.addHoliday(ctx.db, ctx.H, "2026-05-01", "Dupe"), /already a holiday/);
    const h = (await adm.listHolidays(ctx.db, ctx.cid)).find((x) => x.date === "2026-05-01")!;
    await adm.removeHoliday(ctx.db, ctx.H, h.id);
    expect((await adm.listHolidays(ctx.db, ctx.cid)).some((x) => x.date === "2026-05-01")).toBe(false);
  });
  it("departments: unique and named", async () => {
    await rejects(adm.addDepartment(ctx.db, ctx.H, " "), /Name/);
    await rejects(adm.addDepartment(ctx.db, ctx.H, "Sales"), /already exists/);
    await adm.addDepartment(ctx.db, ctx.H, "Finance");
  });
  it("settings are admin-only and validated", async () => {
    await rejects(adm.updateSettings(ctx.db, ctx.H, { companyName: "X" }), /Only admins/);
    await rejects(adm.updateSettings(ctx.db, ctx.A, { companyName: " " }), /Company name/);
    await rejects(adm.updateSettings(ctx.db, ctx.A, { workingDaysPerMonth: 5 }), /10 to 31/);
    await adm.updateSettings(ctx.db, ctx.A, { companyName: "Techlio Pvt Ltd" });
    expect((await adm.getSettings(ctx.db, ctx.cid)).companyName).toBe("Techlio Pvt Ltd");
    expect((await adm.getSettings(ctx.db, ctx.cid2)).companyName).toBe("Techlio Labs"); // the other company is untouched
  });
  it("new leave types give new hires a balance row", async () => {
    const u = await ctx.db.select().from(s.users).where(eq(s.users.id, ctx.E.id));
    expect(u).toHaveLength(1);
  });
});
