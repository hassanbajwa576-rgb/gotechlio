import { notFound } from "next/navigation";
import { getCtx } from "@/lib/ctx";
import { AppError } from "@/server/core";
import { canDecide, getRequest, ticketComments } from "@/server/requests";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { Area, Badge, Form } from "@/components/ui";
import Decide from "@/components/Decide";
import { fmtDate } from "@/components/Tabs";

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { db, actor } = await getCtx();
  let r;
  try { r = await getRequest(db, actor, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  if (r.type !== "TICKET") notFound();
  const [raw] = await db.select().from(s.requests).where(eq(s.requests.id, id));
  const [comments, decidable] = await Promise.all([ticketComments(db, id), canDecide(db, actor, raw)]);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card rise">
        <div className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-bold">{r.subject}</h1><div className="text-sm" style={{ color: "var(--muted)" }}>{r.requester} · {r.category} · {fmtDate(r.createdAt)}</div></div><Badge status={r.status} /></div>
        <p className="mt-3 whitespace-pre-wrap">{r.reason}</p>
      </div>
      <div className="card"><h3>Conversation</h3>
        {comments.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No replies yet.</p> :
          <ul className="space-y-3">{comments.map((c) => <li key={c.id} className="rounded-xl px-3 py-2" style={{ background: "var(--bg)" }}><div className="text-xs font-semibold" style={{ color: "var(--muted)" }}>{c.author} · {fmtDate(c.createdAt)}</div><div className="text-sm">{c.body}</div></li>)}</ul>}
        {r.status === "PENDING" && (
          <div className="mt-4"><Form action="commentOnTicket" args={[id, "$:body"]} submit="Reply"><Area label="Add a reply" name="body" /></Form></div>
        )}
      </div>
      {decidable && r.status === "PENDING" && <div className="card"><h3>Resolve this ticket</h3><Decide id={id} ticket /></div>}
    </div>
  );
}
