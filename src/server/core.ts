export type Role = "ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";
/** The signed-in person acting inside one company. `id` is their employee record in `companyId`. */
export type Actor = { id: number; role: Role; name: string; companyId: number };

/** Expected business-rule failure; message is safe to show to the user. */
export class AppError extends Error {}

export const fail = (msg: string): never => { throw new AppError(msg); };

export const TZ = process.env.APP_TIMEZONE || "Asia/Karachi";

export const isHR = (a: Actor) => a.role === "ADMIN" || a.role === "HR";
export const isAdmin = (a: Actor) => a.role === "ADMIN";
export const isManagerish = (a: Actor) => isHR(a) || a.role === "MANAGER";

export function requireHR(a: Actor) { if (!isHR(a)) fail("Only HR or admins can do this."); }
export function requireAdmin(a: Actor) { if (!isAdmin(a)) fail("Only admins can do this."); }

/** YYYY-MM-DD in the company timezone. */
export function toLocalDate(d: Date, tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** HH:MM in the company timezone. */
export function toLocalTime(d: Date, tz = TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

export function isValidTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export const isWeekend = (iso: string) => { const day = new Date(iso + "T00:00:00Z").getUTCDay(); return day === 0 || day === 6; };

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build a Date for a local HH:MM on a local date in the company timezone. */
export function localDateTime(date: string, hhmm: string, tz = TZ): Date {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  const utcShown = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (shown.getTime() - utcShown.getTime()));
}
