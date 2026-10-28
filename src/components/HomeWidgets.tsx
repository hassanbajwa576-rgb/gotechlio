"use client";
import { useEffect, useRef, useState } from "react";
import { Btn } from "./ui";

/** True when it's reasonable to play an entrance animation: tab is visible and the person hasn't asked for less motion. */
const canAnimate = () => typeof document !== "undefined" && !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Renders the real number straight away (server render, background tab, reduced motion) and only counts up on first view. */
export function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(to);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || !canAnimate()) { first.current = false; setN(to); return; }
    first.current = false;
    let cur = 0;
    setN(0);
    const step = Math.max(1, Math.round(to / 30));
    const t = setInterval(() => { cur += step; if (cur >= to) { cur = to; clearInterval(t); } setN(cur); }, 30);
    return () => { clearInterval(t); setN(to); };
  }, [to]);
  return <>{n}</>;
}

export function LiveClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi" }));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, []);
  return <span className="text-5xl font-bold tabular-nums tracking-tight md:text-6xl">{now || "--:--:--"}</span>;
}

/** Ring gauge: value as a share of max, with the number counting up in the middle. */
export function Ring({ value, max, color, label, suffix = "" }: { value: number; max: number; color: string; label: string; suffix?: string }) {
  const target = Math.min(1, value / Math.max(1, max));
  const [p, setP] = useState(target); // full ring by default; it only sweeps in from empty on first view
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || !canAnimate()) { first.current = false; setP(target); return; }
    first.current = false;
    setP(0);
    const t = setTimeout(() => setP(target), 150);
    return () => { clearTimeout(t); setP(target); };
  }, [target]);
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div className="card rise flex items-center gap-4 transition hover:-translate-y-1">
      <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${label}: ${value}${suffix}`}>
        <circle cx="42" cy="42" r={R} fill="none" stroke="var(--line)" strokeWidth="9" />
        <circle cx="42" cy="42" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)}
          transform="rotate(-90 42 42)" style={{ transition: "stroke-dashoffset 1.2s ease-out" }} />
        <text x="42" y="47" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--ink)"><CountUp to={value} /></text>
      </svg>
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>{suffix || "this month"}</div>
      </div>
    </div>
  );
}

/** Week strip: one pill per day, filled by hours worked. */
export function WeekStrip({ values }: { values: { date: string; minutes: number }[] }) {
  const max = Math.max(480, ...values.map((v) => v.minutes));
  return (
    <div className="flex items-end justify-between gap-2" role="img" aria-label="Hours worked, last 7 days">
      {values.map((v, i) => {
        const d = new Date(v.date + "T00:00:00Z");
        return (
          <div key={v.date} className="flex flex-1 flex-col items-center gap-2" title={`${v.date}: ${(v.minutes / 60).toFixed(1)} h`}>
            <div className="relative flex h-32 w-full max-w-[44px] items-end overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              <div className="w-full rounded-full" style={{ height: `${Math.max(v.minutes ? 8 : 0, (v.minutes / max) * 100)}%`, background: "var(--violet-soft)", transformOrigin: "bottom", animation: `grow .8s ${0.2 + i * 0.07}s both` }} />
            </div>
            <span className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>{d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ClockControls({ checkedIn, checkedOut, onBreak }: { checkedIn: boolean; checkedOut: boolean; onBreak: boolean }) {
  if (checkedOut) return <p className="text-sm text-white/80">You&apos;re done for today. See you tomorrow.</p>;
  if (!checkedIn) return <Btn action="checkIn" kind="good">Check in</Btn>;
  return (
    <div className="flex flex-wrap gap-2">
      <Btn action="checkOut" kind="bad">Check out</Btn>
      {onBreak ? <Btn action="endBreak">End break</Btn> : <Btn action="startBreak">Start break</Btn>}
    </div>
  );
}
