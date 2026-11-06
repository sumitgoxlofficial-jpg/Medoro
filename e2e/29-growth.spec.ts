import { createHash, randomBytes } from "node:crypto";
import { test, expect, devices, type Browser } from "@playwright/test";
import { db, expectToast } from "./helpers";

/**
 * Spec 29 · Growth Intelligence in the staff console. Staff sessions are seeded straight into the database (the staff
 * sign-in and authenticator flow is covered by spec 16); everything else goes through the UI: CSV import, equal
 * distribution, an employee's call from a phone-sized screen with the report, and a crawl of every Growth screen.
 */
test.use({ storageState: { cookies: [], origins: [] } });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const run = Date.now().toString(36);
const base = 6000000 + Math.floor(Math.random() * 3000000); // unique numbers per run

async function staffSession(name: string, role: "super_admin" | "sales") {
  const u = await db().staffUser.create({ data: { empNo: `GE-${run}-${role}`, name, email: `${role}.${run}@medoro.in`, kind: "team", phone: "9822000099", role, status: "active" } });
  if (role === "sales") await db().growthMember.create({ data: { staffId: u.id, role: "sales", addedBy: "e2e" } });
  const token = randomBytes(32).toString("base64url");
  await db().staffSession.create({ data: { id: sha(token), staffId: u.id, tokenVersion: 0, mfaPassed: true, expiresAt: new Date(Date.now() + 3600_000) } });
  return { user: u, token };
}
async function context(browser: Browser, token: string, mobile = false) {
  const ctx = await browser.newContext(mobile ? { ...devices["Pixel 7"] } : {});
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3310");
  await ctx.addCookies([{ name: "medoro_staff", value: token, domain: url.hostname, path: "/staff", httpOnly: true, sameSite: "Strict" }]);
  return ctx;
}

test("Growth: import, distribute, call from a phone, report, and every screen renders", async ({ browser }) => {
  const admin = await staffSession("Growth Admin", "super_admin");
  const sales = await staffSession(`Seema ${run}`, "sales");

  // ── Admin imports a CSV of pharmacies.
  const actx = await context(browser, admin.token);
  const page = await actx.newPage();
  await page.goto("/staff/growth");
  await expect(page).toHaveURL(/\/staff\/growth\/overview/);
  await page.goto("/staff/growth/import");
  const csv = ["Pharmacy Name,Mobile,City,District,State,Pincode", ...Array.from({ length: 6 }, (_, i) => `E2E Pharmacy ${run} ${i},9${base}${i}${i},Pune,Pune,Maharashtra,41100${i}`)].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "e2e.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("new: 6")).toBeVisible();
  await page.getByLabel("Source name *").fill(`E2E directory ${run}`);
  await page.getByLabel(/I confirm this list was collected lawfully/).check();
  await page.getByRole("button", { name: /Import 6 new leads/ }).click();
  await expectToast(page, /6 leads created/);

  // ── Distribute them equally to the sales employee.
  await page.goto("/staff/growth/distribution");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: new RegExp(`^Seema ${run}`) }).click();
  await page.getByRole("button", { name: "Distribute matching leads" }).click();
  await expectToast(page, new RegExp(`leads assigned: Seema ${run}`));
  expect(await db().leadAssignment.count({ where: { staffId: sales.user.id, active: true } })).toBeGreaterThanOrEqual(6);

  // ── The employee works from a phone: My work → calling workspace → CALL PHARMACY → report.
  const sctx = await context(browser, sales.token, true);
  const m = await sctx.newPage();
  await m.goto("/staff/growth/my-work");
  await expect(m.getByRole("main").getByText("My assigned leads")).toBeVisible();
  await m.getByRole("main").getByRole("link", { name: "Call", exact: true }).first().click();
  await expect(m).toHaveURL(/\/staff\/growth\/call\//);
  // The dialer is the phone's own app: keep the test on the page when the tel: link opens.
  await m.evaluate(() => document.addEventListener("click", (e) => { const a = (e.target as Element).closest?.("a"); if (a?.href.startsWith("tel:")) { e.preventDefault(); (window as unknown as { __tel: string }).__tel = a.href; } }, true));
  await m.getByRole("button", { name: "CALL PHARMACY" }).click();
  await expect(m.getByText("Call report", { exact: true })).toBeVisible();
  expect(await m.evaluate(() => (window as unknown as { __tel: string }).__tel)).toMatch(/^tel:\+919\d{9}$/);
  const session = await db().callSession.findFirstOrThrow({ where: { staffId: sales.user.id }, orderBy: { launchedAt: "desc" } });
  expect(session.status).toBe("launched");
  await m.getByLabel("Call outcome *").selectOption("INTERESTED");
  await m.getByLabel("Interest level *").selectOption("high");
  await m.getByLabel("Discussion notes *").fill("Interested in Medoro pharmacy billing software.");
  await m.getByLabel(/Next follow-up/).fill(new Date(Date.now() + 2 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 16));
  await m.getByRole("button", { name: "Submit call report" }).click();
  await expectToast(m, /Call report saved/);
  const reported = await db().callSession.findUniqueOrThrow({ where: { id: session.id } });
  expect(reported).toMatchObject({ status: "reported", outcome: "INTERESTED" });
  expect(await db().followUpTask.count({ where: { leadId: session.leadId, status: "open" } })).toBe(1);
  // The employee can't open admin screens.
  await m.goto("/staff/growth/distribution");
  await expect(m).not.toHaveURL(/distribution/);

  // ── Every Growth screen renders for the admin without an error.
  for (const v of ["overview", "discovery", "leads", "verification", "ai", "import", "distribution", "employees", "performance", "my-work", "call", "calls", "follow-ups", "follow-ups?view=calendar", "pipeline", "campaigns", "whatsapp", "email", "inbox", "analytics", "compliance", "integrations", "settings"]) {
    const r = await page.goto(`/staff/growth/${v}`);
    expect(r?.status(), v).toBeLessThan(400);
    await expect(page.getByText(/Application error|Something went wrong/i), v).toHaveCount(0);
  }
  await page.goto(`/staff/growth/leads/${session.leadId}`);
  await expect(page.getByText("Lead score")).toBeVisible();
  await expect(page.getByText("Interested in Medoro pharmacy billing software.").first()).toBeVisible();

  await actx.close(); await sctx.close();
});
