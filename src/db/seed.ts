import { eq } from "drizzle-orm";
import type { DB } from "./index";
import * as s from "./schema";
import { createEmployee } from "@/server/people";
import { seedCompanyDefaults } from "@/server/admin";

export const DEMO_PASSWORD = "Techlio@123";

/** A demo company with one user per role plus sample content. The admin is also admin of a second company. */
export async function seedDemo(db: DB) {
  const [co] = await db.insert(s.companies).values({ name: "Techlio", slug: "techlio" }).returning();
  await seedCompanyDefaults(db, co.id);
  const deps = await db.insert(s.departments).values([
    { companyId: co.id, name: "Engineering" }, { companyId: co.id, name: "People & Culture" }, { companyId: co.id, name: "Sales" },
  ]).returning();
  const dep = (n: string) => deps.find((d) => d.name === n)!.id;
  const [day] = await db.select().from(s.shifts).where(eq(s.shifts.companyId, co.id));

  const mk = (name: string, email: string, role: "ADMIN" | "HR" | "MANAGER" | "EMPLOYEE", title: string, d: string, managerId: number | null, basic: number) =>
    createEmployee(db, null, { companyId: co.id, name, email, password: DEMO_PASSWORD, role, title, departmentId: dep(d), managerId, shiftId: day.id, joinDate: "2025-01-06", basic, allowances: Math.round(basic * 0.1), deductions: 0 });

  const admin = await mk("Hassan Bajwa", "admin@techlio.co", "ADMIN", "Founder", "Engineering", null, 400000);
  const hr = await mk("Sara Malik", "hr@techlio.co", "HR", "HR Lead", "People & Culture", admin.id, 180000);
  const mgr = await mk("Ayesha Khan", "manager@techlio.co", "MANAGER", "Engineering Manager", "Engineering", admin.id, 300000);
  await mk("Ali Raza", "employee@techlio.co", "EMPLOYEE", "Software Engineer", "Engineering", mgr.id, 150000);
  await mk("Zain Ahmed", "zain@techlio.co", "EMPLOYEE", "Designer", "Engineering", mgr.id, 140000);

  await db.insert(s.holidays).values([{ companyId: co.id, date: "2026-12-25", name: "Quaid-e-Azam Day" }, { companyId: co.id, date: "2026-08-14", name: "Independence Day" }]);
  await db.insert(s.courses).values([
    { companyId: co.id, title: "Security awareness", description: "Phishing, passwords and safe habits.", hours: 2 },
    { companyId: co.id, title: "Effective code reviews", description: "Give and receive better feedback.", hours: 3 },
  ]);
  await db.insert(s.announcements).values({ companyId: co.id, title: "Welcome to Gotechlio", body: "Use Time to check in, Requests for leave, and Payroll for payslips.", authorId: hr.id });
  await db.insert(s.assets).values([{ companyId: co.id, tag: "LAP-001", name: "MacBook Pro 14", category: "Laptop" }, { companyId: co.id, tag: "LAP-002", name: "ThinkPad X1", category: "Laptop" }]);
  const [job] = await db.insert(s.jobs).values({ companyId: co.id, title: "Senior Frontend Engineer", departmentId: dep("Engineering"), location: "Lahore", description: "Build the Techlio platform." }).returning();
  await db.insert(s.candidates).values({ jobId: job.id, name: "Maryam Siddiqui", email: "maryam@example.com" });

  // A second company the same admin runs, with its own people, so the company switcher has something to switch to.
  const [co2] = await db.insert(s.companies).values({ name: "Techlio Labs", slug: "techlio-labs", currency: "USD", taxRate: 0.1 }).returning();
  await seedCompanyDefaults(db, co2.id);
  const labsAdmin = await createEmployee(db, null, { companyId: co2.id, name: "Hassan Bajwa", email: "admin@techlio.co", password: DEMO_PASSWORD, role: "ADMIN", title: "Founder", joinDate: "2025-06-02", basic: 5000 });
  await createEmployee(db, null, { companyId: co2.id, name: "Noor Fatima", email: "noor@labs.example", password: DEMO_PASSWORD, role: "EMPLOYEE", title: "Researcher", managerId: labsAdmin.id, joinDate: "2025-06-02", basic: 3000 });

  return { admin, hr, mgr, company: co, company2: co2 };
}
