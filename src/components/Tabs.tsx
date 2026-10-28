import Link from "next/link";

/** URL-driven tabs so each tab is a server-rendered page state: /people?tab=org */
export default function Tabs({ base, tabs, current }: { base: string; tabs: { id: string; label: string }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.id} href={`${base}?tab=${t.id}`} className={t.id === current ? "on" : ""} aria-current={t.id === current ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

export const pickTab = (sp: { tab?: string }, tabs: { id: string }[]) => (tabs.some((t) => t.id === sp.tab) ? sp.tab! : tabs[0].id);

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === "string" ? d + "T00:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: typeof d === "string" ? "UTC" : "Asia/Karachi" }) : "—";
export const fmtTime = (d: Date | null | undefined) => (d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" }) : "—");
export const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
export const money = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });
