import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { getCtx } from "@/lib/ctx";
import { isHR } from "@/server/core";
import { listAnnouncements, listKudos, listSurveys, surveyResults } from "@/server/talent";
import { listUsersLite } from "@/lib/lookups";
import { Area, Btn, Field, Form, Progress, Select } from "@/components/ui";
import Tabs, { fmtDate, pickTab } from "@/components/Tabs";

const TABS = [
  { id: "news", label: "Announcements" },
  { id: "kudos", label: "Kudos" },
  { id: "surveys", label: "Polls" },
];

export default async function Engage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await getCtx();
  const hr = isHR(actor);
  const tab = pickTab(sp, TABS);

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Engage</h1>
      <Tabs base="/engage" tabs={TABS} current={tab} />

      {tab === "news" && (async () => {
        const items = await listAnnouncements(db, actor.companyId, 20);
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">{items.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>No announcements yet.</p>}
              {items.map((a) => <article key={a.id} className="card rise"><div className="font-semibold">{a.title}</div><p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p><div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{a.author} · {fmtDate(a.createdAt)}</div></article>)}</div>
            {hr && <div className="card"><h3>Post an announcement</h3><Form action="postAnnouncement" args={["$:title", "$:body"]} submit="Post"><Field label="Title" name="title" required /><Area label="Message" name="body" /></Form></div>}
          </div>
        );
      })()}

      {tab === "kudos" && (async () => {
        const [feed, users] = await Promise.all([listKudos(db, actor.companyId, 20), listUsersLite(db, actor.companyId)]);
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">{feed.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>Be the first to cheer someone on.</p>}
              {feed.map((k) => <div key={k.id} className="card rise"><span className="badge b-info">Kudos</span> <b>{k.toName}</b><p className="mt-1 text-sm">{k.message}</p><div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{fmtDate(k.createdAt)}</div></div>)}</div>
            <div className="card"><h3>Give kudos</h3>
              <Form action="giveKudos" args={["#:toId", "$:message"]} submit="Send kudos">
                <Select label="Who?" name="toId" options={users.filter((u) => u.id !== actor.id).map((u) => ({ value: u.id, label: u.name }))} /><Area label="What did they do?" name="message" />
              </Form>
            </div>
          </div>
        );
      })()}

      {tab === "surveys" && (async () => {
        const surveys = await listSurveys(db, actor.companyId);
        const detailed = await Promise.all(surveys.map(async (sv) => ({
          sv, res: await surveyResults(db, actor.companyId, sv.id),
          voted: (await db.select().from(s.surveyVotes).where(and(eq(s.surveyVotes.surveyId, sv.id), eq(s.surveyVotes.userId, actor.id)))).length > 0,
        })));
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">{detailed.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>No polls yet.</p>}
              {detailed.map(({ sv, res, voted }) => (
                <div className="card rise" key={sv.id}><div className="flex items-center justify-between"><div className="font-semibold">{sv.question}</div>{!sv.active && <span className="badge b-muted">Closed</span>}</div>
                  <ul className="mt-3 space-y-2">{res.options.map((o, i) => (
                    <li key={i}><div className="mb-1 flex items-center justify-between text-sm"><span>{o}</span><span style={{ color: "var(--muted)" }}>{res.counts[i]}</span>
                      {sv.active && !voted && <Btn action="vote" args={[sv.id, i]} small>Vote</Btn>}</div>
                      <Progress value={res.total ? (res.counts[i] / res.total) * 100 : 0} /></li>))}</ul>
                  <div className="mt-2 flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}><span>{res.total} vote{res.total === 1 ? "" : "s"}{voted ? " · you voted" : ""}</span>{hr && sv.active && <Btn action="closeSurvey" args={[sv.id]} small>Close poll</Btn>}</div>
                </div>))}</div>
            {hr && <div className="card"><h3>Create a poll</h3>
              <Form action="createSurvey" args={["$:question", ["$:o1", "$:o2", "$:o3", "$:o4"]]} submit="Create poll">
                <Field label="Question" name="question" required /><Field label="Option 1" name="o1" required /><Field label="Option 2" name="o2" required /><Field label="Option 3" name="o3" /><Field label="Option 4" name="o4" />
              </Form></div>}
          </div>
        );
      })()}
    </div>
  );
}
