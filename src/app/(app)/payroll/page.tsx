import Link from "next/link";
import { getCtx } from "@/lib/ctx";
import { isHR, toLocalDate } from "@/server/core";
import { finalSettlement, listRuns, listSalaries, myPayslips, runDetail } from "@/server/payroll";
import { listUsersLite } from "@/lib/lookups";
import { Btn, Field, Form, Select } from "@/components/ui";
import Tabs, { money, pickTab } from "@/components/Tabs";

const TABS = [
  { id: "payslips", label: "My payslips" },
  { id: "runs", label: "Payroll runs" },
  { id: "salaries", label: "Salary structure" },
  { id: "settlement", label: "Final settlement" },
];

export default async function Payroll({ searchParams }: { searchParams: Promise<{ tab?: string; run?: string; user?: string; day?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await getCtx();
  const hr = isHR(actor);
  const tabs = hr ? TABS : TABS.slice(0, 1);
  const tab = pickTab(sp, tabs);
  const thisMonth = toLocalDate(new Date()).slice(0, 7);

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Payroll</h1>
      <Tabs base="/payroll" tabs={tabs} current={tab} />

      {tab === "payslips" && (async () => {
        const slips = await myPayslips(db, actor.id);
        return (
          <div className="card"><h3>Payslips</h3>
            {slips.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>Your payslips appear here once payroll for a month is finalized.</p> :
              <table className="t"><thead><tr><th>Month</th><th>Gross</th><th>Net pay</th><th /></tr></thead><tbody>
                {slips.map((p) => <tr key={p.id}><td className="font-semibold">{p.month}</td><td>{money(p.gross)}</td><td>{money(p.net)}</td><td><Link className="btn btn-sm" href={`/payroll/slip/${p.id}`}>View</Link></td></tr>)}
              </tbody></table>}
          </div>
        );
      })()}

      {tab === "runs" && hr && (async () => {
        const runs = await listRuns(db, actor.companyId);
        const open = sp.run ? runs.find((r) => r.id === Number(sp.run)) : undefined;
        const detail = open ? await runDetail(db, actor, open.id) : [];
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2"><h3>Runs</h3>
              {runs.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No payroll runs yet.</p> :
                <table className="t"><tbody>{runs.map((r) => (
                  <tr key={r.id}><td className="font-semibold">{r.month}</td><td>{r.finalized ? <span className="badge b-good">Finalized</span> : <span className="badge b-pending">Draft</span>}</td>
                    <td className="space-x-2 text-right"><Link className="btn btn-sm" href={`/payroll?tab=runs&run=${r.id}`}>Review</Link>{!r.finalized && <Btn action="finalizeRun" args={[r.id]} small kind="primary" confirm={`Finalize ${r.month}? Payslips become visible and the month is locked.`}>Finalize</Btn>}</td></tr>))}</tbody></table>}
              {open && (
                <div className="mt-6"><h3>{open.month} · {open.finalized ? "finalized" : "draft"}</h3>
                  <table className="t"><thead><tr><th>Employee</th><th>Gross</th><th>Tax</th><th>Reimb.</th><th>Net</th></tr></thead><tbody>
                    {detail.map((d) => <tr key={d.id}><td>{d.name}</td><td>{money(d.gross)}</td><td>{money(d.tax)}</td><td>{money(d.reimbursements)}</td><td className="font-semibold">{money(d.net)}</td></tr>)}
                  </tbody></table>
                  <p className="mt-2 text-sm">Total net: <b>{money(detail.reduce((a, d) => a + d.net, 0))}</b></p>
                </div>
              )}
            </div>
            <div className="card"><h3>Run payroll</h3>
              <Form action="runPayroll" args={["$:month"]} submit="Calculate">
                <Field label="Month" name="month" type="month" defaultValue={thisMonth} required />
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>Gross = basic + allowances − unpaid leave. Tax uses your company rate. Approved, unpaid expense claims are added tax-free. You can re-run a draft until you finalize it.</p>
              </Form>
            </div>
          </div>
        );
      })()}

      {tab === "salaries" && hr && (async () => {
        const [rows, users] = await Promise.all([listSalaries(db, actor.companyId), listUsersLite(db, actor.companyId)]);
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2"><h3>Salary structure</h3>
              <table className="t"><thead><tr><th>Employee</th><th>Basic</th><th>Allowances</th><th>Deductions</th></tr></thead><tbody>
                {rows.map((r) => <tr key={r.userId}><td>{r.name}</td>{r.basic == null ? <td colSpan={3}><span className="badge b-pending">Not set</span></td> : <><td>{money(r.basic)}</td><td>{money(r.allowances ?? 0)}</td><td>{money(r.deductions ?? 0)}</td></>}</tr>)}
              </tbody></table>
            </div>
            <div className="card"><h3>Set salary</h3>
              <Form action="setSalary" args={["#:userId", "#:basic", "#:allowances", "#:deductions"]} submit="Save salary">
                <Select label="Employee" name="userId" options={users.map((u) => ({ value: u.id, label: u.name }))} />
                <Field label="Basic" name="basic" type="number" min={0} step="0.01" required />
                <Field label="Allowances" name="allowances" type="number" min={0} step="0.01" defaultValue={0} />
                <Field label="Fixed deductions" name="deductions" type="number" min={0} step="0.01" defaultValue={0} />
              </Form>
            </div>
          </div>
        );
      })()}

      {tab === "settlement" && hr && (async () => {
        const users = await listUsersLite(db, actor.companyId);
        const uid = Number(sp.user) || users[0]?.id;
        let result: Awaited<ReturnType<typeof finalSettlement>> | null = null;
        let err = "";
        if (sp.day && uid) {
          try { result = await finalSettlement(db, actor, uid, sp.day); } catch (e) { err = (e as Error).message; }
        }
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3>Calculate a final settlement</h3>
              <form>
                <input type="hidden" name="tab" value="settlement" />
                <label className="label" htmlFor="user">Employee</label>
                <select id="user" name="user" className="input" defaultValue={uid}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                <label className="label" htmlFor="day">Last working day</label>
                <input id="day" name="day" type="date" className="input" defaultValue={sp.day} required />
                <button className="btn btn-primary mt-3">Calculate</button>
              </form>
              {err && <div className="err">{err}</div>}
            </div>
            {result && <div className="card"><h3>Settlement</h3>
              <table className="t"><tbody>
                <tr><td>Pro-rated salary</td><td className="text-right">{money(result.prorated)}</td></tr>
                <tr><td>Unused annual leave ({result.unusedLeaveDays} days)</td><td className="text-right">{money(result.leaveEncashment)}</td></tr>
                <tr><td className="font-bold">Total</td><td className="text-right font-bold">{money(result.total)}</td></tr>
              </tbody></table>
            </div>}
          </div>
        );
      })()}
    </div>
  );
}
