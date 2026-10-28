import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Every run starts from a fresh embedded database; a warm-up login triggers migrate + seed before any test runs. */
export default async function globalSetup() {
  fs.rmSync(path.join(os.tmpdir(), "gotechlio-e2e-db"), { recursive: true, force: true });
  const res = await fetch("http://localhost:3200/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@techlio.co", password: "Techlio@123" }),
  });
  if (!res.ok) throw new Error(`Warm-up login failed: ${res.status}`);
  for (const p of ["/home", "/people", "/time", "/requests", "/payroll", "/talent", "/engage", "/admin", "/careers"]) await fetch(`http://localhost:3200${p}`, { headers: { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] } });
}
