import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { COOKIE, cookieOptions, getSession, signSession } from "@/lib/session";
import { membershipIn } from "@/server/people";

export const runtime = "nodejs";

/** Switch the active company. Only companies where this account has an active employee record are allowed. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { companyId } = await req.json().catch(() => ({}));
  const target = Number.isInteger(companyId) ? await membershipIn(getDb(), session.accountId, companyId) : null;
  if (!target) return NextResponse.json({ error: "You don't have access to that company." }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await signSession({ userId: target.id, accountId: session.accountId }), cookieOptions);
  return res;
}
