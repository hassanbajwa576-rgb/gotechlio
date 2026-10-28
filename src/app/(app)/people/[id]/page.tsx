import { notFound } from "next/navigation";
import { getCtx } from "@/lib/ctx";
import { isHR } from "@/server/core";
import { getEmployee, listDocuments } from "@/server/people";
import { listDepartments, listShifts } from "@/server/admin";
import { balances } from "@/server/requests";
import { listUsersLite } from "@/lib/lookups";
import { Btn, Field, Form, Select } from "@/components/ui";
import { fmtDate } from "@/components/Tabs";

export default async function Profile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  if (!Number.isInteger(uid)) notFound();
  const { db, actor } = await getCtx();
  const p = await getEmployee(db, actor.companyId, uid);
  if (!p) notFound();
  const hr = isHR(actor);
  const self = actor.id === uid;
  const [deps, shifts, users, bal, docs] = await Promise.all([
    listDepartments(db, actor.companyId), listShifts(db, actor.companyId), listUsersLite(db, actor.companyId),
    hr || self ? balances(db, uid, new Date().getFullYear()) : Promise.resolve([]),
    hr || self ? listDocuments(db, uid) : Promise.resolve([]),
  ]);
  const manager = users.find((u) => u.id === p.managerId);

  return (
    <div className="space-y-4">
      <div className="card rise flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white" style={{ background: "var(--violet-soft)" }}>{p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{p.name} {!p.active && <span className="badge b-bad">Deactivated</span>}</h1>
          <div style={{ color: "var(--muted)" }}>{p.title || "No title"} · {p.department ?? "No department"}</div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>{p.email}{p.phone ? ` · ${p.phone}` : ""} · Joined {fmtDate(p.joinDate)} · Reports to {manager?.name ?? "nobody"}</div>
        </div>
        {hr && !self && <Btn action="setActive" args={[p.id, !p.active]} kind={p.active ? "bad" : "good"} confirm={p.active ? `Deactivate ${p.name}? They won't be able to sign in.` : undefined}>{p.active ? "Deactivate" : "Reactivate"}</Btn>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(hr || self) && (
          <div className="card"><h3>{hr ? "Edit profile" : "Contact details"}</h3>
            {hr ? (
              <Form action="updateEmployee" reset={false}
                args={[p.id, { name: "$:name", title: "$:title", phone: "$:phone", departmentId: "#:departmentId", managerId: "#:managerId", shiftId: "#:shiftId", ...(actor.role === "ADMIN" ? { role: "$:role" } : {}) }]}>
                <Field label="Name" name="name" defaultValue={p.name} required />
                <Field label="Title" name="title" defaultValue={p.title} />
                <Field label="Phone" name="phone" defaultValue={p.phone} />
                <Select label="Department" name="departmentId" defaultValue={p.departmentId ?? ""} options={[{ value: "", label: "None" }, ...deps.map((d) => ({ value: d.id, label: d.name }))]} />
                <Select label="Manager" name="managerId" defaultValue={p.managerId ?? ""} options={[{ value: "", label: "None" }, ...users.filter((u) => u.id !== p.id).map((u) => ({ value: u.id, label: u.name }))]} />
                <Select label="Shift" name="shiftId" defaultValue={p.shiftId ?? ""} options={[{ value: "", label: "None" }, ...shifts.map((x) => ({ value: x.id, label: `${x.name} ${x.startTime}–${x.endTime}` }))]} />
                {actor.role === "ADMIN" && <Select label="Role" name="role" defaultValue={p.role} options={["EMPLOYEE", "MANAGER", "HR", "ADMIN"].map((r) => ({ value: r, label: r }))} />}
              </Form>
            ) : (
              <Form action="updateEmployee" reset={false} args={[p.id, { phone: "$:phone" }]}><Field label="Phone" name="phone" defaultValue={p.phone} /></Form>
            )}
          </div>
        )}
        {bal.length > 0 && (
          <div className="card"><h3>Leave balances · {new Date().getFullYear()}</h3>
            <table className="t"><tbody>{bal.map((b) => <tr key={b.leaveTypeId}><td>{b.name}</td><td className="text-right">{b.paid ? `${b.available} of ${b.allotted} left` : `${b.used} taken`}</td></tr>)}</tbody></table>
          </div>
        )}
        {(hr || self) && (
          <div className="card lg:col-span-2"><h3>Documents</h3>
            {docs.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No documents.</p> :
              <ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id}><a href={d.url} target="_blank" rel="noreferrer" style={{ color: "var(--violet)" }}>{d.title}</a> <span style={{ color: "var(--muted)" }}>· {d.category}</span></li>)}</ul>}
          </div>
        )}
      </div>
    </div>
  );
}
