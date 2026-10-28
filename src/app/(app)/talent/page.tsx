import Link from "next/link";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { getCtx } from "@/lib/ctx";
import { isHR, isManagerish } from "@/server/core";
import { STAGES, cycleReviews, listCandidates, listCourses, listCycles, listGoals, listJobs, myEnrollments } from "@/server/talent";
import { listDepartments } from "@/server/admin";
import { Area, Btn, Field, Form, Progress, Select } from "@/components/ui";
import Tabs, { fmtDate, pickTab } from "@/components/Tabs";

const TABS = [
  { id: "performance", label: "Performance" },
  { id: "training", label: "Training" },
  { id: "recruitment", label: "Recruitment" },
];
const RATINGS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} — ${["Needs work", "Below", "Meets", "Strong", "Outstanding"][n - 1]}` }));

export default async function Talent({ searchParams }: { searchParams: Promise<{ tab?: string; job?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await getCtx();
  const hr = isHR(actor);
  const tabs = hr ? TABS : TABS.slice(0, 2);
  const tab = pickTab(sp, tabs);

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Talent</h1>
      <Tabs base="/talent" tabs={tabs} current={tab} />

      {tab === "performance" && (async () => {
        const [goals, cycles] = await Promise.all([listGoals(db, actor.id), listCycles(db, actor.companyId)]);
        const open = cycles.filter((c) => c.open);
        const myReviews = await Promise.all(open.map(async (c) => ({ c, r: (await db.select().from(s.reviews).where(and(eq(s.reviews.cycleId, c.id), eq(s.reviews.userId, actor.id))))[0] })));
        const teamByCycle = isManagerish(actor) ? await Promise.all(open.map(async (c) => ({ c, rows: (await cycleReviews(db, actor.companyId, c.id)).filter((r) => r.userId !== actor.id && (hr || r.managerId === actor.id)) }))) : [];
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3>My goals</h3>
              {goals.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No goals yet. Add your first one.</p> : (
                <ul className="space-y-4">{goals.map((g) => (
                  <li key={g.id}><div className="mb-1 flex justify-between text-sm"><b>{g.title}</b><span style={{ color: "var(--muted)" }}>{g.progress}%{g.dueDate ? ` · due ${fmtDate(g.dueDate)}` : ""}</span></div>
                    <Progress value={g.progress} color="var(--teal-soft)" />
                    <div className="mt-2"><Form action="updateGoalProgress" args={[g.id, "#:progress"]} reset={false} submit="Update" kind=""><input name="progress" type="number" min={0} max={100} defaultValue={g.progress} className="input" aria-label="Progress percent" style={{ width: 100 }} /></Form></div></li>))}</ul>
              )}
              <div className="mt-4"><h3>Add a goal</h3><Form action="addGoal" args={[actor.id, "$:title", "$:due"]} submit="Add goal"><Field label="Goal" name="title" required /><Field label="Due date" name="due" type="date" /></Form></div>
            </div>

            <div className="space-y-4">
              {myReviews.length === 0 && <div className="card"><h3>Reviews</h3><p className="text-sm" style={{ color: "var(--muted)" }}>No review cycle is open right now.</p></div>}
              {myReviews.map(({ c, r }) => r && (
                <div className="card" key={c.id}><h3>{c.name} · my self-review</h3>
                  {r.selfRating && <p className="mb-2 text-sm">Submitted: {r.selfRating}/5 — {r.selfComment}</p>}
                  {r.managerRating && <p className="mb-2 text-sm"><span className="badge b-good">Manager: {r.managerRating}/5</span> {r.managerComment}</p>}
                  <Form action="submitSelfReview" args={[r.id, "#:rating", "$:comment"]} reset={false} submit={r.selfRating ? "Update review" : "Submit review"}>
                    <Select label="Rating" name="rating" options={RATINGS} defaultValue={r.selfRating ?? 3} /><Area label="How did it go?" name="comment" />
                  </Form>
                </div>
              ))}
              {teamByCycle.map(({ c, rows }) => rows.length > 0 && (
                <div className="card" key={c.id}><h3>{c.name} · team reviews</h3>
                  <ul className="space-y-4">{rows.map((r) => (
                    <li key={r.id}><div className="text-sm"><b>{r.name}</b> · self {r.selfRating ?? "—"} · manager {r.managerRating ?? "—"}</div>
                      <Form action="submitManagerReview" args={[r.id, "#:rating", "$:comment"]} reset={false} submit="Save review" kind="">
                        <Select label="Rating" name="rating" options={RATINGS} defaultValue={r.managerRating ?? 3} /><Area label="Feedback" name="comment" />
                      </Form></li>))}</ul>
                </div>
              ))}
              {hr && (
                <div className="card"><h3>Review cycles (HR)</h3>
                  <ul className="mb-3 space-y-1 text-sm">{cycles.map((c) => <li key={c.id} className="flex items-center justify-between">{c.name} {c.open ? <Btn action="closeCycle" args={[c.id]} small confirm="Close this cycle? Reviews become read-only.">Close</Btn> : <span className="badge b-muted">Closed</span>}</li>)}</ul>
                  <Form action="createCycle" args={["$:name"]} submit="Start new cycle"><Field label="Cycle name" name="name" placeholder="H1 2027" required /></Form>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {tab === "training" && (async () => {
        const [courses, mine] = await Promise.all([listCourses(db, actor.companyId), myEnrollments(db, actor.id)]);
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="grid-auto lg:col-span-2">
              {courses.map((c) => {
                const e = mine.find((x) => x.courseId === c.id);
                return (
                  <div className="card rise" key={c.id}><div className="font-semibold">{c.title}</div><div className="text-sm" style={{ color: "var(--muted)" }}>{c.description}</div><div className="my-2 text-xs" style={{ color: "var(--muted)" }}>{c.hours} hours</div>
                    {e ? (<><Progress value={e.progress} color="var(--teal-soft)" /><div className="mt-2 flex items-center gap-2 text-sm">{e.completedAt ? <span className="badge b-good">Completed</span> : `${e.progress}%`}
                      <Form action="setCourseProgress" args={[c.id, "#:progress"]} reset={false} submit="Set" kind=""><input name="progress" type="number" min={0} max={100} defaultValue={e.progress} className="input" aria-label="Progress percent" style={{ width: 90 }} /></Form></div></>)
                      : <Btn action="enroll" args={[c.id]} kind="primary">Enroll</Btn>}
                  </div>
                );
              })}
            </div>
            {hr && <div className="card"><h3>Add a course (HR)</h3><Form action="createCourse" args={["$:title", "$:description", "#:hours"]} submit="Add course"><Field label="Title" name="title" required /><Area label="Description" name="description" /><Field label="Hours" name="hours" type="number" min={1} defaultValue={1} required /></Form></div>}
          </div>
        );
      })()}

      {tab === "recruitment" && hr && (async () => {
        const [jobs, deps] = await Promise.all([listJobs(db, actor.companyId), listDepartments(db, actor.companyId)]);
        const jobId = Number(sp.job) || undefined;
        const cands = jobId ? await listCandidates(db, actor.companyId, jobId) : [];
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card"><h3>Jobs</h3>
              <ul className="mb-4 space-y-2">{jobs.map((j) => <li key={j.id} className="flex items-center justify-between gap-2 text-sm"><Link href={`/talent?tab=recruitment&job=${j.id}`} className="font-semibold" style={{ color: "var(--violet)" }}>{j.title}</Link><span>{j.candidates} applicants {j.open ? <Btn action="setJobOpen" args={[j.id, false]} small>Close</Btn> : <Btn action="setJobOpen" args={[j.id, true]} small>Reopen</Btn>}</span></li>)}</ul>
              <h3>New job</h3>
              <Form action="createJob" args={[{ title: "$:title", departmentId: "#:departmentId", location: "$:location", description: "$:description" }]} submit="Post job">
                <Field label="Title" name="title" required /><Select label="Department" name="departmentId" options={[{ value: "", label: "—" }, ...deps.map((d) => ({ value: d.id, label: d.name }))]} />
                <Field label="Location" name="location" defaultValue="Onsite" /><Area label="Description" name="description" />
              </Form>
              <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>Public career page: <Link href="/careers" style={{ color: "var(--violet)" }}>/careers</Link></p>
            </div>
            <div className="card lg:col-span-2"><h3>Candidates</h3>
              {!jobId ? <p className="text-sm" style={{ color: "var(--muted)" }}>Pick a job to see its pipeline.</p> : cands.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No applicants yet.</p> : (
                <ul className="space-y-5">{cands.map((c) => (
                  <li key={c.id}><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{c.name}</b> <span className="text-sm" style={{ color: "var(--muted)" }}>{c.email}</span></div><span className={`badge ${c.stage === "HIRED" ? "b-good" : c.stage === "REJECTED" ? "b-bad" : "b-info"}`}>{c.stage}</span></div>
                    {c.stage !== "HIRED" && c.stage !== "REJECTED" && (
                      <div className="mt-2 grid gap-2 md:grid-cols-3">
                        <Form action="moveCandidate" args={[c.id, "$:stage"]} reset={false} submit="Move" kind=""><Select label="Stage" name="stage" defaultValue={c.stage} options={STAGES.filter((x) => x !== "HIRED").map((x) => ({ value: x, label: x }))} /></Form>
                        <Form action="rateCandidate" args={[c.id, "#:rating", "$:notes"]} reset={false} submit="Save rating" kind=""><Select label="Rating" name="rating" defaultValue={c.rating ?? 3} options={RATINGS} /><Field label="Notes" name="notes" defaultValue={c.notes} /></Form>
                        {c.stage === "OFFER" && <Form action="hireCandidate" args={[c.id, "$:password", "#:basic"]} submit="Hire" kind="good"><Field label="Initial password" name="password" type="password" required /><Field label="Monthly basic" name="basic" type="number" min={0} required /></Form>}
                      </div>)}
                  </li>))}</ul>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
