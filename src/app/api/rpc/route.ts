import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { COOKIE, cookieOptions, getSession, signSession } from "@/lib/session";
import { AppError } from "@/server/core";
import { resolveActor } from "@/server/people";
import { actions } from "@/server/actions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  const db = getDb();
  const actor = session ? await resolveActor(db, session.userId, session.accountId) : null;
  if (!session || !actor) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  let body: { action?: string; args?: unknown[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const fn = body.action ? actions[body.action] : undefined;
  if (!fn) return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  try {
    const data = await fn(db, actor, ...(Array.isArray(body.args) ? body.args : []));
    const res = NextResponse.json({ data: data ?? null });
    // Creating a company makes you its admin; switch straight into it.
    if (body.action === "createCompany" && data && typeof data === "object" && "userId" in data) {
      res.cookies.set(COOKIE, await signSession({ userId: Number((data as { userId: number }).userId), accountId: session.accountId }), cookieOptions);
    }
    return res;
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("rpc failure", body.action, e);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
