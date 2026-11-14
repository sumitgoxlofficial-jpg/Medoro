import { test, expect, type Page } from "@playwright/test";
import { db, expectToast, totp, uid } from "./helpers";

/** Spec 16 · Medoro staff console: bootstrap super admin (STAFF_BOOTSTRAP_EMAIL), a reference partner joins on their own, a lead. */
const BOOTSTRAP = process.env.STAFF_BOOTSTRAP_EMAIL ?? "founder@medoro.in";
const PASSWORD = "Staff-console-pass-2026";

test.use({ storageState: { cookies: [], origins: [] } });

/** The public join form is for reference partners only; Medoro's own team is invited by a super admin. */
async function join(page: Page, p: { name: string; email: string; phone: string }) {
  await page.goto("/staff/login");
  await page.getByRole("button", { name: /New partner\? Join free/ }).click();
  await expect(page.getByRole("button", { name: "Medoro sales" })).toHaveCount(0);
  await page.getByLabel("Full name").fill(p.name);
  await page.getByLabel("Email", { exact: true }).fill(p.email);
  await page.getByLabel("Mobile").fill(p.phone);
  await page.getByLabel(/Company \/ area/).fill("MR, Pune West");
  await page.getByLabel(/Create a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create partner account" }).click();
}

test("bootstrap super admin, a partner joins without approval, and a lead", async ({ page, browser }) => {
  test.skip(!!(await db().staffUser.findFirst({ where: { email: BOOTSTRAP } })), "Staff console already bootstrapped in this database");
  // Pharmacy accounts can't use the staff console.
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/login/);

  // First super admin from STAFF_BOOTSTRAP_EMAIL. The partner sign-in has no team tab; setup is offered on a fresh server.
  await page.goto("/staff/login");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: /Set up the admin profile/ }).click();
  await page.getByLabel("Full name").fill("Founder Admin");
  await page.getByLabel("Admin email").fill(BOOTSTRAP);
  await page.getByLabel("Mobile").fill("9822000002");
  await page.getByLabel(/Create a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create admin profile" }).click();
  await expect(page.getByText(/You’re the first super admin/)).toBeVisible();
  // The Medoro team signs in on the HRMS, then opens the console from the account menu with an authenticator.
  await page.getByRole("button", { name: "Go to HRMS sign-in" }).click();
  await expect(page).toHaveURL(/\/staff\/employee/);
  await page.locator("input[autocomplete=username]").fill(BOOTSTRAP);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/hrms/);
  await expect(async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("button", { name: "Open staff console" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Open staff console" }).click();
  await expect(page).toHaveURL(/\/staff\/login/);
  await expect(page.getByText("Set up your authenticator")).toBeVisible();
  const secret = (await page.locator("code").innerText()).trim();
  await page.getByLabel("6-digit code from your authenticator").fill(totp(secret));
  await page.getByRole("button", { name: "Verify and finish" }).click();
  await expect(page).toHaveURL(/\/staff(\/overview)?$/);

  // An MR joins with a Gmail address and lands on their dashboard straight away.
  const mr = `mr.${uid().toLowerCase()}@gmail.com`;
  const other = await browser.newContext();
  const sp = await other.newPage();
  await join(sp, { name: "Priya Partner", email: mr, phone: "9822000003" });
  await expect(sp).toHaveURL(/\/staff(\/sales)?$/);
  await expect(sp.getByText(/Your referral code/)).toBeVisible();
  await other.close();

  // The founder's own email also works as a separate partner profile, opening only the partner dashboard.
  const mine = await browser.newContext();
  const mp = await mine.newPage();
  await join(mp, { name: "Founder Admin", email: BOOTSTRAP, phone: "9822000002" });
  await expect(mp).toHaveURL(/\/staff(\/sales)?$/);
  await expect(mp.getByText(/Your referral code/)).toBeVisible();
  await expect(mp.getByRole("link", { name: "Employees" })).toHaveCount(0);
  await mine.close();

  // The admin sees them on the partners page.
  await page.goto("/staff/partners");
  await expect(page.locator("tr").filter({ hasText: mr })).toBeVisible();

  // The admin creates a lead.
  const lead = `Shivam Medicals ${uid()}`;
  await page.goto("/staff/leads");
  await page.getByRole("button", { name: "New lead" }).click();
  await page.getByLabel("Pharmacy name").fill(lead);
  await page.getByLabel("Owner name").fill("Shivam Patil");
  await page.getByLabel("Mobile").fill(`98${Date.now().toString().slice(-8)}`);
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expectToast(page, "Lead saved. Follow-up set for tomorrow.");
  await expect(page.getByText(lead, { exact: true })).toBeVisible();
  const l = await db().lead.findFirstOrThrow({ where: { name: lead } });
  expect(l.stage).toBe("new");
});
