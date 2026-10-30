import { test, expect } from "@playwright/test";
import { db, expectToast, tenant } from "./helpers";

/** Spec 11 · backup: back up now (server storage), verify by test restore, restore into a test copy and discard it. */
test("create backup, verify it, restore to a test copy", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app/backup");
  await expect(page.getByText(/Fingerprint [0-9A-F:]+/)).toBeVisible();
  await page.getByRole("button", { name: "Back up now" }).click();
  await expectToast(page, /Backup verified · [\d.]+ MB · kept on this server/);

  const t = await tenant();
  const latest = await db().backupManifest.findFirstOrThrow({ where: { tenantId: t.id }, orderBy: { startedAt: "desc" } });
  expect(["verified", "partial"]).toContain(latest.status);

  const row = page.locator("tr").filter({ has: page.getByRole("button", { name: "Test restore" }) }).first();
  await expect(row.getByText(/Verified|Server only/)).toBeVisible();
  const file = await page.request.get((await row.getByLabel("Download encrypted file").getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect((await file.body()).length).toBeGreaterThan(100);

  await row.getByRole("button", { name: "Test restore" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByText(/^Verified\. \d+ invoices, \d+ batches and \d+ vouchers decrypted and match the manifest\. Live data has not been changed\.$/)).toBeVisible({ timeout: 60_000 });
  await modal.getByRole("button", { name: "Close" }).last().click();

  await row.getByRole("button", { name: "Restore…" }).click();
  await expectToast(page, "Test copy ready. Review it at the top of the page.");
  const panel = page.locator("section").filter({ hasText: "Restore ready to review" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("In the backup")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Restore this backup" })).toBeDisabled();
  await panel.getByLabel("Pharmacy code").fill(t.code);
  await expect(panel.getByRole("button", { name: "Restore this backup" })).toBeEnabled();
  // Live data stays as it is: discard the test copy instead of swapping it in.
  await panel.getByRole("button", { name: "Discard test copy" }).click();
  await expectToast(page, "Test copy deleted. Live data unchanged.");
  await expect(page.getByText("Restore ready to review")).toHaveCount(0);
});
