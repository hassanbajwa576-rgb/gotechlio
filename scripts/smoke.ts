/* Signs in as each role and loads every page/tab; fails on any non-200, error page, or wrong access. */
const BASE = process.env.BASE_URL || "http://localhost:3100";
const PASSWORD = "Techlio@123";

const ROLES = { admin: "admin@techlio.co", hr: "hr@techlio.co", manager: "manager@techlio.co", employee: "employee@techlio.co" } as const;

const TABS: Record<string, string[]> = {
  "/home": [""],
  "/people": ["directory", "org", "documents", "onboarding", "assets"],
  "/time": ["today", "timesheet", "schedule", "whosin", "shifts"],
  "/requests": ["leave", "wfh", "expense", "punch", "ticket", "approvals"],
  "/payroll": ["payslips", "runs", "salaries", "settlement"],
  "/talent": ["performance", "training", "recruitment"],
  "/engage": ["news", "kudos", "surveys"],
  "/admin": ["employees", "leave", "holidays", "departments", "settings"],
};

async function login(email: string) {
  const res = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

let failures = 0, checks = 0;
const check = (ok: boolean, msg: string) => { checks++; if (!ok) { failures++; console.error("FAIL", msg); } };

async function main() {
  for (const [role, email] of Object.entries(ROLES)) {
    const cookie = await login(email);
    for (const [path, tabs] of Object.entries(TABS)) {
      for (const tab of tabs) {
        const url = `${BASE}${path}${tab ? `?tab=${tab}` : ""}`;
        const res = await fetch(url, { headers: { cookie }, redirect: "follow" });
        const html = await res.text();
        const restricted = path === "/admin" && !["admin", "hr"].includes(role);
        if (restricted) { check(new URL(res.url).pathname === "/home", `${role} must be redirected away from ${url}, got ${res.url}`); continue; }
        check(res.status === 200, `${role} ${url} → ${res.status}`);
        check(!/Application error|Unhandled Runtime Error|Internal Server Error|data-dgst|"digest":"[^$]/i.test(html), `${role} ${url} rendered an error`);
      }
    }
    for (const p of ["/people/1", "/people/2", "/payroll/slip/1", "/requests/1"]) {
      const res = await fetch(`${BASE}${p}`, { headers: { cookie } });
      check([200, 404].includes(res.status), `${role} ${p} → ${res.status}`);
    }
    console.log(`${role}: done`);
  }
  // Unauthenticated access is blocked.
  const anon = await fetch(`${BASE}/home`, { redirect: "manual" });
  check(anon.status === 307 || anon.status === 308, `anonymous /home should redirect, got ${anon.status}`);
  const rpc = await fetch(`${BASE}/api/rpc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkIn", args: [] }) });
  check(rpc.status === 401, `anonymous rpc should be 401, got ${rpc.status}`);
  const careers = await fetch(`${BASE}/careers`);
  check(careers.status === 200, `public careers → ${careers.status}`);
  console.log(`${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}
main();
