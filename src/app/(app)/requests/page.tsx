import Link from "next/link";
import { getCtx } from "@/lib/ctx";
import { isHR, toLocalDate } from "@/server/core";
import { EXPENSE_CATEGORIES, allTickets, balances, counts, inbox, myRequests, type RequestType } from "@/server/requests";
import { listLeaveTypes } from "@/server/admin";
import { Area, Badge, Btn, Field, Form, Select } from "@/components/ui";
import Decide from "@/components/Decide";
import Tabs, { fmtDate, money, pickTab } from "@/components/Tabs";

const BASE_TABS = [
  { id: "leave", label: "Leave" },
  { id: "wfh", label: "Work from home" },
  { id: "expense", label: "Expenses" },
  { id: "punch", label: "Punch fix" },
  { id: "ticket", label: "Tickets" },
];
const TYPE: Record<string, RequestType> = { leave: "LEAVE", wfh: "WFH", expense: "EXPENSE", punch: "PUNCH", ticket: "TICKET" };

export default async function Requests({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await getCtx();
  const pending = await inbox(db, actor);
  const showInbox = isHR(actor) || actor.role === "MANAGER";
  const tabs = showInbox ? [...BASE_TABS, { id: "approvals", label: `Approvals${pending.length ? ` (${pending.length})` : ""}` }] : BASE_TABS;
  const tab = pickTab(sp, tabs.map((t) => ({ id: t.id })));
  const today = toLocalDate(new Date());
  const year = Number(today.slice(0, 4));

  if (tab === "approvals") {
    return (
      <div>
        <h1 className="mb-3 text-2xl font-bold">Requests</h1>
        <Tabs base="/requests" tabs={tabs} current={tab} />
        <div className="card">
          <h3>Waiting for your decision</h3>
          {pending.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>You&apos;re all caught up.</p> : (
            <table className="t"><thead><tr><th>Who</th><th>Request</th><th>Details</th><th /></tr></thead><tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.requester}</td>
                  <td><span className="badge b-info">{r.type}</span>{r.leaveType ? ` ${r.leaveType}` : ""}</td>
                  <td className="text-sm">{r.type === "TICKET" ? <Link href={`/requests/${r.id}`} style={{ color: "var(--violet)" }}>{r.subject}</Link> : <>{fmtDate(r.startDate)}{r.endDate && r.endDate !== r.startDate ? ` → ${fmtDate(r.endDate)}` : ""}{r.days ? ` · ${r.days}d` : ""}{r.amount ? ` · ${money(r.amount)}` : ""}{r.punchIn ? ` · ${r.punchIn}–${r.punchOut}` : ""}</>}
                    {r.reason && <div className="text-xs" style={{ color: "var(--muted)" }}>{r.reason}</div>}</td>
                  <td><Decide id={r.id} ticket={r.type === "TICKET"} /></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
    );
  }

  const type = TYPE[tab];
  const [rows, c, leaveTypes, bal, hrTickets] = await Promise.all([
    myRequests(db, actor.id, type), counts(db, actor.id, type), type === "LEAVE" ? listLeaveTypes(db, actor.companyId) : Promise.resolve([]),
    type === "LEAVE" ? balances(db, actor.id, year) : Promise.resolve([]), type === "TICKET" && isHR(actor) ? allTickets(db, actor.companyId) : Promise.resolve([]),
  ]);

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Requests</h1>
      <Tabs base="/requests" tabs={tabs} current={tab} />
      <div className="grid-auto mb-4">
        <div className="card"><h3>Pending</h3><b className="text-2xl">{c.pending}</b></div>
        <div className="card"><h3>Approved</h3><b className="text-2xl">{c.approved}</b></div>
        <div className="card"><h3>Rejected</h3><b className="text-2xl">{c.rejected}</b></div>
        {type === "LEAVE" && bal.filter((b) => b.paid).map((b) => <div className="card" key={b.leaveTypeId}><h3>{b.name} left</h3><b className="text-2xl">{b.available}</b><span className="text-xs" style={{ color: "var(--muted)" }}> of {b.allotted}</span></div>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3>My {BASE_TABS.find((t) => t.id === tab)!.label.toLowerCase()} requests</h3>
          {rows.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>Nothing here yet.</p> : (
            <table className="t"><thead><tr><th>Details</th><th>Status</th><th /></tr></thead><tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-sm">
                    {r.type === "TICKET" ? <Link href={`/requests/${r.id}`} className="font-semibold" style={{ color: "var(--violet)" }}>{r.subject}</Link> : <b>{r.leaveType ?? r.category ?? r.type}</b>}
                    {r.type !== "TICKET" && <> · {fmtDate(r.startDate)}{r.endDate && r.endDate !== r.startDate ? ` → ${fmtDate(r.endDate)}` : ""}{r.days ? ` · ${r.days}d` : ""}{r.amount ? ` · ${money(r.amount)}` : ""}{r.punchIn ? ` · ${r.punchIn}–${r.punchOut}` : ""}</>}
                    <div className="text-xs" style={{ color: "var(--muted)" }}>{r.reason}{r.decisionNote ? ` — ${r.approver ?? "Reviewer"}: ${r.decisionNote}` : ""}</div>
                  </td>
                  <td><Badge status={r.status} /></td>
                  <td>{(r.status === "PENDING" || (r.status === "APPROVED" && r.type === "LEAVE" && (r.startDate ?? "") > today)) && r.type !== "TICKET" && <Btn action="cancelRequest" args={[r.id]} small confirm="Cancel this request?">Cancel</Btn>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          {hrTickets.length > 0 && <div className="mt-6"><h3>All tickets (HR)</h3>
            <table className="t"><tbody>{hrTickets.map((t) => <tr key={t.id}><td><Link href={`/requests/${t.id}`} style={{ color: "var(--violet)" }}>{t.subject}</Link><div className="text-xs" style={{ color: "var(--muted)" }}>{t.requester}</div></td><td><Badge status={t.status} /></td></tr>)}</tbody></table></div>}
        </div>

        <div className="card">
          <h3>New {BASE_TABS.find((t) => t.id === tab)!.label.toLowerCase()} request</h3>
          {type === "LEAVE" && (
            <Form action="applyLeave" args={[{ leaveTypeId: "#:leaveTypeId", startDate: "$:startDate", endDate: "$:endDate", reason: "$:reason" }]} submit="Apply for leave">
              <Select label="Leave type" name="leaveTypeId" options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} />
              <Field label="From" name="startDate" type="date" required /><Field label="To" name="endDate" type="date" required />
              <Area label="Reason" name="reason" />
            </Form>
          )}
          {type === "WFH" && (
            <Form action="applyWfh" args={[{ startDate: "$:startDate", endDate: "$:endDate", reason: "$:reason" }]} submit="Request WFH">
              <Field label="From" name="startDate" type="date" required /><Field label="To" name="endDate" type="date" required /><Area label="Reason" name="reason" />
            </Form>
          )}
          {type === "EXPENSE" && (
            <Form action="applyExpense" args={[{ amount: "#:amount", category: "$:category", date: "$:date", reason: "$:reason" }]} submit="Submit claim">
              <Field label="Amount" name="amount" type="number" min={1} step="0.01" required />
              <Select label="Category" name="category" options={EXPENSE_CATEGORIES.map((x) => ({ value: x, label: x }))} />
              <Field label="Expense date" name="date" type="date" max={today} required /><Area label="What was it for?" name="reason" />
            </Form>
          )}
          {type === "PUNCH" && (
            <Form action="applyPunch" args={[{ date: "$:date", punchIn: "$:punchIn", punchOut: "$:punchOut", reason: "$:reason" }]} submit="Request fix">
              <Field label="Date" name="date" type="date" max={today} required />
              <div className="grid grid-cols-2 gap-2"><Field label="Check-in" name="punchIn" type="time" defaultValue="09:00" required /><Field label="Check-out" name="punchOut" type="time" defaultValue="18:00" required /></div>
              <Area label="Why does it need fixing?" name="reason" />
            </Form>
          )}
          {type === "TICKET" && (
            <Form action="openTicket" args={[{ subject: "$:subject", category: "$:category", reason: "$:reason" }]} submit="Open ticket">
              <Field label="Subject" name="subject" required />
              <Select label="Category" name="category" options={["IT", "HR", "Payroll", "Facilities", "General"].map((x) => ({ value: x, label: x }))} />
              <Area label="Describe the issue" name="reason" />
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}
