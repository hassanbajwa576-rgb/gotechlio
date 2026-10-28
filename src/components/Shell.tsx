import Link from "next/link";
import type { Actor } from "@/server/core";
import { isAdmin, isHR } from "@/server/core";
import type { Membership } from "@/server/people";
import { CompanySwitcher, NavLink, UserMenu } from "./ShellClient";

const NAV = [
  { href: "/home", label: "Home", hr: false },
  { href: "/people", label: "People", hr: false },
  { href: "/time", label: "Time", hr: false },
  { href: "/requests", label: "Requests", hr: false },
  { href: "/payroll", label: "Payroll", hr: false },
  { href: "/talent", label: "Talent", hr: false },
  { href: "/engage", label: "Engage", hr: false },
  { href: "/admin", label: "Admin", hr: true },
];

export default function Shell({ actor, badge, companies, children }: { actor: Actor; badge: number; companies: Membership[]; children: React.ReactNode }) {
  const items = NAV.filter((n) => !n.hr || isHR(actor));
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-2.5 backdrop-blur md:h-screen md:w-60 md:shrink-0 md:flex-col md:items-stretch md:gap-4 md:border-b-0 md:border-r md:px-4 md:py-5"
        style={{ borderColor: "var(--line)", background: "rgba(246,245,251,.92)" }}>
        <Link href="/home" className="flex shrink-0 items-center gap-2 md:px-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl text-lg font-bold text-white" style={{ background: "var(--rail)" }}>G</span>
          <span className="hidden text-lg font-bold sm:inline">Go<span style={{ color: "var(--violet)" }}>techlio</span></span>
        </Link>
        <div className="min-w-0 shrink-0 md:w-full">
          <CompanySwitcher current={actor.companyId} companies={companies} canCreate={isAdmin(actor)} />
        </div>
        <nav aria-label="Main" className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-full border p-1 md:flex-none md:flex-col md:overflow-visible md:rounded-3xl md:p-1.5"
          style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          {items.map((n) => <NavLink key={n.href} href={n.href} label={n.label} badge={n.label === "Requests" ? badge : 0} />)}
        </nav>
        <div className="md:mt-auto"><UserMenu name={actor.name} role={actor.role} /></div>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-[1200px] flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
