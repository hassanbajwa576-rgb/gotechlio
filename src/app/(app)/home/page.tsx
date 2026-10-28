import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { getCtx } from "@/lib/ctx";
import { balances, teamOnLeaveToday } from "@/server/requests";
import { recentHours, todayStatus, timesheet } from "@/server/attendance";
import { anniversariesThisMonth, listAnnouncements, myActivity } from "@/server/talent";
import { toLocalDate } from "@/server/core";
import { ClockControls, LiveClock, Ring, WeekStrip } from "@/components/HomeWidgets";
import { Progress } from "@/components/ui";
import { fmtDate, fmtTime, hm } from "@/components/Tabs";

export default async function Home() {
  const { db, actor } = await getCtx();
  const now = new Date();
  const month = toLocalDate(now).slice(0, 7);
  const year = Number(month.slice(0, 4));
  const [status, week, ts, bal, feed, ann, away, anniv, mine] = await Promise.all([
    todayStatus(db, actor.id), recentHours(db, actor.id, 7), timesheet(db, actor.id, month), balances(db, actor.id, year),
    myActivity(db, actor.id, 5), listAnnouncements(db, actor.companyId, 4), teamOnLeaveToday(db, actor.companyId), anniversariesThisMonth(db, actor.companyId),
    db.select({ id: s.requests.id }).from(s.requests).where(and(eq(s.requests.userId, actor.id), eq(s.requests.status, "PENDING"))),
  ]);
  const annual = bal.find((b) => b.name === "Annual");
  const day = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Karachi" });
  const live = !!status.checkIn && !status.checkOut;

  return (
    <div className="space-y-4">
      <section className="rise relative overflow-hidden rounded-3xl p-6 text-white md:p-8" style={{ background: "var(--rail)" }}>
        <span aria-hidden className="absolute -right-10 -top-10 h-52 w-52 rounded-full" style={{ background: "var(--violet)", opacity: 0.55 }} />
        <span aria-hidden className="absolute -bottom-16 right-24 h-40 w-40 rounded-full" style={{ background: "var(--teal-soft)", opacity: 0.35 }} />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm text-white/70">{day}</p>
            <h1 className="mb-3 text-2xl font-bold md:text-3xl">Hello, {actor.name.split(" ")[0]}</h1>
            <LiveClock />
            <p className="mt-2 flex items-center gap-2 text-sm text-white/80">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: live ? "var(--teal-soft)" : "#8a86c4", animation: live ? "pulse-ring 1.6s infinite" : undefined }} />
              {status.checkOut ? `Checked out at ${fmtTime(status.checkOut)} · worked ${hm(status.worked)}` : status.checkIn ? `Checked in at ${fmtTime(status.checkIn)}${status.late ? " (late)" : ""} · worked ${hm(status.worked)}${status.onBreak ? " · on break" : ""}` : "You haven't checked in yet"}
            </p>
          </div>
          <ClockControls checkedIn={!!status.checkIn} checkedOut={!!status.checkOut} onBreak={status.onBreak} />
        </div>
      </section>

      <section className="grid-auto" aria-label="This month">
        <Ring value={ts.presentDays} max={22} color="#534AB7" label="Days present" suffix="of ~22 working days" />
        <Ring value={Math.round(ts.totalMinutes / 60)} max={176} color="#0F6E56" label="Hours worked" suffix="of ~176 hours" />
        <Ring value={Math.max(0, annual?.available ?? 0)} max={annual?.allotted ?? 14} color="#D85A30" label="Annual leave left" suffix={`of ${annual?.allotted ?? 14} days`} />
        <Ring value={mine.length} max={Math.max(5, mine.length)} color="#BA7517" label="Pending requests" suffix="awaiting a decision" />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card rise lg:col-span-3"><h3>Your last 7 days</h3><WeekStrip values={week} /></div>
        <div className="card rise lg:col-span-2">
          <h3>Leave balance</h3>
          <div className="space-y-3">
            {bal.map((b) => (
              <div key={b.leaveTypeId}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{b.name}</span><span style={{ color: "var(--muted)" }}>{b.paid ? `${b.available} of ${b.allotted} days` : `${b.used} taken`}</span></div>
                {b.paid && <Progress value={(b.available / Math.max(1, b.allotted)) * 100} color="var(--teal-soft)" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card rise">
          <h3>Recent activity</h3>
          {feed.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>Nothing new yet.</p> : (
            <ol className="relative ml-2 space-y-3 border-l pl-4" style={{ borderColor: "var(--line)" }}>
              {feed.map((f) => (
                <li key={f.id} className="relative text-sm">
                  <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: "var(--violet-soft)" }} />
                  {f.text}
                  <div className="text-xs" style={{ color: "var(--muted)" }}>{fmtDate(f.createdAt)}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card rise">
          <h3>Team today</h3>
          {away.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>Everyone is in.</p> :
            <ul className="space-y-1.5 text-sm">{away.map((a, i) => <li key={i} className="flex items-center justify-between"><span>{a.name}</span><span className="badge b-info">{a.type === "LEAVE" ? "On leave" : "Remote"}</span></li>)}</ul>}
          {anniv.length > 0 && <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>Work anniversaries this month: {anniv.map((a) => a.name.split(" ")[0]).join(", ")}</p>}
        </div>
      </div>

      <section aria-label="Announcements">
        <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--muted)" }}>Announcements</h2>
        {ann.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>No announcements.</p> : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {ann.map((a, i) => (
              <article key={a.id} className="card rise min-w-[260px] flex-1" style={{ borderTop: `4px solid ${["#534AB7", "#0F6E56", "#D85A30", "#BA7517"][i % 4]}` }}>
                <div className="font-semibold">{a.title}</div>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{a.body}</p>
                <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{a.author} · {fmtDate(a.createdAt)}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
