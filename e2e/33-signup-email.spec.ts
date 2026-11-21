import { test, expect } from "@playwright/test";
import { db, uid } from "./helpers";
import { startMailSink } from "./mail-sink";

/**
 * Spec 33 · Distributor sign-up when email is configured (MAIL_PROVIDER=http with the e2e sink, see mail-sink.ts).
 * - Public sign-up (PUBLIC_SIGNUP=1, DIST_HOSTED=1, as on Medoro's hosted server): the email is confirmed with a 6-digit
 *   code before the business form opens; a wrong code opens nothing.
 * - A server opened with the setup token instead (self-hosted): the business form opens directly. It used to show the
 *   email-code step, whose action refuses unless public sign-up is open, so sign-up was a dead end.
 * Without the sink both are skipped; e2e/dist/distribution.dist.ts covers sign-up without email.
 */
test.use({ storageState: { cookies: [], origins: [] } });
const sinkReady = !!process.env.E2E_SINK_KEY && process.env.MAIL_PROVIDER === "http";
const publicSignup = process.env.PUBLIC_SIGNUP === "1" && process.env.DIST_HOSTED === "1";

test.beforeEach(async () => { await db().loginAttempt.deleteMany({ where: { key: { contains: "signup" } } }); });

test("setup-token server with email configured: the distributor form opens directly", async ({ page }) => {
  test.skip(!sinkReady || publicSignup, "Needs the mail sink on a server without public sign-up");
  await page.goto("/distributor-signup");
  await expect(page.getByRole("heading", { name: "Create your distributor account" })).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code" })).toHaveCount(0);
});

test("public sign-up confirms the email with a code before the business form", async ({ page }) => {
  test.skip(!sinkReady || !publicSignup, "Needs the mail sink and PUBLIC_SIGNUP=1 with DIST_HOSTED=1");
  const sink = await startMailSink();
  try {
    const email = `owner-${uid().toLowerCase()}@dist-e2e.in`;
    await page.goto("/distributor-signup?with=email");
    await expect(page.getByRole("heading", { name: "Create your distributor account" })).toBeVisible();
    await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);
    await page.getByLabel("Your email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText("We sent a 6-digit code to")).toBeVisible();
    const mail = await sink.latest(email);
    const code = mail.text.match(/\b(\d{6})\b/)?.[1];
    expect(code, "a 6-digit code in the email").toBeTruthy();

    // A wrong code is refused and nothing opens.
    await page.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Confirm and continue" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);

    // The right code opens the business form with the confirmed email.
    await page.getByLabel("6-digit code").fill(code!);
    await page.getByRole("button", { name: "Confirm and continue" }).click();
    await expect(page.getByText("Email confirmed:")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  } finally {
    await sink.close();
  }
});
