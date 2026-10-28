"use client";
import { useState } from "react";
import { useAction } from "./ui";

/** Approve / reject controls with a note box; rejection needs a note (enforced on the server too). */
export default function Decide({ id, ticket }: { id: number; ticket?: boolean }) {
  const { run, error, busy } = useAction();
  const [note, setNote] = useState("");
  return (
    <div className="min-w-[220px]">
      <input className="input mb-2" placeholder={ticket ? "Reply or resolution note (optional)" : "Note (required to reject)"} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
      <div className="flex gap-2">
        <button className="btn btn-good btn-sm" disabled={busy} onClick={() => run("decide", id, true, note)}>{ticket ? "Resolve" : "Approve"}</button>
        <button className="btn btn-bad btn-sm" disabled={busy} onClick={() => run("decide", id, false, note)}>{ticket ? "Close" : "Reject"}</button>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}
