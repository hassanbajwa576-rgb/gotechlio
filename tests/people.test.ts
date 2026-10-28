import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, rejects } from "./helpers";
import * as p from "@/server/people";
import { listShifts } from "@/server/admin";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";

let ctx: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => { ctx = await freshDb(); });

describe("login", () => {
  it("accepts correct credentials", async () => {
    const a = await p.verifyLogin(ctx.db, "ADMIN@techlio.co ", "Techlio@123");
    expect(a.actor.role).toBe("ADMIN");
  });
  it("rejects wrong password and unknown email with the same message", async () => {
    await rejects(p.verifyLogin(ctx.db, "admin@techlio.co", "nope"), /Wrong email or password/);
    await rejects(p.verifyLogin(ctx.db, "ghost@techlio.co", "Techlio@123"), /Wrong email or password/);
  });
  it("blocks deactivated users", async () => {
    const u = await p.createEmployee(ctx.db, ctx.H, { name: "Temp", email: "temp@techlio.co", password: "password1" });
    await p.setActive(ctx.db, ctx.H, u.id, false);
    await rejects(p.verifyLogin(ctx.db, "temp@techlio.co", "password1"), /deactivated/);
  });
  it("changes password only with the right current one", async () => {
    await rejects(p.changePassword(ctx.db, ctx.E, "wrong", "newpassword1"), /current password/);
    await rejects(p.changePassword(ctx.db, ctx.E, "Techlio@123", "short"), /8 characters/);
    await p.changePassword(ctx.db, ctx.E, "Techlio@123", "Newpass@123");
    await p.verifyLogin(ctx.db, "employee@techlio.co", "Newpass@123");
    await p.changePassword(ctx.db, ctx.E, "Newpass@123", "Techlio@123");
  });
});

describe("create employee", () => {
  it("creates balances, onboarding checklist and salary", async () => {
    const u = await p.createEmployee(ctx.db, ctx.H, { name: "New Hire", email: "new@techlio.co", password: "password1", joinDate: "2026-03-01", basic: 100000 });
    const bal = await ctx.db.select().from(s.leaveBalances).where(eq(s.leaveBalances.userId, u.id));
    expect(bal).toHaveLength(4);
    expect((await p.listTasks(ctx.db, u.id)).length).toBe(p.DEFAULT_ONBOARDING.length);
    const [sal] = await ctx.db.select().from(s.salaryStructures).where(eq(s.salaryStructures.userId, u.id));
    expect(sal.basic).toBe(100000);
  });
  it("rejects bad input", async () => {
    const base = { name: "X", email: "x@techlio.co", password: "password1" };
    await rejects(p.createEmployee(ctx.db, ctx.H, { ...base, name: " " }), /Name is required/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { ...base, email: "not-an-email" }), /valid email/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { ...base, password: "short" }), /8 characters/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { ...base, joinDate: "2026-13-45" }), /Join date/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { ...base, managerId: 9999 }), /Manager not found/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { ...base, basic: -5 }), /negative/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { ...base, email: "employee@techlio.co" }), /already exists/);
  });
  it("only HR/admin may create; only admins create admins", async () => {
    await rejects(p.createEmployee(ctx.db, ctx.E, { name: "Y", email: "y@techlio.co", password: "password1" }), /HR or admins/);
    await rejects(p.createEmployee(ctx.db, ctx.H, { name: "Y", email: "y@techlio.co", password: "password1", role: "ADMIN" }), /Only admins/);
    await p.createEmployee(ctx.db, ctx.A, { name: "Y", email: "y@techlio.co", password: "password1", role: "ADMIN" });
  });
});

describe("update employee", () => {
  it("lets an employee change only their phone", async () => {
    await p.updateEmployee(ctx.db, ctx.E, ctx.E.id, { phone: "0300-1234567" });
    await rejects(p.updateEmployee(ctx.db, ctx.E, ctx.E.id, { title: "CEO" }), /only change your phone/);
    await rejects(p.updateEmployee(ctx.db, ctx.E, ctx.E2.id, { phone: "1" }), /your own profile/);
  });
  it("only admins change roles", async () => {
    await rejects(p.updateEmployee(ctx.db, ctx.H, ctx.E.id, { role: "MANAGER" }), /Only admins/);
    await p.updateEmployee(ctx.db, ctx.A, ctx.E2.id, { role: "EMPLOYEE" });
  });
  it("blocks self-management and reporting loops", async () => {
    await rejects(p.updateEmployee(ctx.db, ctx.H, ctx.E.id, { managerId: ctx.E.id }), /own manager/);
    // E reports to M, M reports to A. Making A report to E would loop.
    await rejects(p.updateEmployee(ctx.db, ctx.H, ctx.A.id, { managerId: ctx.E.id }), /loop/);
  });
  it("can't empty a name or edit a missing employee", async () => {
    await rejects(p.updateEmployee(ctx.db, ctx.H, ctx.E.id, { name: "  " }), /Name is required/);
    await rejects(p.updateEmployee(ctx.db, ctx.H, 99999, { title: "x" }), /not found/);
  });
  it("can't deactivate yourself", async () => {
    await rejects(p.setActive(ctx.db, ctx.H, ctx.H.id, false), /yourself/);
    await rejects(p.setActive(ctx.db, ctx.E, ctx.E2.id, false), /HR or admins/);
  });
});

describe("directory and org chart", () => {
  it("searches by name, email and title, and hides inactive", async () => {
    expect((await p.directory(ctx.db, ctx.cid, "ayesha")).map((x) => x.name)).toContain("Ayesha Khan");
    expect((await p.directory(ctx.db, ctx.cid, "designer")).length).toBe(1);
    expect((await p.directory(ctx.db, ctx.cid, "zzzz")).length).toBe(0);
    const t = await p.createEmployee(ctx.db, ctx.H, { name: "Gone Person", email: "gone@techlio.co", password: "password1" });
    await p.setActive(ctx.db, ctx.H, t.id, false);
    expect((await p.directory(ctx.db, ctx.cid, "Gone")).length).toBe(0);
  });
  it("filters by department", async () => {
    const [d] = await ctx.db.select().from(s.departments).where(eq(s.departments.name, "People & Culture"));
    const rows = await p.directory(ctx.db, ctx.cid, "", d.id);
    expect(rows.every((r) => r.department === "People & Culture")).toBe(true);
  });
  it("builds a tree rooted at the top manager", async () => {
    const tree = await p.orgChart(ctx.db, ctx.cid);
    const root = tree.find((n) => n.id === ctx.A.id)!;
    expect(root).toBeTruthy();
    const mgr = root.reports.find((n) => n.id === ctx.M.id)!;
    expect(mgr.reports.map((r) => r.id)).toContain(ctx.E.id);
  });
});

describe("documents", () => {
  it("validates, permits owner and HR, blocks others", async () => {
    await rejects(p.addDocument(ctx.db, ctx.E, ctx.E.id, "", "ID", "https://x.co/a"), /Title/);
    await rejects(p.addDocument(ctx.db, ctx.E, ctx.E.id, "CNIC", "ID", "ftp://x"), /http/);
    await rejects(p.addDocument(ctx.db, ctx.E, ctx.E2.id, "CNIC", "ID", "https://x.co/a"), /your own/);
    const d = await p.addDocument(ctx.db, ctx.E, ctx.E.id, "CNIC", "ID", "https://x.co/a");
    await rejects(p.deleteDocument(ctx.db, ctx.E2, d.id), /can't delete/);
    await p.deleteDocument(ctx.db, ctx.H, d.id);
    await rejects(p.deleteDocument(ctx.db, ctx.H, d.id), /not found/);
  });
});

describe("assets", () => {
  it("creates, assigns, blocks double assignment, returns", async () => {
    await rejects(p.createAsset(ctx.db, ctx.E, "T1", "x", "y"), /HR or admins/);
    await rejects(p.createAsset(ctx.db, ctx.H, "LAP-001", "dupe", "Laptop"), /already exists/);
    const a = await p.createAsset(ctx.db, ctx.H, "MON-001", "Dell Monitor", "Monitor");
    await p.assignAsset(ctx.db, ctx.H, a.id, ctx.E.id);
    await rejects(p.assignAsset(ctx.db, ctx.H, a.id, ctx.E2.id), /already assigned/);
    await p.assignAsset(ctx.db, ctx.H, a.id, null);
    await p.assignAsset(ctx.db, ctx.H, a.id, ctx.E2.id);
    const row = (await p.listAssets(ctx.db, ctx.cid)).find((x) => x.id === a.id)!;
    expect(row.holder).toBe("Zain Ahmed");
    await rejects(p.assignAsset(ctx.db, ctx.H, 9999, ctx.E.id), /not found/);
  });
});

describe("onboarding", () => {
  it("lets owner toggle, blocks others, HR can add tasks and see progress", async () => {
    const [t] = await p.listTasks(ctx.db, ctx.E.id);
    await p.toggleTask(ctx.db, ctx.E, t.id);
    expect((await p.listTasks(ctx.db, ctx.E.id))[0].done).toBe(true);
    await p.toggleTask(ctx.db, ctx.E, t.id);
    await rejects(p.toggleTask(ctx.db, ctx.E2, t.id), /can't change/);
    await rejects(p.addTask(ctx.db, ctx.E, ctx.E.id, "x"), /HR or admins/);
    await rejects(p.addTask(ctx.db, ctx.H, ctx.E.id, " "), /required/);
    await p.addTask(ctx.db, ctx.H, ctx.E.id, "Read handbook");
    const ov = (await p.onboardingOverview(ctx.db, ctx.cid)).find((o) => o.userId === ctx.E.id)!;
    expect(ov.total).toBe(p.DEFAULT_ONBOARDING.length + 1);
  });
});

describe("reference data", () => {
  it("seeds shifts", async () => { expect((await listShifts(ctx.db, ctx.cid)).length).toBeGreaterThanOrEqual(2); });
});
