import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { OWNER, OWNER_STATE, db, enterTotp, ownerPasswordStep, saveState, state, totp } from "./helpers";

/**
 * Spec 1 · first-run setup. Drives the real wizard once (validation errors, then success), enrols the
 * owner's authenticator and saves the signed-in owner for every other spec (project "setup").
 */
test("first-run setup wizard → MFA enrolment → dashboard", async ({ page }) => {
  test.setTimeout(120_000);
  if ((await db().tenant.count()) > 0) {
    // Already set up (re-run without a database reset): sign in again with the saved credentials.
    const s = state();
    await ownerPasswordStep(page, s.ownerEmail, s.ownerPassword);
    await enterTotp(page, s.totpSecret);
    await page.context().storageState({ path: OWNER_STATE });
    return;
  }

  await page.goto("/signin");
  await expect(page).toHaveURL(/\/setup$/); // no pharmacy yet → sign-in sends you to setup

  // ── 1. Pharmacy: required fields, GSTIN format, pharmacy code, then success
  await expect(page.getByText("Your pharmacy")).toBeVisible();
  await expect(page.getByRole("button", { name: /Restore from a backup instead/ })).toBeVisible();
  await page.getByLabel("Pharmacy name").fill(OWNER.pharmacy);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Pharmacy name and drug licence number are required.")).toBeVisible();
  await page.getByLabel("Drug licence number").fill("MH-PUN-20B-112233 / 21B-112234");
  await page.getByLabel("GSTIN").fill("27AAKFS3192P1Z");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/GSTIN format looks wrong/)).toBeVisible();
  await page.getByLabel("GSTIN").fill("27AAKFS3192P1Z6");
  await page.getByLabel("Registered pharmacist").fill("Ravi Joshi · MH/PH/44120");
  await page.getByLabel("Address").fill("12 FC Road, Shivajinagar, Pune, 411005");
  await expect(page.getByLabel("Pharmacy code")).toHaveValue("SANJ-PUNE"); // suggested from name + city
  await page.getByLabel("Pharmacy code").fill("bad code!");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Pharmacy code: letters and numbers/)).toBeVisible();
  await page.getByLabel("Pharmacy code").fill(OWNER.tenantCode);
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 2. Owner account
  await expect(page.getByText("Your owner account")).toBeVisible();
  await page.getByLabel("Full name").fill(OWNER.ownerName);
  await page.getByLabel("Email").fill(OWNER.ownerEmail);
  await page.getByLabel("Mobile number").fill("12345");
  await page.getByLabel("Password", { exact: true }).fill(OWNER.ownerPassword);
  await page.getByLabel("Confirm password").fill(OWNER.ownerPassword + "x");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter a valid 10-digit Indian mobile number.")).toBeVisible();
  await page.getByLabel("Mobile number").fill("+91 " + OWNER.ownerPhone);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await page.getByLabel("Confirm password").fill(OWNER.ownerPassword);
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 3. Database
  await expect(page.getByText("Where does your live database run?")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Test the database connection before continuing.")).toBeVisible();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Connected · PostgreSQL \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 4. Branches & counters: two counters at Main, a second branch
  await expect(page.getByText("Branches & counters")).toBeVisible();
  await page.getByLabel("Counters").first().fill("2");
  await page.getByPlaceholder("Branch name, e.g. Kothrud").fill(OWNER.branches[1]);
  await page.getByRole("button", { name: "Add branch" }).click();
  await expect(page.getByLabel("Branch name")).toHaveCount(2);
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 5. Team invites: a manager needs an email; then invite a pharmacist by email
  await expect(page.getByText("Invite your team")).toBeVisible();
  const role = page.locator("select").nth(0);
  await page.getByPlaceholder("Email or mobile").fill("9890112345");
  await role.selectOption("Manager");
  await page.getByRole("button", { name: "Add invite" }).click();
  await expect(page.getByText(/Invite managers by email/)).toBeVisible();
  await page.getByPlaceholder("Email or mobile").fill("pharmacist@e2e-pharmacy.in");
  await role.selectOption("Pharmacist");
  await page.locator("select").nth(1).selectOption(OWNER.branches[1]);
  await page.getByRole("button", { name: "Add invite" }).click();
  await expect(page.getByText("pharmacist@e2e-pharmacy.in")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 6. Recovery kit must be downloaded and acknowledged
  await expect(page.getByText("Backups & recovery kit")).toBeVisible();
  await expect(page.getByText(/Google sign-in isn’t configured on this server/)).toBeVisible(); // Drive step is optional
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("Download the recovery kit and confirm you stored it.")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download & print" }).click()]);
  expect(dl.suggestedFilename()).toBe(`medoro-recovery-kit-${OWNER.tenantCode}.html`);
  const kitPage = readFileSync(await dl.path(), "utf8");
  expect(kitPage).toContain("<h1>Medoro backup recovery kit</h1>");
  expect(kitPage).toContain("<svg"); // the key as a QR code
  const recoveryKey = /<meta name="medoro-recovery-key" content="([^"]+)">/.exec(kitPage)?.[1] ?? "";
  expect(recoveryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText(/Downloaded · key fingerprint/)).toBeVisible();
  await page.getByLabel(/stored the recovery kit offline/).check();
  await page.getByRole("button", { name: "Finish setup" }).click();

  // ── 7. Done: invite codes shown once
  await expect(page.getByText(`${OWNER.pharmacy} is ready`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER.tenantCode, { exact: true })).toBeVisible();
  const inv = await db().invite.findFirstOrThrow({ where: { contact: "pharmacist@e2e-pharmacy.in" } });
  await expect(page.getByText(inv.code, { exact: true })).toBeVisible();
  expect(inv.roleName).toBe("Pharmacist");

  // ── MFA enrolment with a code computed from the key shown on screen
  await page.getByRole("button", { name: "Set up two-step verification" }).click();
  await expect(page).toHaveURL(/\/signin\/mfa/);
  await expect(page.getByAltText("Authenticator QR code")).toBeVisible();
  const secret = (await page.locator("code").first().innerText()).replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel("6-digit code").fill(totp(secret, Date.now() - 10 * 60_000)); // a stale code is refused
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Code did not match. Codes refresh every 30 seconds.")).toBeVisible();
  const recoveryCodes = await enterTotp(page, secret); // the recovery-codes screen follows enrolment
  expect(recoveryCodes!.every((c) => /^[0-9a-z]{4}(-[0-9a-z]{4}){3}$/.test(c))).toBe(true);

  // ── Dashboard
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(OWNER.pharmacy).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Users & branches" })).toBeVisible();

  saveState({ pharmacy: OWNER.pharmacy, tenantCode: OWNER.tenantCode, ownerName: OWNER.ownerName, ownerEmail: OWNER.ownerEmail, ownerPassword: OWNER.ownerPassword, totpSecret: secret, branches: OWNER.branches, recoveryKey, recoveryCodes: recoveryCodes! });
  await page.context().storageState({ path: OWNER_STATE });

  const t = await db().tenant.findUniqueOrThrow({ where: { code: OWNER.tenantCode }, include: { branches: true } });
  expect(t.gstin).toBe("27AAKFS3192P1Z6");
  expect(t.branches.map((b) => b.name).sort()).toEqual([...OWNER.branches].sort());
  expect(await db().counter.count({ where: { tenantId: t.id } })).toBe(3);
});
