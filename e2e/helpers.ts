import { expect, type Page, type Browser } from "@playwright/test";

export const PASSWORD = "Techlio@123";
export const USERS = { admin: "admin@techlio.co", hr: "hr@techlio.co", manager: "manager@techlio.co", employee: "employee@techlio.co", zain: "zain@techlio.co" };

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/home");
}

/** A separate browser context per person so sessions don't mix. */
export async function as(browser: Browser, email: string, password = PASSWORD) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email, password);
  return { page, close: () => ctx.close() };
}

export async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
}

export async function expectError(page: Page, text: RegExp | string) {
  await expect(page.getByRole("alert").filter({ hasText: text }).first()).toBeVisible();
}

/** Next working Monday that is at least `weeks` weeks out, as YYYY-MM-DD. */
export function mondayAfter(weeks: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
