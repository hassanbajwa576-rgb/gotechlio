import { test, expect, type Page } from "@playwright/test";
import { USERS, as, expectError, go, login } from "./helpers";

test.describe.configure({ mode: "serial" });

const thisMonth = new Date().toISOString().slice(0, 7);
const accept = (page: Page) => page.once("dialog", (d) => d.accept());

test.describe("payroll", () => {
  test("HR runs, reviews and finalizes; employees only see finalized payslips", async ({ browser }) => {
    const emp = await as(browser, USERS.employee);
    await go(emp.page, "/payroll");
    await expect(emp.page.getByText(/Your payslips appear here/)).toBeVisible();
    await expect(emp.page.getByRole("link", { name: "Payroll runs" })).toHaveCount(0);

    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/payroll?tab=runs");
    await hr.page.getByRole("button", { name: "Calculate" }).click();
    await expect(hr.page.getByText("Draft")).toBeVisible();
    await hr.page.getByRole("link", { name: "Review" }).click();
    await expect(hr.page.getByText(/Total net:/)).toBeVisible();
    await expect(hr.page.getByRole("cell", { name: "Ali Raza" })).toBeVisible();
    await expect(hr.page.getByRole("cell", { name: "Noor Fatima" })).toHaveCount(0); // the other company's staff
    await emp.page.reload();
    await expect(emp.page.getByText(/Your payslips appear here/)).toBeVisible(); // still a draft

    accept(hr.page);
    await hr.page.getByRole("button", { name: "Finalize" }).click();
    await expect(hr.page.getByText("Finalized").first()).toBeVisible();

    await emp.page.reload();
    await emp.page.getByRole("link", { name: "View" }).click();
    await expect(emp.page.getByText("Net pay")).toBeVisible();
    await expect(emp.page.locator("main").getByText("Techlio", { exact: true })).toBeVisible();
    await expect(emp.page.getByRole("button", { name: "Print" })).toBeVisible();
    await hr.close(); await emp.close();
  });
  test("salary structure and final settlement", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/payroll?tab=salaries");
    await hr.page.getByLabel("Employee", { exact: true }).selectOption({ label: "Zain Ahmed" });
    await hr.page.getByLabel("Basic", { exact: true }).fill("-5");
    await hr.page.getByRole("button", { name: "Save salary" }).click();
    await expect(hr.page.getByRole("row").filter({ hasText: "Zain Ahmed" })).not.toContainText("-5"); // blocked, nothing saved
    await hr.page.getByLabel("Basic", { exact: true }).fill("145000");
    await hr.page.getByRole("button", { name: "Save salary" }).click();
    await expect(hr.page.getByRole("row").filter({ hasText: "Zain Ahmed" })).toContainText("145,000");
    await go(hr.page, "/payroll?tab=settlement");
    await hr.page.getByLabel("Employee", { exact: true }).selectOption({ label: "Ali Raza" });
    await hr.page.getByLabel("Last working day").fill(`${thisMonth}-15`);
    await hr.page.getByRole("button", { name: "Calculate" }).click();
    await expect(hr.page.getByText("Pro-rated salary")).toBeVisible();
    await expect(hr.page.getByText(/Unused annual leave/)).toBeVisible();
    await hr.close();
  });
});

test.describe("recruitment and hiring", () => {
  test("public application, duplicate guard, pipeline, hire, and the new hire signs in", async ({ page, browser }) => {
    await page.goto("/careers");
    const card = page.locator("div.card").filter({ hasText: "Senior Frontend Engineer" });
    await card.getByRole("button", { name: "Apply" }).click();
    await card.getByLabel("Full name").fill("Bilal Khan");
    await card.getByLabel("Email").fill("bilal@example.com");
    await card.getByRole("button", { name: "Submit application" }).click();
    await expect(page.getByText("Thanks! Your application is in.")).toBeVisible();
    await page.reload();
    const again = page.locator("div.card").filter({ hasText: "Senior Frontend Engineer" });
    await again.getByRole("button", { name: "Apply" }).click();
    await again.getByLabel("Full name").fill("Bilal Khan");
    await again.getByLabel("Email").fill("BILAL@example.com");
    await again.getByRole("button", { name: "Submit application" }).click();
    await expectError(page, /already applied/);

    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/talent?tab=recruitment");
    await hr.page.getByRole("link", { name: "Senior Frontend Engineer" }).click();
    const row = hr.page.locator("li").filter({ hasText: "Bilal Khan" });
    await row.getByLabel("Stage").selectOption("OFFER");
    await row.getByRole("button", { name: "Move" }).click();
    await expect(row.getByRole("button", { name: "Hire" })).toBeVisible();
    await row.getByLabel("Initial password").fill("Welcome@789");
    await row.getByLabel("Monthly basic").fill("120000");
    await row.getByRole("button", { name: "Hire" }).click();
    await expect(hr.page.locator("li").filter({ hasText: "Bilal Khan" }).getByText("HIRED")).toBeVisible();
    await hr.close();

    const bilal = await as(browser, "bilal@example.com", "Welcome@789");
    await expect(bilal.page.getByRole("heading", { name: /Hello, Bilal/ })).toBeVisible();
    await go(bilal.page, "/people?tab=onboarding");
    await expect(bilal.page.getByText("Sign employment contract")).toBeVisible();
    await bilal.close();
  });
});

test.describe("performance and training", () => {
  test("goals: add, update progress", async ({ page }) => {
    await login(page, USERS.employee);
    await go(page, "/talent?tab=performance");
    await page.getByLabel("Goal", { exact: true }).fill("Ship v2");
    await page.getByRole("button", { name: "Add goal" }).click();
    const goal = page.locator("li").filter({ hasText: "Ship v2" });
    await expect(goal).toBeVisible();
    await goal.getByLabel("Progress percent").fill("60");
    await goal.getByRole("button", { name: "Update" }).click();
    await expect(goal.getByText("60%")).toBeVisible();
  });
  test("review cycle: HR opens it, employee self-reviews, manager reviews", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/talent?tab=performance");
    await hr.page.getByLabel("Cycle name").fill("H2 2026");
    await hr.page.getByRole("button", { name: "Start new cycle" }).click();
    await expect(hr.page.getByText("H2 2026").first()).toBeVisible();
    await hr.close();

    const emp = await as(browser, USERS.employee);
    await go(emp.page, "/talent?tab=performance");
    const mine = emp.page.locator("div.card").filter({ hasText: "H2 2026 · my self-review" });
    await mine.getByLabel("Rating").selectOption("4");
    await mine.getByLabel("How did it go?").fill("Solid half");
    await mine.getByRole("button", { name: "Submit review" }).click();
    await expect(emp.page.getByText(/Submitted: 4\/5/)).toBeVisible();
    await emp.close();

    const mgr = await as(browser, USERS.manager);
    await go(mgr.page, "/talent?tab=performance");
    const team = mgr.page.locator("li").filter({ hasText: "Ali Raza" }).filter({ hasText: "self 4" });
    await team.getByLabel("Rating").selectOption("5");
    await team.getByLabel("Feedback").fill("Excellent");
    await team.getByRole("button", { name: "Save review" }).click();
    await mgr.close();

    const emp2 = await as(browser, USERS.employee);
    await go(emp2.page, "/talent?tab=performance");
    await expect(emp2.page.getByText("Manager: 5/5")).toBeVisible();
    await emp2.close();
  });
  test("training: HR adds a course, employee enrolls and completes it", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/talent?tab=training");
    await hr.page.getByLabel("Title", { exact: true }).fill("Git basics");
    await hr.page.getByRole("button", { name: "Add course" }).click();
    await expect(hr.page.getByText("Git basics")).toBeVisible();
    await hr.close();

    const emp = await as(browser, USERS.employee);
    await go(emp.page, "/talent?tab=training");
    const course = emp.page.locator("div.card").filter({ hasText: "Git basics" });
    await course.getByRole("button", { name: "Enroll" }).click();
    await course.getByLabel("Progress percent").fill("100");
    await course.getByRole("button", { name: "Set" }).click();
    await expect(course.getByText("Completed")).toBeVisible();
    await emp.close();
  });
});

test.describe("engagement", () => {
  test("announcements reach everyone's home", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/engage?tab=news");
    await hr.page.getByLabel("Title", { exact: true }).fill("Office closed Friday");
    await hr.page.getByLabel("Message", { exact: true }).fill("Enjoy the long weekend");
    await hr.page.getByRole("button", { name: "Post" }).click();
    await expect(hr.page.getByText("Office closed Friday")).toBeVisible();
    await hr.close();
    const emp = await as(browser, USERS.employee);
    await expect(emp.page.getByText("Office closed Friday")).toBeVisible();
    await go(emp.page, "/engage?tab=news");
    await expect(emp.page.getByLabel("Title", { exact: true })).toHaveCount(0); // only HR can post
    await emp.close();
  });
  test("kudos land on the receiver's activity feed", async ({ browser }) => {
    const emp = await as(browser, USERS.employee);
    await go(emp.page, "/engage?tab=kudos");
    await emp.page.getByLabel("Who?").selectOption({ label: "Zain Ahmed" });
    await emp.page.getByLabel("What did they do?").fill("Beautiful dashboard design");
    await emp.page.getByRole("button", { name: "Send kudos" }).click();
    await expect(emp.page.getByText("Beautiful dashboard design")).toBeVisible();
    await emp.close();
    const zain = await as(browser, USERS.zain);
    await expect(zain.page.getByText("Ali Raza gave you kudos")).toBeVisible();
    await zain.close();
  });
  test("polls: one vote each, results update", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/engage?tab=surveys");
    await hr.page.getByLabel("Question").fill("Team lunch day?");
    await hr.page.getByLabel("Option 1").fill("Wednesday");
    await hr.page.getByLabel("Option 2").fill("Friday");
    await hr.page.getByRole("button", { name: "Create poll" }).click();
    await expect(hr.page.getByText("Team lunch day?")).toBeVisible();
    await hr.close();
    const emp = await as(browser, USERS.employee);
    await go(emp.page, "/engage?tab=surveys");
    const poll = emp.page.locator("div.card").filter({ hasText: "Team lunch day?" });
    await poll.getByRole("button", { name: "Vote" }).nth(1).click();
    await expect(poll.getByText(/1 vote · you voted/)).toBeVisible();
    await expect(poll.getByRole("button", { name: "Vote" })).toHaveCount(0);
    await emp.close();
  });
});

test.describe("admin and live lockout", () => {
  test("HR adds an employee; duplicates and bad input are refused", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/admin?tab=employees");
    await hr.page.getByLabel("Full name").fill("Maya Test");
    await hr.page.getByLabel("Work email").fill("employee@techlio.co");
    await hr.page.getByLabel("Initial password").fill("Maya@12345");
    await hr.page.getByRole("button", { name: "Create employee" }).click();
    await expectError(hr.page, /already exists/);
    await hr.page.getByLabel("Work email").fill("maya@techlio.co");
    await hr.page.getByLabel("Initial password").fill("short");
    await hr.page.getByRole("button", { name: "Create employee" }).click();
    await expectError(hr.page, /8 characters/);
    await hr.page.getByLabel("Initial password").fill("Maya@12345");
    await hr.page.getByRole("button", { name: "Create employee" }).click();
    await expect(hr.page.getByRole("cell", { name: /Maya Test/ })).toBeVisible();
    await expect(hr.page.getByRole("option", { name: "ADMIN" })).toHaveCount(0); // HR can't mint admins
    await hr.close();
  });
  test("deactivating someone locks out their open session at once", async ({ browser }) => {
    const maya = await as(browser, "maya@techlio.co", "Maya@12345");
    await expect(maya.page.getByRole("heading", { name: /Hello, Maya/ })).toBeVisible();
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/people?tab=directory");
    await hr.page.getByRole("link", { name: /Maya Test/ }).click();
    accept(hr.page);
    await hr.page.getByRole("button", { name: "Deactivate" }).click();
    await expect(hr.page.getByText("Deactivated")).toBeVisible();
    await hr.close();
    await maya.page.goto("/home");
    await expect(maya.page).toHaveURL(/\/login/);
    await maya.page.getByLabel("Email", { exact: true }).fill("maya@techlio.co");
    await maya.page.getByLabel("Password", { exact: true }).fill("Maya@12345");
    await maya.page.getByRole("button", { name: "Sign in" }).click();
    await expectError(maya.page, /deactivated/);
    await maya.close();
  });
  test("holidays, leave types and departments: add, duplicate guard", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/admin?tab=holidays");
    await hr.page.getByLabel("Date").fill("2027-05-03");
    await hr.page.getByLabel("Name", { exact: true }).fill("Labour Day");
    await hr.page.getByRole("button", { name: "Add holiday" }).click();
    await expect(hr.page.getByText("Labour Day")).toBeVisible();
    await hr.page.getByLabel("Date").fill("2027-05-03");
    await hr.page.getByLabel("Name", { exact: true }).fill("Dup");
    await hr.page.getByRole("button", { name: "Add holiday" }).click();
    await expectError(hr.page, /already a holiday/);
    await go(hr.page, "/admin?tab=leave");
    await hr.page.getByLabel("Name", { exact: true }).fill("Study");
    await hr.page.getByLabel("Days per year").fill("5");
    await hr.page.getByRole("button", { name: "Add leave type" }).click();
    await expect(hr.page.getByRole("cell", { name: "Study" })).toBeVisible();
    await go(hr.page, "/admin?tab=departments");
    await hr.page.getByLabel("Name", { exact: true }).fill("Sales");
    await hr.page.getByRole("button", { name: "Add department" }).click();
    await expectError(hr.page, /already exists/);
    await hr.close();
  });
  test("only admins edit company settings", async ({ browser }) => {
    const hr = await as(browser, USERS.hr);
    await go(hr.page, "/admin?tab=settings");
    await expect(hr.page.getByText(/Only admins can change company settings/)).toBeVisible();
    await hr.close();
    const admin = await as(browser, USERS.admin);
    await go(admin.page, "/admin?tab=settings");
    await admin.page.getByLabel("Tax rate (%)").fill("7.5");
    await admin.page.getByRole("button", { name: "Save" }).click();
    await expect(admin.page.getByText("Saved")).toBeVisible();
    // The form's min/max stops 5 in the browser, so check the server's own rule through the API.
    const res = await admin.page.evaluate(async () => (await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateSettings", args: [{ workingDaysPerMonth: 5 }] }) })).json());
    expect(res.error).toMatch(/10 to 31/);
    await admin.close();
  });
});

test.describe("multiple companies", () => {
  test("switch between companies; data is separate in each", async ({ browser }) => {
    const admin = await as(browser, USERS.admin);
    const switcher = admin.page.locator("summary").filter({ hasText: /^Techlio/ }).first();
    await switcher.click();
    await expect(admin.page.getByRole("button", { name: /Techlio Labs/ })).toBeVisible();
    await admin.page.getByRole("button", { name: /Techlio Labs/ }).click();
    await admin.page.waitForURL("**/home");
    await expect(admin.page.locator("summary").filter({ hasText: "Techlio Labs" }).first()).toBeVisible();
    await go(admin.page, "/people?tab=directory");
    await expect(admin.page.getByText("Noor Fatima")).toBeVisible();
    await expect(admin.page.getByText("Ali Raza")).toHaveCount(0);
    await go(admin.page, "/admin?tab=settings");
    await expect(admin.page.getByLabel("Currency")).toHaveValue("USD");
    await go(admin.page, "/payroll?tab=runs");
    await expect(admin.page.getByText("No payroll runs yet.")).toBeVisible(); // Techlio's run isn't visible here

    await admin.page.locator("summary").filter({ hasText: "Techlio Labs" }).first().click();
    await admin.page.getByRole("button", { name: /^Techlio\b(?! Labs)/ }).click();
    await admin.page.waitForURL("**/home");
    await go(admin.page, "/people?tab=directory");
    await expect(admin.page.getByText("Ali Raza")).toBeVisible();
    await expect(admin.page.getByText("Noor Fatima")).toHaveCount(0);
    await admin.close();
  });
  test("an admin can add a company and lands in it as admin", async ({ browser }) => {
    const admin = await as(browser, USERS.admin);
    await admin.page.locator("summary").filter({ hasText: /^Techlio/ }).first().click();
    await admin.page.getByLabel("Add a company").fill("Gotechlio Test Co");
    await admin.page.getByRole("button", { name: "Add", exact: true }).click();
    await admin.page.waitForURL("**/home");
    await expect(admin.page.locator("summary").filter({ hasText: "Gotechlio Test Co" }).first()).toBeVisible();
    await go(admin.page, "/people?tab=directory");
    await expect(admin.page.getByRole("link", { name: /Hassan Bajwa/ })).toHaveCount(1); // only the creator is in a brand-new company
    await expect(admin.page.getByRole("link", { name: /Ali Raza/ })).toHaveCount(0);
    await go(admin.page, "/admin?tab=leave");
    await expect(admin.page.getByRole("cell", { name: "Annual" })).toBeVisible();
    await admin.close();
  });
  test("people in one company can't see the switcher's create box, or switch into another company", async ({ browser }) => {
    const emp = await as(browser, USERS.employee);
    await emp.page.locator("summary").filter({ hasText: /^Techlio/ }).first().click();
    await expect(emp.page.getByLabel("Add a company")).toHaveCount(0);
    await expect(emp.page.getByRole("button", { name: /Techlio Labs/ })).toHaveCount(0);
    const status = await emp.page.evaluate(async () => (await fetch("/api/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: 2 }) })).status);
    expect(status).toBe(403);
    const made = await emp.page.evaluate(async () => (await fetch("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createCompany", args: ["Sneaky Inc"] }) })).json());
    expect(made.error).toBeTruthy();
    await emp.close();
  });
});
