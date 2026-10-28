import { getCtx } from "@/lib/ctx";
import { isHR, isManagerish, toLocalDate } from "@/server/core";
import { timesheet, weekSchedule, whosIn, todayStatus } from "@/server/attendance";
import { listShifts } from "@/server/admin";
import { listUsersLite } from "@/lib/lookups";
import { ClockControls } from "@/components/HomeWidgets";
import { Field, Form, Select } from "@/components/ui";
import Tabs, { fmtTime, hm, pickTab } from "@/components/Tabs";

const TABS = [
  { id: "today", label: "Today" },
  { id: "timesheet", label: "Timesheet" },
  { id: "schedule", label: "Schedule" },
  { id: "whosin", label: "Who's in" },
  { id: "shifts", label: "Shifts" },
];

const mondayOf = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const KIND: Record<string, string> = { shift: "b-info", leave: "b-bad", wfh: "b-good", holiday: "b-pending", off: "b-muted", none: "b-muted" };

export default async function Time({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; week?: string }> }) {
  const sp = await searchParams;
  const { db, actor } = await getCtx();
  const hr = isHR(actor);
  const tabs = TABS.filter((t) => (t.id === "shifts" ? hr : t.id === "whosin" ? isManagerish(actor) : true));
  const tab = pickTab(sp, tabs);
  const today = toLocalDate(new Date());

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Time</h1>
      <Tabs base="/time" tabs={tabs} current={tab} />

      {tab === "today" && (async () => {
        const st = await todayStatus(db, actor.id);
        return (
          <div className="card max-w-xl"><h3>Today</h3>
            <p className="mb-1 text-sm">Checked in: <b>{fmtTime(st.checkIn)}</b>{st.late ? <span className="badge b-bad ml-2">Late</span> : null}</p>
            <p className="mb-1 text-sm">Checked out: <b>{fmtTime(st.checkOut)}</b></p>
            <p className="mb-3 text-sm">Worked: <b>{hm(st.worked)}</b>{st.onBreak ? " · on break" : ""}</p>
            {st.checkOut ? <p className="text-sm" style={{ color: "var(--muted)" }}>You&apos;re done for today.</p> : <ClockControls checkedIn={!!st.checkIn} checkedOut={false} onBreak={st.onBreak} />}
          </div>
        );
      })()}

      {tab === "timesheet" && (async () => {
        const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
        const t = await timesheet(db, actor.id, month);
        return (
          <div className="space-y-3">
            <form className="flex items-end gap-3"><input type="hidden" name="tab" value="timesheet" />
              <div><label className="label" htmlFor="month">Month</label><input id="month" name="month" type="month" defaultValue={month} className="input" /></div>
              <button className="btn btn-primary">Show</button></form>
            <div className="grid-auto">
              <div className="card"><h3>Days present</h3><b className="text-2xl">{t.presentDays}</b></div>
              <div className="card"><h3>Total hours</h3><b className="text-2xl">{hm(t.totalMinutes)}</b></div>
              <div className="card"><h3>Late days</h3><b className="text-2xl">{t.lateDays}</b></div>
            </div>
            <div className="card">
              {t.days.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No attendance recorded for this month.</p> :
                <table className="t"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Break</th><th>Worked</th><th /></tr></thead><tbody>
                  {t.days.map((d) => <tr key={d.id}><td>{d.date}</td><td>{fmtTime(d.checkIn)}</td><td>{fmtTime(d.checkOut)}</td><td>{d.breakMinutes}m</td><td>{hm(d.worked)}</td>
                    <td>{d.late && <span className="badge b-bad">Late</span>} {d.source === "correction" && <span className="badge b-info">Corrected</span>}</td></tr>)}
                </tbody></table>}
            </div>
          </div>
        );
      })()}

      {tab === "schedule" && (async () => {
        const week = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? mondayOf(sp.week!) : mondayOf(today);
        const w = await weekSchedule(db, actor.companyId, week);
        const shift = (n: number) => new Date(Date.parse(week) + n * 86400000).toISOString().slice(0, 10);
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <a className="btn btn-sm" href={`/time?tab=schedule&week=${shift(-7)}`}>← Previous</a>
              <b className="text-sm">Week of {week}</b>
              <a className="btn btn-sm" href={`/time?tab=schedule&week=${shift(7)}`}>Next →</a>
            </div>
            <div className="card overflow-x-auto">
              <table className="t"><thead><tr><th>Employee</th>{w.dates.map((d) => <th key={d}>{new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}</th>)}</tr></thead><tbody>
                {w.rows.map((r) => <tr key={r.id}><td className="font-semibold">{r.name}</td>{r.cells.map((c, i) => <td key={i}><span className={`badge ${KIND[c.kind]}`}>{c.label}</span></td>)}</tr>)}
              </tbody></table>
            </div>
          </div>
        );
      })()}

      {tab === "whosin" && isManagerish(actor) && (async () => {
        const rows = await whosIn(db, actor.companyId);
        return (
          <div className="card"><h3>Checked in today</h3>
            {rows.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>Nobody has checked in yet.</p> :
              <table className="t"><thead><tr><th>Name</th><th>In</th><th>Out</th><th /></tr></thead><tbody>{rows.map((r) => <tr key={r.userId}><td>{r.name}</td><td>{fmtTime(r.checkIn)}</td><td>{fmtTime(r.checkOut)}</td><td>{r.late && <span className="badge b-bad">Late</span>}</td></tr>)}</tbody></table>}
          </div>
        );
      })()}

      {tab === "shifts" && hr && (async () => {
        const [shifts, users] = await Promise.all([listShifts(db, actor.companyId), listUsersLite(db, actor.companyId)]);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3>Shifts</h3>
              <table className="t"><thead><tr><th>Name</th><th>Hours</th><th>Grace</th></tr></thead><tbody>{shifts.map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.startTime}–{x.endTime}</td><td>{x.graceMinutes} min</td></tr>)}</tbody></table>
              <div className="mt-4"><h3>New shift</h3>
                <Form action="createShift" args={["$:name", "$:start", "$:end", "#:grace"]} submit="Create shift">
                  <Field label="Name" name="name" required />
                  <div className="grid grid-cols-3 gap-2"><Field label="Start" name="start" type="time" defaultValue="09:00" required /><Field label="End" name="end" type="time" defaultValue="18:00" required /><Field label="Grace (min)" name="grace" type="number" defaultValue={15} min={0} max={120} required /></div>
                </Form>
              </div>
            </div>
            <div className="card"><h3>Assign a shift</h3>
              <Form action="assignShift" args={[["#:userId"], "#:shiftId"]} submit="Assign">
                <Select label="Employee" name="userId" options={users.map((u) => ({ value: u.id, label: u.name }))} />
                <Select label="Shift" name="shiftId" options={[{ value: "", label: "No shift" }, ...shifts.map((x) => ({ value: x.id, label: `${x.name} ${x.startTime}–${x.endTime}` }))]} />
              </Form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
