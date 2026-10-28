import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb, rejects, at } from "./helpers";
import * as s from "@/db/schema";
import * as p from "@/server/people";
import * as adm from "@/server/admin";
import * as att from "@/server/attendance";
import * as r from "@/server/requests";
import * as pay from "@/server/payroll";
import * as t from "@/server/talent";

let ctx: Awaited<ReturnType<typeof freshDb>>;
let accountId: number;
beforeAll(async () => {
  ctx = await freshDb();
  [{ accountId }] = await ctx.db.select({ accountId: s.users.accountId }).from(s.users).where(eq(s.users.id, ctx.A.id));
});

const leaveType = async (companyId: number, name: string) =>
  (await ctx.db.select().from(s.leaveTypes).where(and(eq(s.leaveTypes.companyId, companyId), eq(s.leaveTypes.name, name))))[0].id;

describe("one account, several companies", () => {
  it("lists every company the account belongs to, with the role in each", async () => {
    const ms = await p.memberships(ctx.db, accountId);
    expect(ms.map((m) => m.company).sort()).toEqual(["Techlio", "Techlio Labs"]);
    expect(ms.every((m) => m.role === "ADMIN")).toBe(true);
  });
  it("login picks a membership and returns the account", async () => {
    const l = await p.verifyLogin(ctx.db, "admin@techlio.co", "Techlio@123");
    expect(l.accountId).toBe(accountId);
    expect([ctx.cid, ctx.cid2]).toContain(l.actor.companyId);
  });
  it("switching only works into companies where the account has an active record", async () => {
    expect((await p.membershipIn(ctx.db, accountId, ctx.cid2))!.id).toBe(ctx.A2.id);
    expect(await p.membershipIn(ctx.db, accountId, 99999)).toBeNull();
    const [other] = await ctx.db.select().from(s.accounts).where(eq(s.accounts.email, "noor@labs.example"));
    expect(await p.membershipIn(ctx.db, other.id, ctx.cid)).toBeNull(); // Noor isn't in Techlio
  });
  it("a session is only valid for its own account's record, and only while active", async () => {
    expect((await p.resolveActor(ctx.db, ctx.A2.id, accountId))!.companyId).toBe(ctx.cid2);
    expect(await p.resolveActor(ctx.db, ctx.N.id, accountId)).toBeNull(); // someone else's record
    expect(await p.resolveActor(ctx.db, 99999, accountId)).toBeNull();
  });
  it("role changes apply on the next request, because the role is read from the database", async () => {
    await p.updateEmployee(ctx.db, ctx.A, ctx.E2.id, { role: "MANAGER" });
    expect((await p.resolveActor(ctx.db, ctx.E2.id, (await ctx.db.select().from(s.users).where(eq(s.users.id, ctx.E2.id)))[0].accountId))!.role).toBe("MANAGER");
    await p.updateEmployee(ctx.db, ctx.A, ctx.E2.id, { role: "EMPLOYEE" });
  });
  it("deactivation locks out a live session immediately, in that company only", async () => {
    const u = await p.createEmployee(ctx.db, ctx.H, { name: "Dual Hat", email: "dual@example.com", password: "password1" });
    const u2 = await p.createEmployee(ctx.db, ctx.A2, { name: "Dual Hat", email: "dual@example.com", password: "ignored-for-existing-account" });
    expect(u.accountId).toBe(u2.accountId); // one login, two employee records
    await p.setActive(ctx.db, ctx.H, u.id, false);
    expect(await p.resolveActor(ctx.db, u.id, u.accountId)).toBeNull();
    expect(await p.resolveActor(ctx.db, u2.id, u.accountId)).not.toBeNull();
    expect((await p.verifyLogin(ctx.db, "dual@example.com", "password1")).actor.companyId).toBe(ctx.cid2);
    await p.setActive(ctx.db, ctx.A2, u2.id, false);
    await rejects(p.verifyLogin(ctx.db, "dual@example.com", "password1"), /deactivated/);
  });
  it("one password for the whole account", async () => {
    await p.changePassword(ctx.db, ctx.A2, "Techlio@123", "Changed@456");
    expect((await p.verifyLogin(ctx.db, "admin@techlio.co", "Changed@456")).accountId).toBe(accountId);
    await p.changePassword(ctx.db, ctx.A, "Changed@456", "Techlio@123");
  });
  it("the same email can't be added twice to one company", async () => {
    await rejects(p.createEmployee(ctx.db, ctx.A2, { name: "Dup", email: "noor@labs.example", password: "password1" }), /already exists/);
  });
});

describe("creating companies", () => {
  it("only admins can, and the creator becomes its admin with default setup", async () => {
    await rejects(adm.createCompany(ctx.db, ctx.H, "Nope Ltd"), /Only admins/);
    await rejects(adm.createCompany(ctx.db, ctx.A, "  "), /required/);
    await rejects(adm.createCompany(ctx.db, ctx.A, "x".repeat(81)), /too long/);
    const made = await adm.createCompany(ctx.db, ctx.A, "Fresh Start Ltd");
    const act = (await p.resolveActor(ctx.db, made.userId, accountId))!;
    expect([act.role, act.companyId]).toEqual(["ADMIN", made.companyId]);
    expect((await adm.listLeaveTypes(ctx.db, made.companyId)).map((x) => x.name)).toEqual(["Annual", "Sick", "Casual", "Unpaid"]);
    expect(await adm.listShifts(ctx.db, made.companyId)).toHaveLength(2);
    expect((await p.directory(ctx.db, made.companyId)).map((x) => x.name)).toEqual(["Hassan Bajwa"]);
    expect((await p.memberships(ctx.db, accountId)).length).toBe(3);
    expect((await r.balances(ctx.db, made.userId, new Date().getFullYear())).length).toBe(4);
  });
  it("two companies with the same name get distinct slugs", async () => {
    await adm.createCompany(ctx.db, ctx.A, "Twin Co");
    await adm.createCompany(ctx.db, ctx.A, "Twin Co");
    const slugs = (await ctx.db.select().from(s.companies)).filter((c) => c.name === "Twin Co").map((c) => c.slug);
    expect(new Set(slugs).size).toBe(2);
  });
});

describe("people stay inside their company", () => {
  it("directory, org chart, onboarding and profile lookups", async () => {
    expect((await p.directory(ctx.db, ctx.cid, "Noor")).length).toBe(0);
    expect((await p.directory(ctx.db, ctx.cid2, "Noor")).length).toBe(1);
    expect((await p.directory(ctx.db, ctx.cid2)).map((x) => x.name).sort()).toEqual(expect.arrayContaining(["Hassan Bajwa", "Noor Fatima"]));
    expect(await p.getEmployee(ctx.db, ctx.cid, ctx.N.id)).toBeNull();
    expect(await p.getEmployee(ctx.db, ctx.cid2, ctx.N.id)).not.toBeNull();
    const roots = await p.orgChart(ctx.db, ctx.cid2);
    expect(roots.map((n) => n.id)).toEqual([ctx.A2.id]);
    expect((await p.onboardingOverview(ctx.db, ctx.cid)).some((o) => o.userId === ctx.N.id)).toBe(false);
  });
  it("HR in one company can't touch another company's employees", async () => {
    await rejects(p.updateEmployee(ctx.db, ctx.H, ctx.N.id, { title: "Hacked" }), /not found/);
    await rejects(p.setActive(ctx.db, ctx.H, ctx.N.id, false), /not found/);
    await rejects(p.addDocument(ctx.db, ctx.H, ctx.N.id, "x", "ID", "https://x.co"), /not found/);
    await rejects(p.addTask(ctx.db, ctx.H, ctx.N.id, "x"), /not found/);
    await rejects(pay.setSalary(ctx.db, ctx.H, ctx.N.id, 1), /not found/);
    await rejects(pay.finalSettlement(ctx.db, ctx.H, ctx.N.id, "2027-04-15"), /not found/);
    const [task] = await p.listTasks(ctx.db, ctx.N.id);
    await rejects(p.toggleTask(ctx.db, ctx.H, task.id), /not found/);
    await rejects(p.updateEmployee(ctx.db, ctx.H, ctx.E.id, { managerId: ctx.N.id }), /not found/); // can't report to another company
    await rejects(p.createEmployee(ctx.db, ctx.H, { name: "X", email: "x@x.co", password: "password1", managerId: ctx.N.id }), /Manager not found/);
  });
  it("departments and shifts from another company can't be assigned", async () => {
    const [d2] = await ctx.db.insert(s.departments).values({ companyId: ctx.cid2, name: "Labs only" }).returning();
    await rejects(p.updateEmployee(ctx.db, ctx.H, ctx.E.id, { departmentId: d2.id }), /Department not found/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { name: "X", email: "y@x.co", password: "password1", departmentId: d2.id }), /Department not found/);
  });
  it("assets are per company; tags can repeat across companies", async () => {
    await rejects(p.createAsset(ctx.db, ctx.H, "LAP-001", "dupe", "Laptop"), /already exists/);
    const a2 = await p.createAsset(ctx.db, ctx.A2, "LAP-001", "Labs laptop", "Laptop");
    await rejects(p.assignAsset(ctx.db, ctx.H, a2.id, ctx.E.id), /Asset not found/);
    const [mine] = await p.listAssets(ctx.db, ctx.cid);
    await rejects(p.assignAsset(ctx.db, ctx.H, mine.id, ctx.N.id), /not found/);
    expect((await p.listAssets(ctx.db, ctx.cid2)).map((a) => a.name)).toEqual(["Labs laptop"]);
    expect((await p.listAssets(ctx.db, ctx.cid)).some((a) => a.name === "Labs laptop")).toBe(false);
  });
});

describe("settings, leave types and holidays are per company", () => {
  it("each company has its own currency and tax rate", async () => {
    expect((await adm.getSettings(ctx.db, ctx.cid2)).currency).toBe("USD");
    expect((await adm.getSettings(ctx.db, ctx.cid)).currency).toBe("PKR");
    await adm.updateSettings(ctx.db, ctx.A2, { taxRate: 0.2 });
    expect((await adm.getSettings(ctx.db, ctx.cid)).taxRate).toBe(0.05);
    await adm.updateSettings(ctx.db, ctx.A2, { taxRate: 0.1 });
  });
  it("a leave type is invisible and unusable in another company", async () => {
    await adm.addLeaveType(ctx.db, ctx.A2, "Research", 5, true);
    expect((await adm.listLeaveTypes(ctx.db, ctx.cid)).some((x) => x.name === "Research")).toBe(false);
    const research = await leaveType(ctx.cid2, "Research");
    await rejects(r.applyLeave(ctx.db, ctx.E, { leaveTypeId: research, startDate: "2027-02-01", endDate: "2027-02-02", reason: "" }), /Leave type not found/);
    await adm.addLeaveType(ctx.db, ctx.H, "Research", 3, true); // same name is fine in another company
  });
  it("holidays only affect their own company's working-day count", async () => {
    await adm.addHoliday(ctx.db, ctx.A2, "2027-03-03", "Labs day");
    expect(await r.workingDays(ctx.db, ctx.cid2, "2027-03-01", "2027-03-05")).toBe(4);
    expect(await r.workingDays(ctx.db, ctx.cid, "2027-03-01", "2027-03-05")).toBe(5);
    await adm.addHoliday(ctx.db, ctx.H, "2027-03-03", "Same date, other company"); // allowed
    await rejects(adm.addHoliday(ctx.db, ctx.H, "2027-03-03", "Again"), /already a holiday/);
    const h2 = (await adm.listHolidays(ctx.db, ctx.cid2)).find((h) => h.date === "2027-03-03")!;
    await adm.removeHoliday(ctx.db, ctx.H, h2.id); // HR of another company: silently removes nothing
    expect((await adm.listHolidays(ctx.db, ctx.cid2)).some((h) => h.id === h2.id)).toBe(true);
  });
  it("departments are per company too", async () => {
    await adm.addDepartment(ctx.db, ctx.A2, "Sales"); // exists in Techlio, not in Labs
    expect((await adm.listDepartments(ctx.db, ctx.cid2)).map((d) => d.name)).toContain("Sales");
  });
});

describe("requests never cross companies", () => {
  let req: number;
  beforeAll(async () => {
    const annual2 = await leaveType(ctx.cid2, "Annual");
    req = (await r.applyLeave(ctx.db, ctx.N, { leaveTypeId: annual2, startDate: "2027-02-01", endDate: "2027-02-02", reason: "Labs trip" })).id;
  });
  it("it reaches its own company's approver and nobody else's inbox", async () => {
    expect((await r.inbox(ctx.db, ctx.A2)).some((x) => x.id === req)).toBe(true);
    expect((await r.inbox(ctx.db, ctx.H)).some((x) => x.id === req)).toBe(false);
    expect((await r.inbox(ctx.db, ctx.A)).some((x) => x.id === req)).toBe(false);
  });
  it("HR and admins elsewhere can neither view nor decide it", async () => {
    await rejects(r.decide(ctx.db, ctx.H, req, true), /not allowed/);
    await rejects(r.decide(ctx.db, ctx.A, req, true), /not allowed/);
    await rejects(r.getRequest(ctx.db, ctx.H, req), /can't view/);
    await rejects(r.getRequest(ctx.db, ctx.A, req), /can't view/);
    await r.getRequest(ctx.db, ctx.A2, req);
  });
  it("tickets stay private too", async () => {
    const tk = await r.openTicket(ctx.db, ctx.N, { subject: "Wifi", category: "IT", reason: "Down" });
    await rejects(r.commentOnTicket(ctx.db, ctx.H, tk.id, "hi"), /can't comment/);
    await rejects(r.decide(ctx.db, ctx.H, tk.id, true), /not allowed/);
    expect((await r.allTickets(ctx.db, ctx.cid)).some((x) => x.id === tk.id)).toBe(false);
    expect((await r.allTickets(ctx.db, ctx.cid2)).some((x) => x.id === tk.id)).toBe(true);
  });
  it("the company's own admin can approve, and balances update", async () => {
    await r.decide(ctx.db, ctx.A2, req, true);
    expect((await r.balances(ctx.db, ctx.N.id, 2027)).find((b) => b.name === "Annual")!.used).toBe(2);
    expect((await r.balances(ctx.db, ctx.E.id, 2027)).find((b) => b.name === "Annual")!.used).toBe(0);
  });
  it("'who is away today' is per company", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const w = await r.applyWfh(ctx.db, ctx.N, { startDate: today, endDate: today, reason: "" }).catch(() => null);
    if (w) {
      await r.decide(ctx.db, ctx.A2, w.id, true);
      expect((await r.teamOnLeaveToday(ctx.db, ctx.cid2)).map((x) => x.name)).toContain("Noor Fatima");
      expect((await r.teamOnLeaveToday(ctx.db, ctx.cid)).map((x) => x.name)).not.toContain("Noor Fatima");
    }
  });
});

describe("attendance and shifts", () => {
  it("shifts and employees from another company can't be mixed", async () => {
    const sh2 = await att.createShift(ctx.db, ctx.A2, "Labs shift", "10:00", "19:00", 10);
    const [sh1] = await adm.listShifts(ctx.db, ctx.cid);
    await rejects(att.assignShift(ctx.db, ctx.H, [ctx.E.id], sh2.id), /Shift not found/);
    await rejects(att.assignShift(ctx.db, ctx.H, [ctx.N.id], sh1.id), /Employee not found/);
    await att.assignShift(ctx.db, ctx.A2, [ctx.N.id], sh2.id);
    expect((await att.checkIn(ctx.db, ctx.N, at("2027-02-09", "10:11"))).late).toBe(true); // 10:00 + 10 min grace
  });
  it("who's in and the schedule only show your own company", async () => {
    const day = "2027-02-09";
    expect((await att.whosIn(ctx.db, ctx.cid2, at(day, "12:00"))).map((x) => x.name)).toEqual(["Noor Fatima"]);
    expect(await att.whosIn(ctx.db, ctx.cid, at(day, "12:00"))).toHaveLength(0);
    const w1 = await att.weekSchedule(ctx.db, ctx.cid, "2027-02-08");
    expect(w1.rows.map((x) => x.name)).not.toContain("Noor Fatima");
    expect((await att.weekSchedule(ctx.db, ctx.cid2, "2027-02-08")).rows.map((x) => x.name)).toContain("Noor Fatima");
  });
});

describe("payroll is separate per company", () => {
  it("each company runs the same month independently, in its own currency and tax", async () => {
    const run1 = await pay.runPayroll(ctx.db, ctx.H, "2027-04");
    const run2 = await pay.runPayroll(ctx.db, ctx.A2, "2027-04");
    expect(run1.id).not.toBe(run2.id);
    expect((await pay.runDetail(ctx.db, ctx.H, run1.id)).length).toBe(5);
    const labs = await pay.runDetail(ctx.db, ctx.A2, run2.id);
    expect(labs.map((x) => x.name).sort()).toEqual(["Hassan Bajwa", "Noor Fatima"]);
    const noor = labs.find((x) => x.name === "Noor Fatima")!;
    expect([noor.gross, noor.tax, noor.net]).toEqual([3000, 300, 2700]); // Labs: 10% tax
    expect((await pay.listRuns(ctx.db, ctx.cid)).map((x) => x.id)).toEqual([run1.id]);
  });
  it("runs and payslips of another company are off limits", async () => {
    const [run2] = await pay.listRuns(ctx.db, ctx.cid2);
    await rejects(pay.runDetail(ctx.db, ctx.H, run2.id), /not found/);
    await rejects(pay.finalizeRun(ctx.db, ctx.H, run2.id), /not found/);
    const [slip] = await ctx.db.select().from(s.payslips).where(eq(s.payslips.runId, run2.id));
    await rejects(pay.getPayslip(ctx.db, ctx.H, slip.id), /can't view/);
    await rejects(pay.getPayslip(ctx.db, ctx.A, slip.id), /can't view/);
    await pay.getPayslip(ctx.db, ctx.A2, slip.id);
  });
  it("salary lists don't leak", async () => {
    expect((await pay.listSalaries(ctx.db, ctx.cid)).some((x) => x.name === "Noor Fatima")).toBe(false);
  });
});

describe("recruitment, performance, training and engagement", () => {
  it("jobs and candidates belong to one company; the public page shows all with company names", async () => {
    const job2 = await t.createJob(ctx.db, ctx.A2, { title: "Researcher" });
    const cand = await t.applyToJob(ctx.db, job2.id, "Sam", "sam@example.com");
    await rejects(t.moveCandidate(ctx.db, ctx.H, cand.id, "SCREENING"), /Candidate not found/);
    await rejects(t.rateCandidate(ctx.db, ctx.H, cand.id, 4, ""), /Candidate not found/);
    await rejects(t.hireCandidate(ctx.db, ctx.H, cand.id, "password1", 1), /Candidate not found/);
    await t.moveCandidate(ctx.db, ctx.A2, cand.id, "SCREENING");
    expect((await t.listCandidates(ctx.db, ctx.cid, job2.id))).toHaveLength(0);
    expect((await t.listCandidates(ctx.db, ctx.cid2, job2.id))).toHaveLength(1);
    expect((await t.listJobs(ctx.db, ctx.cid)).some((j) => j.id === job2.id)).toBe(false);
    await t.setJobOpen(ctx.db, ctx.H, job2.id, false); // HR of another company: a no-op
    expect((await t.listJobs(ctx.db, ctx.cid2, true)).some((j) => j.id === job2.id)).toBe(true);
    const pub = await t.listOpenJobsPublic(ctx.db);
    expect(pub.map((j) => j.company)).toEqual(expect.arrayContaining(["Techlio", "Techlio Labs"]));
    const [d2] = await adm.listDepartments(ctx.db, ctx.cid2);
    await rejects(t.createJob(ctx.db, ctx.H, { title: "x", departmentId: d2.id }), /Department not found/);
  });
  it("a hire lands in the hiring company, linking an existing account when the email is known", async () => {
    const job = (await t.listJobs(ctx.db, ctx.cid))[0];
    const c = await t.applyToJob(ctx.db, job.id, "Noor Fatima", "noor@labs.example");
    await t.moveCandidate(ctx.db, ctx.H, c.id, "OFFER");
    const u = await t.hireCandidate(ctx.db, ctx.H, c.id, "irrelevant1", 90000);
    expect(u.companyId).toBe(ctx.cid);
    const [noor] = await ctx.db.select().from(s.users).where(eq(s.users.id, ctx.N.id));
    expect(u.accountId).toBe(noor.accountId); // the same login Noor already uses in Labs
    expect((await p.memberships(ctx.db, noor.accountId)).map((m) => m.company).sort()).toEqual(["Techlio", "Techlio Labs"]);
  });
  it("review cycles, goals and reviews are per company", async () => {
    const c1 = await t.createCycle(ctx.db, ctx.H, "Cycle A");
    expect((await t.cycleReviews(ctx.db, ctx.cid, c1.id)).some((x) => x.userId === ctx.N.id)).toBe(false);
    expect(await t.cycleReviews(ctx.db, ctx.cid2, c1.id)).toHaveLength(0);
    const c2 = await t.createCycle(ctx.db, ctx.A2, "Cycle B");
    const [nr] = (await t.cycleReviews(ctx.db, ctx.cid2, c2.id)).filter((x) => x.userId === ctx.N.id);
    await rejects(t.submitManagerReview(ctx.db, ctx.M, nr.id, 4, ""), /Review not found/);
    await t.closeCycle(ctx.db, ctx.H, c2.id); // HR of another company: a no-op
    expect((await ctx.db.select().from(s.reviewCycles).where(eq(s.reviewCycles.id, c2.id)))[0].open).toBe(true);
    const g = await t.addGoal(ctx.db, ctx.N, ctx.N.id, "Publish paper");
    await rejects(t.updateGoalProgress(ctx.db, ctx.M, g.id, 50), /Goal not found/);
    await rejects(t.addGoal(ctx.db, ctx.M, ctx.N.id, "x"), /not found/);
  });
  it("courses, announcements, polls and kudos stay inside", async () => {
    const course = await t.createCourse(ctx.db, ctx.A2, "Labs 101", "", 1);
    await rejects(t.enroll(ctx.db, ctx.E, course.id), /Course not found/);
    await t.postAnnouncement(ctx.db, ctx.A2, "Labs only", "private");
    expect((await t.listAnnouncements(ctx.db, ctx.cid)).some((a) => a.title === "Labs only")).toBe(false);
    expect((await t.listAnnouncements(ctx.db, ctx.cid2)).map((a) => a.title)).toContain("Labs only");
    const sv = await t.createSurvey(ctx.db, ctx.A2, "Labs poll?", ["a", "b"]);
    await rejects(t.vote(ctx.db, ctx.E, sv.id, 0), /closed/);
    await rejects(t.surveyResults(ctx.db, ctx.cid, sv.id), /not found/);
    expect((await t.listSurveys(ctx.db, ctx.cid)).some((x) => x.id === sv.id)).toBe(false);
    await rejects(t.giveKudos(ctx.db, ctx.E, ctx.N.id, "hi"), /not found/);
    expect((await t.listCourses(ctx.db, ctx.cid)).some((c) => c.id === course.id)).toBe(false);
    expect((await t.anniversariesThisMonth(ctx.db, ctx.cid2, new Date("2026-06-15T00:00:00Z"))).map((x) => x.name)).toEqual(expect.arrayContaining(["Noor Fatima"]));
    expect((await t.anniversariesThisMonth(ctx.db, ctx.cid, new Date("2026-06-15T00:00:00Z")))).toHaveLength(0);
  });
});
