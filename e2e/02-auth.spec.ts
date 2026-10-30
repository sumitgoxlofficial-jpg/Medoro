import { test, expect } from "@playwright/test";
import { anonContext, createStaff, db, employeeLogin, enterTotp, ownerPasswordStep, state, uid } from "./helpers";

/** Spec 2 · sign-in: owner email + password + TOTP, lockout, trusted PC; counter staff with PIN. */
test.describe("sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("owner: wrong password, then password + TOTP, then trusted PC skips the code", async ({ page }) => {
    const s = state();
    await ownerPasswordStep(page, s.ownerEmail, "not-the-password-1");
    await expect(page.getByText("Email or password is incorrect. 4 attempts left.")).toBeVisible();

    await page.getByLabel("Password").fill(s.ownerPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/signin\/mfa/);
    await expect(page.getByText("Enter the 6-digit code from your authenticator app.")).toBeVisible();
    await enterTotp(page, s.totpSecret, true);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Sign out, sign in again: this PC is trusted for 30 days, so no code is asked.
    await page.getByTitle("Account menu").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await ownerPasswordStep(page, s.ownerEmail, s.ownerPassword);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("owner: without trusting the PC, the next sign-in asks for the code again", async ({ page }) => {
    const s = state();
    await ownerPasswordStep(page, s.ownerEmail, s.ownerPassword);
    await enterTotp(page, s.totpSecret, false);
    await page.getByTitle("Account menu").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await ownerPasswordStep(page, s.ownerEmail, s.ownerPassword);
    await expect(page).toHaveURL(/\/signin\/mfa/);
  });

  test("five wrong passwords lock the account", async ({ page }) => {
    const email = `nobody.${uid().toLowerCase()}@e2e-pharmacy.in`;
    await ownerPasswordStep(page, email, "wrong-password-0");
    for (let left = 4; left >= 1; left--) {
      await expect(page.getByText(`Email or password is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.`)).toBeVisible();
      await page.getByLabel("Password").fill(`wrong-password-${left}`);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    await expect(page.getByText("Too many attempts. Sign-in is locked for 15 minutes.")).toBeVisible();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/Too many attempts. Try again in 1[45] minutes./)).toBeVisible();
  });
});

test.describe("counter staff", () => {
  test("cashier created in Users signs in with pharmacy code, employee ID, PIN and counter", async ({ page, browser }) => {
    const s = state();
    const cashier = await createStaff(browser, page, "Cashier", "Kiran Patil");

    const ctx = await anonContext(browser);
    const p = await ctx.newPage();
    await employeeLogin(p, s.tenantCode, cashier.employeeNo, "9999");
    await expect(p.getByText("Employee ID or PIN is incorrect. 4 attempts left.")).toBeVisible();
    await p.getByLabel("4-digit PIN").fill(cashier.pin);
    await p.getByRole("button", { name: "Counter 2" }).click();
    await p.getByRole("button", { name: "Start shift" }).click();
    await expect(p).toHaveURL(/\/app$/);
    // A cashier can bill but can't manage users or see accounts.
    await expect(p.getByRole("link", { name: "Billing (POS)" })).toBeVisible();
    await expect(p.getByRole("link", { name: "Users & branches" })).toHaveCount(0);
    await expect(p.getByRole("link", { name: "Accounting & reports" })).toHaveCount(0);
    await p.goto("/app/pos");
    await expect(p.getByText(/Counter 2 · Main branch/)).toBeVisible();
    const u = await db().user.findFirstOrThrow({ where: { employeeNo: cashier.employeeNo }, include: { role: true } });
    expect(u.role.name).toBe("Cashier");
    await ctx.close();
  });

  test("accountant lands on Accounting & reports", async ({ page, browser }) => {
    const s = state();
    const acc = await createStaff(browser, page, "Accountant", "Meera Shah");
    const ctx = await anonContext(browser);
    const p = await ctx.newPage();
    await employeeLogin(p, s.tenantCode, acc.employeeNo, acc.pin);
    await expect(p).toHaveURL(/\/app\/accounts$/);
    await expect(p.getByRole("heading", { name: "Accounting & reports" })).toBeVisible();
    await expect(p.getByRole("link", { name: "Billing (POS)" })).toHaveCount(0);
    await ctx.close();
  });
});
