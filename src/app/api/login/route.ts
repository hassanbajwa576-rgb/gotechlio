import { NextResponse } from "next/server";
import { publicDb } from "@/lib/ctx";
import { COOKIE, cookieOptions, signSession } from "@/lib/session";
import { AppError } from "@/server/core";
import { verifyLogin } from "@/server/people";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  try {
    const { accountId, actor } = await verifyLogin(await publicDb(), email, password);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, await signSession({ userId: actor.id, accountId }), cookieOptions);
    return res;
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}
