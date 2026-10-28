import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { type Actor, fail, isHR, isManagerish, requireHR, toLocalDate } from "./core";
import { createEmployee, logActivity, userInCompany } from "./people";

// ---------- Recruitment ----------
export const STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;
type Stage = (typeof STAGES)[number];

export async function createJob(db: DB, actor: Actor, i: { title: string; departmentId?: number | null; location?: string; description?: string }) {
  requireHR(actor);
  if (!i.title.trim()) fail("Job title is required.");
  if (i.departmentId) {
    const [d] = await db.select({ id: s.departments.id }).from(s.departments).where(and(eq(s.departments.id, i.departmentId), eq(s.departments.companyId, actor.companyId)));
    if (!d) fail("Department not found.");
  }
  const [j] = await db.insert(s.jobs).values({ companyId: actor.companyId, title: i.title.trim(), departmentId: i.departmentId ?? null, location: i.location || "Onsite", description: i.description ?? "" }).returning();
  return j;
}
export async function setJobOpen(db: DB, actor: Actor, id: number, open: boolean) {
  requireHR(actor);
  await db.update(s.jobs).set({ open }).where(and(eq(s.jobs.id, id), eq(s.jobs.companyId, actor.companyId)));
}
export const listJobs = (db: DB, companyId: number, onlyOpen = false) =>
  db.select({ id: s.jobs.id, title: s.jobs.title, location: s.jobs.location, open: s.jobs.open, department: s.departments.name,
    candidates: sql<number>`(select count(*)::int from ${s.candidates} where ${s.candidates.jobId} = ${s.jobs.id})` })
    .from(s.jobs).leftJoin(s.departments, eq(s.jobs.departmentId, s.departments.id))
    .where(and(eq(s.jobs.companyId, companyId), onlyOpen ? eq(s.jobs.open, true) : undefined)).orderBy(desc(s.jobs.createdAt));

/** Open jobs across every company, for the public careers page. */
export const listOpenJobsPublic = (db: DB) =>
  db.select({ id: s.jobs.id, title: s.jobs.title, location: s.jobs.location, department: s.departments.name, company: s.companies.name })
    .from(s.jobs).innerJoin(s.companies, eq(s.jobs.companyId, s.companies.id)).leftJoin(s.departments, eq(s.jobs.departmentId, s.departments.id))
    .where(eq(s.jobs.open, true)).orderBy(asc(s.companies.name), desc(s.jobs.createdAt));

/** Public career-page application; no login needed. */
export async function applyToJob(db: DB, jobId: number, name: string, email: string) {
  const [j] = await db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
  if (!j || !j.open) fail("This job isn't accepting applications.");
  if (!name.trim()) fail("Name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Enter a valid email.");
  const [dupe] = await db.select().from(s.candidates).where(and(eq(s.candidates.jobId, jobId), eq(s.candidates.email, email.toLowerCase())));
  if (dupe) fail("You've already applied for this job.");
  const [c] = await db.insert(s.candidates).values({ jobId, name: name.trim(), email: email.toLowerCase() }).returning();
  return c;
}

const ORDER: Stage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED"];

/** A candidate, only if their job belongs to the actor's company. */
async function candidateIn(db: DB, actor: Actor, id: number) {
  const [row] = await db.select({ c: s.candidates, job: s.jobs }).from(s.candidates).innerJoin(s.jobs, eq(s.candidates.jobId, s.jobs.id))
    .where(and(eq(s.candidates.id, id), eq(s.jobs.companyId, actor.companyId)));
  if (!row) fail("Candidate not found.");
  return row!;
}

export async function moveCandidate(db: DB, actor: Actor, id: number, stage: Stage) {
  requireHR(actor);
  const { c } = await candidateIn(db, actor, id);
  if (c!.stage === "HIRED" || c!.stage === "REJECTED") fail("This candidate's process is already closed.");
  if (stage === "HIRED") fail("Use 'Hire' to convert a candidate into an employee.");
  if (stage !== "REJECTED" && ORDER.indexOf(stage) < ORDER.indexOf(c!.stage as Stage)) fail("Candidates can't move backwards.");
  await db.update(s.candidates).set({ stage }).where(eq(s.candidates.id, id));
}
export async function rateCandidate(db: DB, actor: Actor, id: number, rating: number, notes: string) {
  requireHR(actor);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail("Rating must be 1 to 5.");
  await candidateIn(db, actor, id);
  await db.update(s.candidates).set({ rating, notes }).where(eq(s.candidates.id, id));
}
export async function hireCandidate(db: DB, actor: Actor, id: number, password: string, basic: number) {
  requireHR(actor);
  const { c, job } = await candidateIn(db, actor, id);
  if (c.stage !== "OFFER") fail("Only candidates at the offer stage can be hired.");
  const u = await createEmployee(db, actor, { name: c.name, email: c.email, password, title: job.title, departmentId: job.departmentId, basic });
  await db.update(s.candidates).set({ stage: "HIRED", hiredUserId: u.id }).where(eq(s.candidates.id, id));
  return u;
}
export const listCandidates = (db: DB, companyId: number, jobId: number) =>
  db.select({ c: s.candidates }).from(s.candidates).innerJoin(s.jobs, eq(s.candidates.jobId, s.jobs.id))
    .where(and(eq(s.candidates.jobId, jobId), eq(s.jobs.companyId, companyId))).orderBy(asc(s.candidates.createdAt)).then((rows) => rows.map((r) => r.c));

// ---------- Performance ----------
export async function addGoal(db: DB, actor: Actor, userId: number, title: string, dueDate?: string) {
  if (!isManagerish(actor) && actor.id !== userId) fail("You can only add goals for yourself.");
  await userInCompany(db, actor.companyId, userId);
  if (!title.trim()) fail("Goal title is required.");
  const [g] = await db.insert(s.goals).values({ userId, title: title.trim(), dueDate: dueDate || null }).returning();
  return g;
}
export async function updateGoalProgress(db: DB, actor: Actor, id: number, progress: number) {
  const [row] = await db.select({ g: s.goals, companyId: s.users.companyId }).from(s.goals).innerJoin(s.users, eq(s.goals.userId, s.users.id)).where(eq(s.goals.id, id));
  if (!row || row.companyId !== actor.companyId) fail("Goal not found.");
  const g = row!.g;
  if (!isManagerish(actor) && g.userId !== actor.id) fail("You can't update this goal.");
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail("Progress must be 0 to 100.");
  await db.update(s.goals).set({ progress }).where(eq(s.goals.id, id));
}
export const listGoals = (db: DB, userId: number) => db.select().from(s.goals).where(eq(s.goals.userId, userId)).orderBy(asc(s.goals.id));

export async function createCycle(db: DB, actor: Actor, name: string) {
  requireHR(actor);
  if (!name.trim()) fail("Cycle name is required.");
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(s.reviewCycles).values({ companyId: actor.companyId, name: name.trim() }).returning();
    const staff = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.companyId, actor.companyId), eq(s.users.active, true)));
    if (staff.length) await tx.insert(s.reviews).values(staff.map((u) => ({ cycleId: c.id, userId: u.id })));
    return c;
  });
}
export async function closeCycle(db: DB, actor: Actor, id: number) {
  requireHR(actor);
  await db.update(s.reviewCycles).set({ open: false }).where(and(eq(s.reviewCycles.id, id), eq(s.reviewCycles.companyId, actor.companyId)));
}
async function openReview(db: DB, actor: Actor, id: number) {
  const [r] = await db.select().from(s.reviews).where(eq(s.reviews.id, id));
  if (!r) fail("Review not found.");
  const [c] = await db.select().from(s.reviewCycles).where(eq(s.reviewCycles.id, r!.cycleId));
  if (c!.companyId !== actor.companyId) fail("Review not found.");
  if (!c!.open) fail("This review cycle is closed.");
  return r!;
}
const checkRating = (n: number) => { if (!Number.isInteger(n) || n < 1 || n > 5) fail("Rating must be 1 to 5."); };

export async function submitSelfReview(db: DB, actor: Actor, reviewId: number, rating: number, comment: string) {
  const r = await openReview(db, actor, reviewId);
  if (r.userId !== actor.id) fail("You can only submit your own self-review.");
  checkRating(rating);
  await db.update(s.reviews).set({ selfRating: rating, selfComment: comment }).where(eq(s.reviews.id, reviewId));
}
export async function submitManagerReview(db: DB, actor: Actor, reviewId: number, rating: number, comment: string) {
  const r = await openReview(db, actor, reviewId);
  if (r.userId === actor.id) fail("You can't review yourself as a manager.");
  const [u] = await db.select({ m: s.users.managerId }).from(s.users).where(eq(s.users.id, r.userId));
  if (!isHR(actor) && u?.m !== actor.id) fail("You can only review your direct reports.");
  checkRating(rating);
  await db.update(s.reviews).set({ managerRating: rating, managerComment: comment }).where(eq(s.reviews.id, reviewId));
  await logActivity(db, r.userId, "star", "Your manager submitted your performance review");
}
export const listCycles = (db: DB, companyId: number) => db.select().from(s.reviewCycles).where(eq(s.reviewCycles.companyId, companyId)).orderBy(desc(s.reviewCycles.createdAt));
export const cycleReviews = (db: DB, companyId: number, cycleId: number) =>
  db.select({ id: s.reviews.id, userId: s.reviews.userId, name: s.users.name, selfRating: s.reviews.selfRating, managerRating: s.reviews.managerRating, managerId: s.users.managerId })
    .from(s.reviews).innerJoin(s.users, eq(s.reviews.userId, s.users.id)).innerJoin(s.reviewCycles, eq(s.reviews.cycleId, s.reviewCycles.id))
    .where(and(eq(s.reviews.cycleId, cycleId), eq(s.reviewCycles.companyId, companyId), eq(s.users.companyId, companyId))).orderBy(asc(s.users.name));

// ---------- Training ----------
export async function createCourse(db: DB, actor: Actor, title: string, description: string, hours: number) {
  requireHR(actor);
  if (!title.trim()) fail("Course title is required.");
  if (!Number.isInteger(hours) || hours < 1) fail("Hours must be at least 1.");
  const [c] = await db.insert(s.courses).values({ companyId: actor.companyId, title: title.trim(), description, hours }).returning();
  return c;
}
export async function enroll(db: DB, actor: Actor, courseId: number, userId = actor.id) {
  if (userId !== actor.id) requireHR(actor);
  const [c] = await db.select().from(s.courses).where(and(eq(s.courses.id, courseId), eq(s.courses.companyId, actor.companyId)));
  if (!c) fail("Course not found.");
  await userInCompany(db, actor.companyId, userId);
  const [dupe] = await db.select().from(s.enrollments).where(and(eq(s.enrollments.courseId, courseId), eq(s.enrollments.userId, userId)));
  if (dupe) fail("Already enrolled in this course.");
  await db.insert(s.enrollments).values({ courseId, userId });
}
export async function setCourseProgress(db: DB, actor: Actor, courseId: number, progress: number) {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail("Progress must be 0 to 100.");
  const [e] = await db.select().from(s.enrollments).where(and(eq(s.enrollments.courseId, courseId), eq(s.enrollments.userId, actor.id)));
  if (!e) fail("You're not enrolled in this course.");
  await db.update(s.enrollments).set({ progress, completedAt: progress === 100 ? new Date() : null }).where(eq(s.enrollments.id, e!.id));
  if (progress === 100) await logActivity(db, actor.id, "certificate", "You completed a course");
}
export const listCourses = (db: DB, companyId: number) => db.select().from(s.courses).where(eq(s.courses.companyId, companyId)).orderBy(asc(s.courses.id));
export const myEnrollments = (db: DB, userId: number) =>
  db.select({ courseId: s.enrollments.courseId, title: s.courses.title, hours: s.courses.hours, progress: s.enrollments.progress, completedAt: s.enrollments.completedAt })
    .from(s.enrollments).innerJoin(s.courses, eq(s.enrollments.courseId, s.courses.id)).where(eq(s.enrollments.userId, userId));

// ---------- Engagement ----------
export async function postAnnouncement(db: DB, actor: Actor, title: string, body: string) {
  requireHR(actor);
  if (!title.trim() || !body.trim()) fail("Title and message are required.");
  await db.insert(s.announcements).values({ companyId: actor.companyId, title: title.trim(), body: body.trim(), authorId: actor.id });
}
export const listAnnouncements = (db: DB, companyId: number, limit = 10) =>
  db.select({ id: s.announcements.id, title: s.announcements.title, body: s.announcements.body, author: s.users.name, createdAt: s.announcements.createdAt })
    .from(s.announcements).innerJoin(s.users, eq(s.announcements.authorId, s.users.id)).where(eq(s.announcements.companyId, companyId))
    .orderBy(desc(s.announcements.createdAt), desc(s.announcements.id)).limit(limit);

export async function giveKudos(db: DB, actor: Actor, toId: number, message: string) {
  if (toId === actor.id) fail("You can't give kudos to yourself.");
  if (!message.trim()) fail("Write a message.");
  const u = await userInCompany(db, actor.companyId, toId);
  if (!u.active) fail("Employee not found.");
  await db.insert(s.kudos).values({ fromId: actor.id, toId, message: message.trim() });
  await logActivity(db, toId, "heart", `${actor.name} gave you kudos`);
}
export const listKudos = (db: DB, companyId: number, limit = 10) =>
  db.select({ id: s.kudos.id, message: s.kudos.message, toName: s.users.name, createdAt: s.kudos.createdAt, fromId: s.kudos.fromId })
    .from(s.kudos).innerJoin(s.users, eq(s.kudos.toId, s.users.id)).where(eq(s.users.companyId, companyId))
    .orderBy(desc(s.kudos.createdAt), desc(s.kudos.id)).limit(limit);

export async function createSurvey(db: DB, actor: Actor, question: string, options: string[]) {
  requireHR(actor);
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (!question.trim()) fail("Question is required.");
  if (opts.length < 2) fail("Add at least two options.");
  const [sv] = await db.insert(s.surveys).values({ companyId: actor.companyId, question: question.trim(), options: opts }).returning();
  return sv;
}
export async function vote(db: DB, actor: Actor, surveyId: number, optionIndex: number) {
  const [sv] = await db.select().from(s.surveys).where(and(eq(s.surveys.id, surveyId), eq(s.surveys.companyId, actor.companyId)));
  if (!sv || !sv.active) fail("This survey is closed.");
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= sv!.options.length) fail("Pick a valid option.");
  const [dupe] = await db.select().from(s.surveyVotes).where(and(eq(s.surveyVotes.surveyId, surveyId), eq(s.surveyVotes.userId, actor.id)));
  if (dupe) fail("You've already voted.");
  await db.insert(s.surveyVotes).values({ surveyId, userId: actor.id, optionIndex });
}
export async function closeSurvey(db: DB, actor: Actor, id: number) {
  requireHR(actor);
  await db.update(s.surveys).set({ active: false }).where(and(eq(s.surveys.id, id), eq(s.surveys.companyId, actor.companyId)));
}
export async function surveyResults(db: DB, companyId: number, surveyId: number) {
  const [sv] = await db.select().from(s.surveys).where(and(eq(s.surveys.id, surveyId), eq(s.surveys.companyId, companyId)));
  if (!sv) fail("Survey not found.");
  const rows = await db.select({ i: s.surveyVotes.optionIndex, n: sql<number>`count(*)::int` }).from(s.surveyVotes).where(eq(s.surveyVotes.surveyId, surveyId)).groupBy(s.surveyVotes.optionIndex);
  const counts = sv!.options.map((_, i) => rows.find((r) => r.i === i)?.n ?? 0);
  return { question: sv!.question, options: sv!.options, counts, total: counts.reduce((a, b) => a + b, 0) };
}
export const listSurveys = (db: DB, companyId: number) => db.select().from(s.surveys).where(eq(s.surveys.companyId, companyId)).orderBy(desc(s.surveys.id));

export const myActivity = (db: DB, userId: number, limit = 6) =>
  db.select().from(s.activity).where(eq(s.activity.userId, userId)).orderBy(desc(s.activity.createdAt), desc(s.activity.id)).limit(limit);

/** Birthdays/anniversaries aren't stored; surface work anniversaries this month instead. */
export async function anniversariesThisMonth(db: DB, companyId: number, now = new Date()) {
  const m = toLocalDate(now).slice(5, 7);
  return db.select({ name: s.users.name, joinDate: s.users.joinDate }).from(s.users)
    .where(and(eq(s.users.companyId, companyId), eq(s.users.active, true), sql`to_char(${s.users.joinDate}, 'MM') = ${m}`));
}
