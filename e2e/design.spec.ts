import { test, expect, type Browser, type Page } from "@playwright/test";
import { PASSWORD, USERS } from "./helpers";

/**
 * Design regression test. Every screen is loaded with all CSS animations frozen on their first frame
 * (the worst case: a background tab, a throttled pane or a screenshot), at desktop, tablet and phone widths.
 */
test.describe.configure({ mode: "serial" });

const VIEWPORTS = { desktop: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, phone: { width: 390, height: 844 } } as const;

const SHARED: Record<string, string[]> = {
  "/home": [""],
  "/people": ["directory", "org", "documents", "onboarding"],
  "/time": ["today", "timesheet", "schedule"],
  "/requests": ["leave", "wfh", "expense", "punch", "ticket"],
  "/payroll": ["payslips"],
  "/talent": ["performance", "training"],
  "/engage": ["news", "kudos", "surveys"],
  "/careers": [""],
};
const HR_ONLY: Record<string, string[]> = {
  "/people": ["assets"],
  "/time": ["whosin", "shifts"],
  "/requests": ["approvals"],
  "/payroll": ["runs", "salaries", "settlement"],
  "/talent": ["recruitment"],
  "/admin": ["employees", "leave", "holidays", "departments", "settings"],
};

const urls = (m: Record<string, string[]>) => Object.entries(m).flatMap(([p, tabs]) => tabs.map((t) => (t ? `${p}?tab=${t}` : p)));

async function session(browser: Browser, email: string, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) problems.push(`console: ${m.text().slice(0, 160)}`); });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/home");
  // Freeze every CSS animation at its first frame for all later navigations.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  return { page, ctx, problems };
}

/** Everything wrong with the current page, as readable strings. */
async function audit(page: Page, label: string, phone: boolean) {
  return page.evaluate(({ label, phone }) => {
    const out: string[] = [];
    const eff = (el: Element) => { let o = 1; for (let e: Element | null = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

    // 1. Nothing invisible: text must be readable even before any animation plays.
    const faint: string[] = [];
    for (const el of document.querySelectorAll("main *, aside *")) {
      const t = (el as HTMLElement).innerText?.trim();
      if (!t || el.children.length > 0 || !visible(el)) continue;
      const o = eff(el);
      if (o < 0.6) faint.push(`"${t.slice(0, 24)}" (${o.toFixed(2)})`);
    }
    if (faint.length) out.push(`${label}: faint or invisible text: ${faint.slice(0, 5).join(", ")}`);

    // 2. No sideways scrolling.
    const de = document.documentElement;
    if (de.scrollWidth > window.innerWidth + 1) {
      const wide = [...document.querySelectorAll("main *")].find((e) => e.getBoundingClientRect().right > window.innerWidth + 1);
      out.push(`${label}: horizontal overflow (${de.scrollWidth} > ${window.innerWidth}) near <${wide?.tagName.toLowerCase()} class="${(wide as HTMLElement | undefined)?.className?.toString().slice(0, 50)}">`);
    }

    // 3. Every control has a name a person (or screen reader) can use.
    const unnamed: string[] = [];
    for (const el of document.querySelectorAll("button, a[href], summary")) {
      if (!visible(el)) continue;
      // textContent, not innerText: content inside a closed <details> reports empty innerText but is still named.
      const name = ((el.textContent || "") || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim() || (el.getAttribute("aria-label") ?? "").trim();
      if (!name) unnamed.push(el.tagName.toLowerCase());
    }
    for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      if (!visible(el)) continue;
      const i = el as HTMLInputElement;
      if (!(i.labels && i.labels.length) && !i.getAttribute("aria-label")) unnamed.push(`${el.tagName.toLowerCase()}[name=${i.name}]`);
    }
    if (unnamed.length) out.push(`${label}: controls without a name: ${unnamed.slice(0, 5).join(", ")}`);

    // 4. Labels point at the right control (ids unique).
    const ids = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    const dupes = [...ids].filter(([id, n]) => n > 1 && !id.startsWith("__next") && id !== "next-logo").map(([id]) => id);
    if (dupes.length) out.push(`${label}: duplicate ids: ${dupes.slice(0, 5).join(", ")}`);

    // 5. Buttons and inputs are tappable size.
    const tiny: string[] = [];
    for (const el of document.querySelectorAll("main button, main input:not([type=hidden]), main select")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 22 || r.width < 22) tiny.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    if (tiny.length) out.push(`${label}: controls too small: ${tiny.slice(0, 4).join(", ")}`);

    // 6. Phone layout: the top bar must not sit on top of the page content.
    if (phone) {
      const aside = document.querySelector("aside"), main = document.querySelector("main");
      if (aside && main && aside.getBoundingClientRect().bottom > main.getBoundingClientRect().top + 1 && window.scrollY === 0) out.push(`${label}: top bar overlaps the content`);
    }
    return out;
  }, { label, phone });
}

const results: string[] = [];

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test(`employee, every screen — ${vp}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const s = await session(browser, USERS.employee, size);
    for (const url of urls(SHARED)) {
      await s.page.goto(url);
      await expect(s.page.locator("main, h1").first()).toBeVisible();
      await s.page.waitForTimeout(350);
      results.push(...(await audit(s.page, `[employee ${vp}] ${url}`, vp === "phone")));
    }
    results.push(...s.problems.map((p) => `[employee ${vp}] ${p}`));
    await s.page.goto("/home");
    await s.page.screenshot({ path: `test-results/design/employee-home-${vp}.png`, fullPage: true });
    await s.ctx.close();
  });
}

for (const vp of ["desktop", "phone"] as const) {
  test(`HR screens — ${vp}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const s = await session(browser, USERS.hr, VIEWPORTS[vp]);
    for (const url of urls(HR_ONLY)) {
      await s.page.goto(url);
      await expect(s.page.locator("main").first()).toBeVisible();
      await s.page.waitForTimeout(350);
      results.push(...(await audit(s.page, `[hr ${vp}] ${url}`, vp === "phone")));
    }
    results.push(...s.problems.map((p) => `[hr ${vp}] ${p}`));
    await s.ctx.close();
  });
}

test("key controls are visible and usable at every width", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const s = await session(browser, USERS.zain, size);
    await s.page.goto("/home");
    const control = s.page.getByRole("button", { name: /^(Check in|Check out)$/ }).first();
    await expect(control, `clock button at ${vp}`).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.width, `${vp} button width`).toBeGreaterThan(60);
    expect(box.x + box.width, `${vp} button inside viewport`).toBeLessThanOrEqual(size.width);
    expect(await control.evaluate((el) => getComputedStyle(el).backgroundColor), `${vp} button has a fill`).not.toBe("rgba(0, 0, 0, 0)");
    await expect(s.page.getByRole("link", { name: "People" })).toBeVisible(); // navigation reachable
    await expect(s.page.locator("summary").first()).toBeVisible(); // company switcher
    await s.ctx.close();
  }
});

test("reduced-motion visitors get no animation and a complete page", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(USERS.employee);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/home");
  const animated = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  expect(animated).toBe(0);
  await expect(page.getByText("Days present")).toBeVisible();
  await ctx.close();
});

test("design audit result", async () => {
  const fs = await import("node:fs");
  fs.mkdirSync("test-results/design", { recursive: true });
  fs.writeFileSync("test-results/design/audit.txt", results.join("\n"));
  // Group repeats so one root cause reads as one line.
  const grouped = new Map<string, string[]>();
  for (const r of results) { const kind = r.replace(/^\[[^\]]+\] \S+: /, "").replace(/^\[[^\]]+\] /, ""); grouped.set(kind, [...(grouped.get(kind) ?? []), r.split(": ")[0]]); }
  const report = [...grouped].map(([k, where]) => `${k}\n    on ${where.length} page(s), e.g. ${where.slice(0, 3).join(" | ")}`).join("\n");
  expect(results.length, `\n${report}\n`).toBe(0);
});
