import { NextResponse } from "next/server";
import { publicDb } from "@/lib/ctx";
import { AppError } from "@/server/core";
import { applyToJob } from "@/server/talent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { jobId, name, email } = await req.json().catch(() => ({}));
  try {
    await applyToJob(await publicDb(), Number(jobId), String(name ?? ""), String(email ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
