import Link from "next/link";
import { publicDb } from "@/lib/ctx";
import { listOpenJobsPublic } from "@/server/talent";
import Apply from "./Apply";

export const dynamic = "force-dynamic";

export default async function Careers() {
  const jobs = await listOpenJobsPublic(await publicDb());
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/login" className="text-sm" style={{ color: "var(--violet)" }}>← Back to sign in</Link>
      <h1 className="mb-1 mt-3 text-3xl font-bold">Open roles</h1>
      <p className="mb-6" style={{ color: "var(--muted)" }}>Apply in a minute — we&apos;ll be in touch.</p>
      {jobs.length === 0 && <p>No open roles right now. Check back soon.</p>}
      <div className="space-y-4">{jobs.map((j) => (
        <div key={j.id} className="card rise">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">{j.title}</h2><span className="badge b-info">{j.location}</span></div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>{j.company}{j.department ? ` · ${j.department}` : ""}</div>
          <Apply jobId={j.id} />
        </div>))}</div>
    </div>
  );
}
