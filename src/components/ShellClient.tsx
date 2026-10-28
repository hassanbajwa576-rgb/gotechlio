"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function NavLink({ href, label, badge }: { href: string; label: string; badge: number }) {
  const path = usePathname();
  const on = path === href || path.startsWith(href + "/");
  return (
    <Link href={href} aria-current={on ? "page" : undefined}
      className="relative flex shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition hover:translate-x-0.5 md:w-full"
      style={{ background: on ? "var(--violet)" : "transparent", color: on ? "#fff" : "var(--ink)" }}>
      <span>{label}</span>
      {badge > 0 && <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: "var(--coral)" }}>{badge}</span>}
    </Link>
  );
}

type Company = { companyId: number; company: string; role: string };

/** Shows the active company and lets the person switch to any other company they belong to. */
export function CompanySwitcher({ current, companies, canCreate }: { current: number; companies: Company[]; canCreate: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = companies.find((c) => c.companyId === current);

  async function switchTo(companyId: number) {
    setBusy(true); setError("");
    const res = await fetch("/api/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) });
    if (res.ok) { window.location.href = "/home"; return; }
    setError((await res.json().catch(() => ({}))).error || "Couldn't switch company.");
    setBusy(false);
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    const res = await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createCompany", args: [name] }) });
    if (res.ok) { window.location.href = "/home"; return; }
    setError((await res.json().catch(() => ({}))).error || "Couldn't create the company.");
    setBusy(false);
  }

  return (
    <details className="relative" aria-label="Company">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <span className="truncate">{active?.company ?? "Company"}</span>
        <span aria-hidden style={{ color: "var(--muted)" }}>⇅</span>
      </summary>
      <div className="card absolute left-0 top-full z-30 mt-2 w-64 shadow-lg" style={{ padding: 10 }}>
        <div className="mb-1 px-2 text-xs font-semibold" style={{ color: "var(--muted)" }}>Your companies</div>
        <ul>
          {companies.map((c) => (
            <li key={c.companyId}>
              <button disabled={busy || c.companyId === current} onClick={() => switchTo(c.companyId)}
                className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-sm hover:bg-[var(--bg)] disabled:cursor-default"
                aria-current={c.companyId === current ? "true" : undefined}>
                <span className="truncate font-semibold">{c.company}</span>
                <span className="ml-2 shrink-0 text-xs capitalize" style={{ color: "var(--muted)" }}>{c.companyId === current ? "current" : c.role.toLowerCase()}</span>
              </button>
            </li>
          ))}
        </ul>
        {canCreate && (
          <form onSubmit={create} className="mt-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
            <label className="label" htmlFor="newCompany">Add a company</label>
            <div className="flex gap-2">
              <input id="newCompany" name="name" className="input" placeholder="Company name" required maxLength={80} />
              <button className="btn btn-primary btn-sm" disabled={busy}>Add</button>
            </div>
          </form>
        )}
        {error && <div className="err" role="alert">{error}</div>}
      </div>
    </details>
  );
}

export function UserMenu({ name, role }: { name: string; role: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <details className="relative md:w-full">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border py-1 pl-1 pr-3 md:w-full" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: "var(--violet-soft)" }}>{initials}</span>
        <span className="hidden min-w-0 text-sm font-semibold sm:inline md:flex-1 md:truncate">{name}</span>
      </summary>
      <div className="card absolute right-0 top-full z-30 mt-2 w-52 shadow-lg md:bottom-full md:left-0 md:right-auto md:top-auto md:mb-2 md:mt-0" style={{ padding: 12 }}>
        <div className="font-semibold">{name}</div>
        <div className="mb-3 text-xs capitalize" style={{ color: "var(--muted)" }}>{role.toLowerCase()}</div>
        <button className="btn btn-sm w-full"
          onClick={async () => { await fetch("/api/login", { method: "DELETE" }); window.location.href = "/login"; }}>
          Sign out
        </button>
      </div>
    </details>
  );
}
