import { test, expect } from "@playwright/test";
import { USERS, as, addDays, expectError, go, login, mondayAfter } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("authentication", () => {
  test("anonymous visitors are sent to sign in", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
  test("wrong password and unknown email show the same message", async ({ page }) => {
    for (const [email, pw] of [[USERS.employee, "nope-nope"], ["ghost@techlio.co", "Techlio@123"]]) {
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(pw);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expectError(page, "Wrong email or password");
      await expect(page).toHaveURL(/\/login/);
    }
  });
  test("signing in and out works", async ({ page }) => {
    await login(page, USERS.employee);
    await expect(page.getByRole("heading", { name: /Hello, Ali/ })).toBeVisible();
    await page.getByText("Ali Raza").first().click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login/);
  });
  test("the public careers page needs no login", async ({ page }) => {
    await page.goto("/careers");
    await expect(page.getByRole("heading", { name: "Open roles" })).toBeVisible();
    await expect(page.getByText("Senior Frontend Engineer")).toBeVisible();
  });
});

test.describe("attendance", () => {
  test("check in, break, end break, check out", async ({ page }) => {
    await login(page, USERS.employee);
    await expect(page.getByText("You haven't checked in yet")).toBeVisible();
    await page.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByRole("button", { name: "Check out" })).toBeVisible();
    await expect(page.getByText(/Checked in at/)).toBeVisible();
    await page.getByRole("button", { name: "Start break" }).click();
    await expect(page.getByRole("button", { name: "End break" })).toBeVisible();
    await page.getByRole("button", { name: "End break" }).click();
    await expect(page.getByRole("button", { name: "Start break" })).toBeVisible();
    await page.getByRole("button", { name: "Check out" }).click();
    await expect(page.getByText("You're done for today.")).toBeVisible();
    await expect(page.getByText(/Checked out at/)).toBeVisible();
  });
  test("the timesheet and who's-in views reflect it", async ({ page, browser }) => {
    await login(page, USERS.employee);
    await go(page, "/time?tab=timesheet");
    await expect(page.getByRole("cell", { name: new Date().toISOString().slice(0, 4), exact: false }).first()).toBeVisible();
    const mgr = await as(browser, USERS.manager);
    await go(mgr.page, "/time?tab=whosin");
    await expect(mgr.page.getByRole("cell", { name: "Ali Raza" })).toBeVisible();
    await mgr.close();
  });
  test("employees can't see manager-only tabs", async ({ page }) => {
    await login(page, USERS.employee);
    await go(page, "/time");
    await expect(page.getByRole("link", { name: "Who's in" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Shifts" })).toHaveCount(0);
  });
});

test.describe("leave lifecycle", () => {
  const start = mondayAfter(3); // same calendar year as "today" so the balance tile reflects it
  const end = addDays(start, 1);

  test("validation messages", async ({ page }) => {
    await login(page, USERS.employee);
    await go(page, "/requests?tab=leave");
    await page.getByLabel("From", { exact: true }).fill(addDays(start, 5));
    await page.getByLabel("To", { exact: true }).fill(addDays(start, 6)); // weekend
    await page.getByRole("button", { name: "Apply for leave" }).click();
    await expectError(page, /weekends or holidays/);
  });
  test("apply, cancel, re-apply", async ({ page }) => {
    await login(page, USERS.employee);
    await go(page, "/requests?tab=leave");
    await page.getByLabel("From", { exact: true }).fill(start);
    await page.getByLabel("To", { exact: true }).fill(end);
    await page.getByLabel("Reason", { exact: true }).fill("Family event");
    await page.getByRole("button", { name: "Apply for leave" }).click();
    await expect(page.getByText("Family event")).toBeVisible();
    await expect(page.getByText("Pending").first()).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await expect(page.getByText("Cancelled")).toBeVisible();
    await page.getByLabel("From", { exact: true }).fill(start);
    await page.getByLabel("To", { exact: true }).fill(end);
    await page.getByLabel("Reason", { exact: true }).fill("Family event");
    await page.getByRole("button", { name: "Apply for leave" }).click();
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(1);
  });
  test("overlapping dates are refused", async ({ page }) => {
    await login(page, USERS.employee);
    await go(page, "/requests?tab=wfh");
    await page.getByLabel("From", { exact: true }).fill(start);
    await page.getByLabel("To", { exact: true }).fill(start);
    await page.getByRole("button", { name: "Request WFH" }).click();
    await expectError(page, /overlap/);
  });
  test("the manager sees it, needs a note to reject, then approves", async ({ browser }) => {
    const m = await as(browser, USERS.manager);
    await expect(m.page.getByRole("link", { name: /Requests/ }).first()).toContainText(/\d/);
    await go(m.page, "/requests?tab=approvals");
    const row = m.page.getByRole("row").filter({ hasText: "Ali Raza" }).filter({ hasText: "Family event" });
    await row.getByRole("button", { name: "Reject" }).click();
    await expectError(m.page, /note/i);
    await row.getByLabel("Decision note", { exact: true }).fill("Release week, please move it");
    await row.getByRole("button", { name: "Reject" }).click();
    await expect(m.page.getByText("You're all caught up.")).toBeVisible();
    await m.close();
  });
  test("employee sees the rejection reason; balance untouched; applies again and gets approved", async ({ browser }) => {
    const e = await as(browser, USERS.employee);
    await go(e.page, "/requests?tab=leave");
    await expect(e.page.getByText(/Release week, please move it/)).toBeVisible();
    await expect(e.page.getByText("Rejected").first()).toBeVisible();
    await e.page.getByLabel("From", { exact: true }).fill(start);
    await e.page.getByLabel("To", { exact: true }).fill(end);
    await e.page.getByLabel("Reason", { exact: true }).fill("Second attempt");
    await e.page.getByRole("button", { name: "Apply for leave" }).click();
    await expect(e.page.getByText("Second attempt")).toBeVisible();

    const m = await as(browser, USERS.manager);
    await go(m.page, "/requests?tab=approvals");
    await m.page.getByRole("row").filter({ hasText: "Second attempt" }).getByRole("button", { name: "Approve" }).click();
    await expect(m.page.getByText("You're all caught up.")).toBeVisible();
    await m.close();

    await go(e.page, "/requests?tab=leave");
    await expect(e.page.getByText("Approved").first()).toBeVisible();
    await expect(e.page.getByText("Annual left").locator("..").getByText("12")).toBeVisible();
    await e.close();
  });
  test("an employee can't approve their own request (no approvals tab; direct call refused)", async ({ page }) => {
    await login(page, USERS.employee);
    await go(page, "/requests");
    await expect(page.getByRole("link", { name: /Approvals/ })).toHaveCount(0);
    const res = await page.evaluate(async () => (await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", args: [1, true, ""] }) })).json());
    expect(res.error).toBeTruthy();
  });
});

test.describe("expenses, punch fix and tickets", () => {
  test("expense validation, submission, and approval", async ({ page, browser }) => {
    await login(page, USERS.employee);
    await go(page, "/requests?tab=expense");
    await page.getByLabel("Amount", { exact: true }).fill("2500");
    await page.getByLabel("Expense date", { exact: true }).fill("2026-10-01");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expectError(page, /Describe the expense/);
    await page.getByLabel("What was it for?", { exact: true }).fill("Taxi to client site");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page.getByText("Taxi to client site")).toBeVisible();
    const m = await as(browser, USERS.manager);
    await go(m.page, "/requests?tab=approvals");
    await m.page.getByRole("row").filter({ hasText: "Taxi to client site" }).getByRole("button", { name: "Approve" }).click();
    await expect(m.page.getByText("You're all caught up.")).toBeVisible();
    await m.close();
  });
  test("punch correction rewrites the timesheet when approved", async ({ page, browser }) => {
    await login(page, USERS.employee);
    await go(page, "/requests?tab=punch");
    await page.getByLabel("Date", { exact: true }).fill("2026-10-02");
    await page.getByLabel("Check-out", { exact: true }).fill("08:00");
    await page.getByLabel("Why does it need fixing?", { exact: true }).fill("Forgot to check in");
    await page.getByRole("button", { name: "Request fix" }).click();
    await expectError(page, /after check-in/);
    await page.getByLabel("Check-out", { exact: true }).fill("18:00");
    await page.getByRole("button", { name: "Request fix" }).click();
    await expect(page.getByText("Forgot to check in")).toBeVisible();
    const m = await as(browser, USERS.manager);
    await go(m.page, "/requests?tab=approvals");
    await m.page.getByRole("row").filter({ hasText: "Forgot to check in" }).getByRole("button", { name: "Approve" }).click();
    await expect(m.page.getByText("You're all caught up.")).toBeVisible();
    await m.close();
    await go(page, "/time?tab=timesheet&month=2026-10");
    await expect(page.getByRole("row").filter({ hasText: "2026-10-02" })).toContainText("9h 00m");
    await expect(page.getByRole("row").filter({ hasText: "2026-10-02" })).toContainText("Corrected");
  });
  test("ticket conversation and resolution", async ({ page, browser }) => {
    await login(page, USERS.employee);
    await go(page, "/requests?tab=ticket");
    await page.getByLabel("Subject", { exact: true }).fill("Laptop is slow");
    await page.getByLabel("Describe the issue", { exact: true }).fill("Takes five minutes to boot");
    await page.getByRole("button", { name: "Open ticket" }).click();
    await page.getByRole("link", { name: "Laptop is slow" }).click();
    await page.getByLabel("Add a reply", { exact: true }).fill("Still slow today");
    await page.getByRole("button", { name: "Reply" }).click();
    await expect(page.getByText("Still slow today")).toBeVisible();

    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/requests?tab=ticket");
    await hr.page.getByRole("link", { name: "Laptop is slow" }).first().click();
    await hr.page.getByLabel("Add a reply", { exact: true }).fill("We'll swap it tomorrow");
    await hr.page.getByRole("button", { name: "Reply" }).click();
    await expect(hr.page.getByText("We'll swap it tomorrow")).toBeVisible();
    await hr.page.getByRole("button", { name: "Resolve" }).click();
    await expect(hr.page.getByText("Resolved").or(hr.page.getByText("Approved")).first()).toBeVisible();
    await hr.close();

    const zain = await as(browser, USERS.zain);
    const url = page.url();
    await zain.page.goto(url);
    await expect(zain.page.getByText(/not found|could not be found/i).first()).toBeVisible();
    await zain.close();
  });
});

test.describe("access control", () => {
  test("employees and managers are kept out of Admin", async ({ page, browser }) => {
    await login(page, USERS.employee);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/home/);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    const m = await as(browser, USERS.manager);
    await m.page.goto("/admin");
    await expect(m.page).toHaveURL(/\/home/);
    await m.close();
  });
  test("HR actions are refused for employees at the API level", async ({ page }) => {
    await login(page, USERS.employee);
    for (const [action, args] of [["runPayroll", ["2026-10"]], ["createJob", [{ title: "x" }]], ["postAnnouncement", ["a", "b"]], ["setSalary", [1, 1, 0, 0]], ["updateSettings", [{ taxRate: 0.2 }]]] as const) {
      const res = await page.evaluate(async ([a, ar]) => (await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a, args: ar }) })).json(), [action, args] as const);
      expect(res.error, action).toBeTruthy();
    }
  });
  test("unknown actions and malformed bodies are rejected cleanly", async ({ page }) => {
    await login(page, USERS.employee);
    const unknown = await page.evaluate(async () => (await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dropEverything", args: [] }) })).status);
    expect(unknown).toBe(404);
    const bad = await page.evaluate(async () => (await fetch("/api/rpc", { method: "POST", body: "not json" })).status);
    expect(bad).toBe(400);
  });
  test("an employee can't read another person's payslip or HR-only pages' data", async ({ page }) => {
    await login(page, USERS.employee);
    const res = await page.goto("/payroll/slip/1");
    expect([404]).toContain(res!.status());
  });
});
