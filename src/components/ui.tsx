"use client";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode, type FormEvent } from "react";

export async function rpc<T = unknown>(action: string, ...args: unknown[]): Promise<T> {
  const res = await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) });
  const json = await res.json().catch(() => ({ error: "Unexpected response." }));
  if (res.status === 401) { window.location.href = "/login"; throw new Error(json.error); }
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json.data as T;
}

/** Runs an action, shows its error inline, refreshes server data on success. */
export function useAction() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run<T = unknown>(action: string, ...args: unknown[]): Promise<T | undefined> {
    setBusy(true); setError("");
    try {
      const out = await rpc<T>(action, ...args);
      router.refresh();
      return out;
    } catch (e) { setError((e as Error).message); return undefined; }
    finally { setBusy(false); }
  }
  return { run, error, busy, setError };
}

export function Btn({ action, args, children, kind = "", small, confirm, onDone, disabled }: {
  action: string; args?: unknown[]; children: ReactNode; kind?: "primary" | "good" | "bad" | ""; small?: boolean; confirm?: string; onDone?: () => void; disabled?: boolean;
}) {
  const { run, error, busy } = useAction();
  return (
    <span>
      <button type="button" disabled={busy || disabled} className={`btn ${kind ? "btn-" + kind : ""} ${small ? "btn-sm" : ""}`}
        onClick={async () => { if (confirm && !window.confirm(confirm)) return; const r = await run(action, ...(args ?? [])); if (r !== undefined || !error) onDone?.(); }}>
        {children}
      </button>
      {error && <div className="err" role="alert">{error}</div>}
    </span>
  );
}

/** Fills a serializable template from form values: "$:x" text, "#:x" number (null if empty), "?:x" boolean ("true"), "%:x" percent → fraction. */
export function resolve(t: unknown, v: Record<string, string>): unknown {
  if (typeof t === "string") {
    if (t.startsWith("$:")) return v[t.slice(2)] ?? "";
    if (t.startsWith("#:")) { const x = v[t.slice(2)]; return x === undefined || x === "" ? null : Number(x); }
    if (t.startsWith("?:")) return v[t.slice(2)] === "true";
    if (t.startsWith("%:")) { const x = v[t.slice(2)]; return x === undefined || x === "" ? null : Math.round(Number(x) * 10) / 1000; }
    return t;
  }
  if (Array.isArray(t)) return t.map((x) => resolve(x, v));
  if (t && typeof t === "object") return Object.fromEntries(Object.entries(t).map(([k, x]) => [k, resolve(x, v)]));
  return t;
}

/** A form that collects named fields and calls an action with args filled from a template. */
export function Form({ action, args, children, submit = "Save", reset = true, kind = "primary" }: {
  action: string; args: unknown[]; children: ReactNode; submit?: string; reset?: boolean; kind?: "primary" | "good" | "";
}) {
  const { run, error, busy } = useAction();
  const [ok, setOk] = useState("");
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    setOk("");
    const r = await run(action, ...(resolve(args, v) as unknown[]));
    if (r !== undefined) { setOk("Saved"); if (reset) form.reset(); }
  }
  return (
    <form onSubmit={onSubmit}>
      {children}
      <div className="mt-3 flex items-center gap-3">
        <button className={`btn ${kind ? "btn-" + kind : ""}`} disabled={busy}>{busy ? "Saving…" : submit}</button>
        {ok && !error && <span className="text-sm" style={{ color: "var(--teal)" }}>{ok}</span>}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
    </form>
  );
}

/** Ids must be unique per page or labels bind to the wrong control, so each field gets its own. */
export function Field({ label, name, type = "text", placeholder, defaultValue, required, min, max, step }: {
  label: string; name: string; type?: string; placeholder?: string; defaultValue?: string | number; required?: boolean; min?: string | number; max?: string | number; step?: string;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} className="input" placeholder={placeholder} defaultValue={defaultValue} required={required} min={min} max={max} step={step} />
    </div>
  );
}

export function Select({ label, name, options, defaultValue }: { label: string; name: string; options: { value: string | number; label: string }[]; defaultValue?: string | number }) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} name={name} className="input" defaultValue={defaultValue}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Area({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <textarea id={id} name={name} className="input" rows={3} placeholder={placeholder} />
    </div>
  );
}

export function Badge({ status }: { status: string }) {
  const cls = status === "PENDING" ? "b-pending" : status === "APPROVED" ? "b-approved" : status === "REJECTED" ? "b-rejected" : "b-muted";
  return <span className={`badge ${cls}`}>{status[0] + status.slice(1).toLowerCase()}</span>;
}

export function Progress({ value, color = "var(--violet-soft)" }: { value: number; color?: string }) {
  return <div className="h-2 rounded-full" style={{ background: "var(--line)" }}><div className="h-2 rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>;
}

export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold" style={{ color: "var(--violet)" }}>{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
