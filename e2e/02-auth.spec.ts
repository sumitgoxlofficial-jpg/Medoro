import { test, expect } from "@playwright/test";
import { addEmployee, anonContext, createStaff, db, employeeLogin, enterTotp, joinWithInvite, ownerPasswordStep, state, uid } from "./helpers";
import { startMailSink } from "./mail-sink";

/** Spec 2 · sign-in: owner email + password + TOTP, lockout, trusted PC; counter staff with PIN. */
test.describe("sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Google sign-in is hidden when it isn't configured", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: "Email & password" })).toBeVisible();
    await expect(page.getByText("Continue with Google")).toHaveCount(0);
    const r = await page.request.get("/api/auth/google/start", { maxRedirects: 0 });
    expect(r.status()).toBe(302);
    expect(r.headers().location).toContain("/signin?google=off");
    await page.goto("/signin?google=off");
    await expect(page.getByText("Google sign-in isn’t set up on this server.")).toBeVisible();
    await expect(page.getByText("Continue with Google")).toHaveCount(0);
  });

  test("a recovery code works once at the two-step step", async ({ page }) => {
    const s = state(), code = s.recoveryCodes[0];
    const recover = async () => {
      await ownerPasswordStep(page, s.ownerEmail, s.ownerPassword);
      await expect(page).toHaveURL(/\/signin\/mfa/);
      await page.getByRole("button", { name: "Use a recovery code" }).click();
      await page.getByLabel("Recovery code").fill(code.toUpperCase()); // case and dashes don't matter
      const trust = page.getByLabel("Trust this counter PC for 30 days");
      if (await trust.isChecked()) await trust.click();
      await page.getByRole("button", { name: "Verify" }).click();
    };
    await recover();
    await expect(page.getByText("Signed in with a recovery code")).toBeVisible();
    await expect(page.getByText(/You have 9 recovery codes left/)).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByTitle("Account menu").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin$/);

    await recover();
    await expect(page.getByText("That recovery code doesn’t match or was already used.")).toBeVisible();
  });

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
  test("forgot password: a manager resets it with a code sent by email", async ({ page, browser }) => {
    const sink = await startMailSink();
    try {
      const email = `manager.${uid().toLowerCase()}@e2e-pharmacy.in`, oldPw = "Manager-old-pass-1", newPw = "Manager-new-pass-2";
      const invite = await addEmployee(page, { name: "Sunil Manager", contact: email, role: "Manager" });
      const ctx = await anonContext(browser);
      const p = await ctx.newPage();
      await joinWithInvite(p, { code: state().tenantCode, invite, contact: email, name: "Sunil Manager", pin: oldPw });

      await p.goto("/signin");
      await p.getByRole("button", { name: "Email & password" }).click();
      await p.getByRole("button", { name: "Forgot password?" }).click();
      await expect(p.getByText("Reset your password")).toBeVisible();
      await p.getByLabel("Email", { exact: true }).fill(email);
      await p.getByRole("button", { name: "Send code" }).click();
      await expect(p.getByText(/a code is on its way/)).toBeVisible();
      const mail = await sink.latest(email);
      expect(mail.from).toContain("no-reply@e2e-pharmacy.in");
      const code = mail.subject.match(/(\d{6})/)![1];
      expect(mail.text).toContain(code);

      await p.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
      await p.getByLabel("New password (10+ characters)").fill(newPw);
      await p.getByLabel("Confirm new password").fill(newPw);
      await p.getByRole("button", { name: "Set new password" }).click();
      await expect(p.getByText("That code is wrong or has expired. Request a new one.")).toBeVisible();
      await p.getByLabel("6-digit code").fill(code);
      await p.getByRole("button", { name: "Set new password" }).click();
      await expect(p.getByText("Password changed")).toBeVisible();

      await ownerPasswordStep(p, email, oldPw);
      await expect(p.getByText(/Email or password is incorrect/)).toBeVisible();
      await p.getByLabel("Password").fill(newPw);
      await p.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(p).toHaveURL(/\/signin\/mfa/); // managers still enrol an authenticator
      await expect(p.getByText("Set up two-step verification")).toBeVisible();
      await ctx.close();
    } finally {
      await sink.close();
    }
  });
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
