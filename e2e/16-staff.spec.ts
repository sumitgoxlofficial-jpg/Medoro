import { test, expect, type Page } from "@playwright/test";
import { db, expectToast, totp, uid } from "./helpers";

/** Spec 16 · Medoro staff console: bootstrap super admin (STAFF_BOOTSTRAP_EMAIL), approval of a new profile, a lead. */
const BOOTSTRAP = process.env.STAFF_BOOTSTRAP_EMAIL ?? "founder@medoro.in";
const PASSWORD = "Staff-console-pass-2026";

test.use({ storageState: { cookies: [], origins: [] } });

async function signup(page: Page, p: { name: string; email: string; phone: string; role?: "Sales" | "Customer care" }) {
  await page.goto("/staff/login");
  await page.getByRole("button", { name: /Create your profile/ }).click();
  await page.getByLabel("Full name").fill(p.name);
  await page.getByLabel("Work email").fill(p.email);
  await page.getByLabel("Mobile").fill(p.phone);
  await page.getByLabel("Team / city").fill("Pune West");
  await page.getByLabel(/Create a password/).fill(PASSWORD);
  if (p.role) await page.getByRole("button", { name: p.role }).click();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Profile submitted")).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.goto("/staff/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("bootstrap super admin signs up, approves a sales profile and creates a lead", async ({ page, browser }) => {
  test.skip(!!(await db().staffUser.findFirst({ where: { email: BOOTSTRAP } })), "Staff console already bootstrapped in this database");
  // Pharmacy accounts can't use the staff console.
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/login/);

  // Wrong domain is refused.
  await page.getByRole("button", { name: /Create your profile/ }).click();
  await page.getByLabel("Full name").fill("Outsider");
  await page.getByLabel("Work email").fill("someone@gmail.com");
  await page.getByLabel("Mobile").fill("9822000001");
  await page.getByLabel(/Create a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText(/Medoro team profiles use an @medoro\.in work email/)).toBeVisible();

  // First super admin from STAFF_BOOTSTRAP_EMAIL
  await signup(page, { name: "Founder Admin", email: BOOTSTRAP, phone: "9822000002" });
  await expect(page.getByText("You’re the first super admin. Sign in to set up your authenticator.")).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await signIn(page, BOOTSTRAP);
  await expect(page.getByText("Set up your authenticator")).toBeVisible();
  const secret = (await page.locator("code").innerText()).trim();
  await page.getByLabel("6-digit code from your authenticator").fill(totp(secret));
  await page.getByRole("button", { name: "Verify and finish" }).click();
  await expect(page).toHaveURL(/\/staff(\/overview)?$/);

  // A sales person signs up and waits for approval.
  const sales = `sales.${uid().toLowerCase()}@medoro.in`;
  const other = await browser.newContext();
  const sp = await other.newPage();
  await signup(sp, { name: "Priya Sales", email: sales, phone: "9822000003", role: "Sales" });
  await expect(sp.getByText(/waiting for super admin approval/)).toBeVisible();
  await sp.getByRole("button", { name: "Back to sign in" }).click();
  await signIn(sp, sales);
  await expect(sp.getByText("Your profile is waiting for super admin approval.")).toBeVisible();

  await page.goto("/staff/employees");
  const row = page.locator("tr").filter({ hasText: sales });
  await expect(row.getByText("Pending approval")).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await expectToast(page, "Priya Sales approved.");
  await expect(row.getByText("Active", { exact: true })).toBeVisible();

  // Now the sales person can sign in (and must enrol an authenticator).
  await signIn(sp, sales);
  await expect(sp.getByText("Set up your authenticator")).toBeVisible();
  await other.close();

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
