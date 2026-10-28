import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const COOKIE = "gotechlio_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-only-secret-change-me-please-32chars");

/** What the cookie proves: this account is acting as this employee record. Role and company are re-read from the database on every request. */
export type Session = { userId: number; accountId: number };

export async function signSession(s: Session) {
  return new SignJWT({ aid: s.accountId }).setProtectedHeader({ alg: "HS256" })
    .setSubject(String(s.userId)).setIssuedAt().setExpirationTime("7d").sign(secret());
}

export async function readToken(token?: string): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const userId = Number(payload.sub), accountId = Number(payload.aid);
    return Number.isInteger(userId) && Number.isInteger(accountId) ? { userId, accountId } : null;
  } catch { return null; }
}

export async function getSession(): Promise<Session | null> {
  return readToken((await cookies()).get(COOKIE)?.value);
}

export const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400 };
