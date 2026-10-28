import Link from "next/link";
import { getCtx } from "@/lib/ctx";
import { isHR } from "@/server/core";
import { directory, listAssets, listTasks, onboardingOverview, orgChart, listDocuments, type OrgNode } from "@/server/people";
import { listDepartments } from "@/server/admin";
import { Btn, Field, Form, Progress, Select } from "@/components/ui";
import Tabs, { fmtDate, pickTab } from "@/components/Tabs";
import { listUsersLite } from "@/lib/lookups";

const TABS = [
  { id: "directory", label: "Directory" },
  { id: "org", label: "Org chart" },
  { id: "documents", label: "My documents" },
  { id: "onboarding", label: "Onboarding" },
  { id: "assets", label: "Assets" },
];

function Tree({ nodes }: { nodes: OrgNode[] }) {
  return (
    <ul className="space-y-2 border-l pl-4" style={{ borderColor: "var(--line)" }}>
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={`/people/${n.id}`} className="card inline-block hover:-translate-y-0.5" style={{ padding: "8px 14px" }}>
            <span className="font-semibold">{n.name}</span> <span className="text-xs" style={{ color: "var(--muted)" }}>{n.title}</span>
          </Link>
          {n.reports.length > 0 && <div className="mt-2"><Tree nodes={n.reports} /></div>}
        </li>
      ))}
    </ul>
  );
}

export default async function People({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; dept?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await getCtx();
  const tab = pickTab(sp, TABS);
  const hr = isHR(actor);
  const tabs = TABS.filter((t) => t.id !== "assets" || hr);

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">People</h1>
      <Tabs base="/people" tabs={tabs} current={tab} />

      {tab === "directory" && (async () => {
        const [rows, deps] = await Promise.all([directory(db, actor.companyId, sp.q ?? "", sp.dept ? Number(sp.dept) : undefined), listDepartments(db, actor.companyId)]);
        return (
          <div className="space-y-4">
            <form className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="directory" />
              <div className="min-w-[220px] flex-1"><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} className="input" placeholder="Name, email or title" /></div>
              <div><label className="label" htmlFor="dept">Department</label>
                <select id="dept" name="dept" className="input" defaultValue={sp.dept ?? ""}><option value="">All</option>{deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <button className="btn btn-primary">Filter</button>
            </form>
            <div className="grid-auto">
              {rows.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>No one matches that search.</p>}
              {rows.map((p) => (
                <Link key={p.id} href={`/people/${p.id}`} className="card rise transition hover:-translate-y-1">
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: "var(--violet-soft)" }}>{p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm" style={{ color: "var(--muted)" }}>{p.title || "—"}</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{p.department ?? "No department"} · {p.email}</div>
                </Link>
              ))}
            </div>
          </div>
        );
      })()}

      {tab === "org" && <div className="card"><Tree nodes={await orgChart(db, actor.companyId)} /></div>}

      {tab === "documents" && (async () => {
        const docs = await listDocuments(db, actor.id);
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2"><h3>Documents on file</h3>
              {docs.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No documents yet.</p> :
                <table className="t"><thead><tr><th>Title</th><th>Category</th><th>Added</th><th /></tr></thead><tbody>
                  {docs.map((d) => <tr key={d.id}><td><a href={d.url} target="_blank" rel="noreferrer" style={{ color: "var(--violet)" }}>{d.title}</a></td><td>{d.category}</td><td>{fmtDate(d.createdAt)}</td><td><Btn action="deleteDocument" args={[d.id]} small confirm="Delete this document?">Delete</Btn></td></tr>)}
                </tbody></table>}
            </div>
            <div className="card"><h3>Add a document link</h3>
              <Form action="addDocument" args={[actor.id, "$:title", "$:category", "$:url"]} submit="Add document">
                <Field label="Title" name="title" required /><Select label="Category" name="category" options={["ID", "Contract", "Certificate", "Letter", "Other"].map((x) => ({ value: x, label: x }))} />
                <Field label="Link (https://…)" name="url" type="url" required />
              </Form>
            </div>
          </div>
        );
      })()}

      {tab === "onboarding" && (async () => {
        const mine = await listTasks(db, actor.id);
        const overview = hr ? await onboardingOverview(db, actor.companyId) : [];
        const done = mine.filter((t) => t.done).length;
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3>My checklist · {done}/{mine.length}</h3>
              <Progress value={mine.length ? (done / mine.length) * 100 : 0} color="var(--teal-soft)" />
              <ul className="mt-3 space-y-2">{mine.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 text-sm"><span style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : "inherit" }}>{t.title}</span><Btn action="toggleTask" args={[t.id]} small>{t.done ? "Undo" : "Done"}</Btn></li>)}</ul>
            </div>
            {hr && <div className="card"><h3>Everyone&apos;s progress</h3>
              <table className="t"><tbody>{overview.map((o) => <tr key={o.userId}><td><Link href={`/people/${o.userId}`}>{o.name}</Link></td><td className="w-40"><Progress value={o.total ? (o.done / o.total) * 100 : 0} color="var(--teal-soft)" /></td><td className="text-right">{o.done}/{o.total}</td></tr>)}</tbody></table>
            </div>}
          </div>
        );
      })()}

      {tab === "assets" && hr && (async () => {
        const [assets, users] = await Promise.all([listAssets(db, actor.companyId), listUsersLite(db, actor.companyId)]);
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2"><h3>Company assets</h3>
              <table className="t"><thead><tr><th>Tag</th><th>Asset</th><th>Holder</th><th /></tr></thead><tbody>
                {assets.map((a) => <tr key={a.id}><td>{a.tag}</td><td>{a.name}<div className="text-xs" style={{ color: "var(--muted)" }}>{a.category}</div></td>
                  <td>{a.holder ?? <span className="badge b-muted">In stock</span>}</td>
                  <td>{a.assignedTo ? <Btn action="assignAsset" args={[a.id, null]} small>Return</Btn> : (
                    <Form action="assignAsset" args={[a.id, "#:userId"]} submit="Assign" kind="">
                      <Select label="" name="userId" options={users.map((u) => ({ value: u.id, label: u.name }))} />
                    </Form>)}</td></tr>)}
              </tbody></table>
            </div>
            <div className="card"><h3>Add an asset</h3>
              <Form action="createAsset" args={["$:tag", "$:name", "$:category"]} submit="Add asset">
                <Field label="Tag" name="tag" placeholder="LAP-003" required /><Field label="Name" name="name" required />
                <Select label="Category" name="category" options={["Laptop", "Monitor", "Phone", "Accessory", "Other"].map((x) => ({ value: x, label: x }))} />
              </Form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
