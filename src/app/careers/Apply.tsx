"use client";
import { useState, type FormEvent } from "react";

export default function Apply({ jobId }: { jobId: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const v = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/careers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, ...v }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setDone(true); else setError(json.error || "Couldn't submit your application.");
  }

  if (done) return <p className="mt-3 font-semibold" style={{ color: "var(--teal)" }}>Thanks! Your application is in.</p>;
  if (!open) return <button className="btn btn-primary mt-3" onClick={() => setOpen(true)}>Apply</button>;
  return (
    <form onSubmit={submit} className="mt-3">
      <label className="label" htmlFor={`n${jobId}`}>Full name</label><input id={`n${jobId}`} name="name" className="input" required />
      <label className="label" htmlFor={`e${jobId}`}>Email</label><input id={`e${jobId}`} name="email" type="email" className="input" required />
      {error && <div className="err" role="alert">{error}</div>}
      <button className="btn btn-primary mt-3" disabled={busy}>{busy ? "Sending…" : "Submit application"}</button>
    </form>
  );
}
