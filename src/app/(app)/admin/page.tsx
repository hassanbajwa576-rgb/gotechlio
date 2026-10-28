import Link from "next/link";
import { requireHRCtx } from "@/lib/ctx";
import { isAdmin } from "@/server/core";
import { getSettings, listDepartments, listHolidays, listLeaveTypes, listShifts } from "@/server/admin";
import { directory } from "@/server/people";
import { listUsersLite } from "@/lib/lookups";
import { Btn, Field, Form, Select } from "@/components/ui";
import Tabs, { fmtDate, pickTab } from "@/components/Tabs";

const TABS = [
  { id: "employees", label: "Employees" },
  { id: "leave", label: "Leave types" },
  { id: "holidays", label: "Holidays" },
  { id: "departments", label: "Departments" },
  { id: "settings", label: "Company" },
];

export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await requireHRCtx();
  const tab = pickTab(sp, TABS);

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Admin</h1>
      <Tabs base="/admin" tabs={TABS} current={tab} />

      {tab === "employees" && (async () => {
        const [rows, deps, shifts, users] = await Promise.all([directory(db, actor.companyId), listDepartments(db, actor.companyId), listShifts(db, actor.companyId), listUsersLite(db, actor.companyId)]);
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2"><h3>Employees ({rows.length})</h3>
              <table className="t"><thead><tr><th>Name</th><th>Role</th><th>Department</th></tr></thead><tbody>
                {rows.map((r) => <tr key={r.id}><td><Link href={`/people/${r.id}`} style={{ color: "var(--violet)" }}>{r.name}</Link><div className="text-xs" style={{ color: "var(--muted)" }}>{r.email}</div></td><td><span className="badge b-info">{r.role}</span></td><td>{r.department ?? "—"}</td></tr>)}
              </tbody></table>
            </div>
            <div className="card"><h3>Add an employee</h3>
              <Form action="createEmployee" args={[{ name: "$:name", email: "$:email", password: "$:password", role: "$:role", title: "$:title", departmentId: "#:departmentId", managerId: "#:managerId", shiftId: "#:shiftId", joinDate: "$:joinDate", basic: "#:basic" }]} submit="Create employee">
                <Field label="Full name" name="name" required /><Field label="Work email" name="email" type="email" required />
                <Field label="Initial password" name="password" type="password" required /><Field label="Title" name="title" />
                <Select label="Role" name="role" options={(isAdmin(actor) ? ["EMPLOYEE", "MANAGER", "HR", "ADMIN"] : ["EMPLOYEE", "MANAGER", "HR"]).map((r) => ({ value: r, label: r }))} />
                <Select label="Department" name="departmentId" options={[{ value: "", label: "—" }, ...deps.map((d) => ({ value: d.id, label: d.name }))]} />
                <Select label="Manager" name="managerId" options={[{ value: "", label: "—" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
                <Select label="Shift" name="shiftId" options={[{ value: "", label: "—" }, ...shifts.map((x) => ({ value: x.id, label: x.name }))]} />
                <Field label="Join date" name="joinDate" type="date" /><Field label="Monthly basic (optional)" name="basic" type="number" min={0} />
              </Form>
            </div>
          </div>
        );
      })()}

      {tab === "leave" && (async () => {
        const types = await listLeaveTypes(db, actor.companyId);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3>Leave types</h3><table className="t"><thead><tr><th>Name</th><th>Days / year</th><th>Paid</th></tr></thead><tbody>{types.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.annualQuota}</td><td>{t.paid ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
            <div className="card"><h3>Add a leave type</h3>
              <Form action="addLeaveType" args={["$:name", "#:quota", "?:paid"]} submit="Add leave type">
                <Field label="Name" name="name" required /><Field label="Days per year" name="quota" type="number" min={0} max={365} step="0.5" required />
                <Select label="Paid?" name="paid" options={[{ value: "true", label: "Paid" }, { value: "false", label: "Unpaid" }]} />
              </Form>
              <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>Employees get a balance for this type automatically the first time they use it.</p>
            </div>
          </div>
        );
      })()}

      {tab === "holidays" && (async () => {
        const hol = await listHolidays(db, actor.companyId);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3>Company holidays</h3>
              {hol.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No holidays yet.</p> : <table className="t"><tbody>{hol.map((h) => <tr key={h.id}><td>{fmtDate(h.date)}</td><td>{h.name}</td><td className="text-right"><Btn action="removeHoliday" args={[h.id]} small confirm="Remove this holiday?">Remove</Btn></td></tr>)}</tbody></table>}
            </div>
            <div className="card"><h3>Add a holiday</h3><Form action="addHoliday" args={["$:date", "$:name"]} submit="Add holiday"><Field label="Date" name="date" type="date" required /><Field label="Name" name="name" required /></Form></div>
          </div>
        );
      })()}

      {tab === "departments" && (async () => {
        const deps = await listDepartments(db, actor.companyId);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3>Departments</h3><ul className="space-y-1 text-sm">{deps.map((d) => <li key={d.id}>{d.name}</li>)}</ul></div>
            <div className="card"><h3>Add a department</h3><Form action="addDepartment" args={["$:name"]} submit="Add department"><Field label="Name" name="name" required /></Form></div>
          </div>
        );
      })()}

      {tab === "settings" && (async () => {
        const cfg = await getSettings(db, actor.companyId);
        return (
          <div className="card max-w-lg"><h3>Company settings</h3>
            {isAdmin(actor) ? (
              <Form action="updateSettings" reset={false} args={[{ companyName: "$:companyName", currency: "$:currency", taxRate: "%:taxPct", workingDaysPerMonth: "#:days" }]}>
                <Field label="Company name" name="companyName" defaultValue={cfg.companyName} required /><Field label="Currency" name="currency" defaultValue={cfg.currency} required />
                <Field label="Working days per month" name="days" type="number" min={10} max={31} defaultValue={cfg.workingDaysPerMonth} required />
                <Field label="Tax rate (%)" name="taxPct" type="number" min={0} max={60} step="0.1" defaultValue={Math.round(cfg.taxRate * 1000) / 10} required />
              </Form>
            ) : <p className="text-sm" style={{ color: "var(--muted)" }}>Only admins can change company settings. Current: {cfg.companyName}, {cfg.currency}, tax {Math.round(cfg.taxRate * 1000) / 10}%.</p>}
          </div>
        );
      })()}
    </div>
  );
}
