"use client";
import { useState, type FormEvent } from "react";

export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const v = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    const json = await res.json().catch(() => ({}));
    if (res.ok) { window.location.href = "/home"; return; }
    setError(json.error || "Couldn't sign in.");
    setBusy(false);
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between p-10 text-white md:flex" style={{ background: "var(--rail)" }}>
        <div className="flex items-center gap-2 text-xl font-bold"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--violet-soft)" }}>G</span>Gotechlio</div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">People, time and payroll.<br />One calm place.</h1>
          <p className="mt-3 max-w-sm" style={{ color: "#cecbf6" }}>Check in, request leave, see payslips and grow with your team.</p>
        </div>
        <div className="text-sm" style={{ color: "#b5b1e6" }}>© Techlio</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="card rise w-full max-w-sm" style={{ padding: 24 }}>
          <h2 className="text-2xl font-bold">Welcome back</h2>
          <p className="mb-2 text-sm" style={{ color: "var(--muted)" }}>Sign in with your work email.</p>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="input" placeholder="name@techlio.co" autoComplete="username" />
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required className="input" autoComplete="current-password" />
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn btn-primary mt-4 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="mt-4 text-center text-sm"><a href="/careers" style={{ color: "var(--violet)" }}>View open jobs</a></p>
        </form>
      </div>
    </div>
  );
}
