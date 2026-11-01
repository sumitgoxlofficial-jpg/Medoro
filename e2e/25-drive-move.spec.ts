import { test, expect } from "@playwright/test";
import { driveModeOn, resetFakeDrive } from "./helpers";

// DriveDB phase 7: the owner's device moves the whole pharmacy (everything earlier specs created) out of Medoro,
// checks every count and total, saves it to (the test server's fake) Google Drive, then the move is undone.
test("move all data from Medoro to Drive, checked, with Medoro read-only and undo", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/app/lab");
  const undo = page.getByRole("button", { name: /Undo the move|Cancel the move/ });
  if (await undo.isVisible()) { page.once("dialog", (d) => d.accept()); await undo.click(); await expect(page.getByTestId("move-status")).toHaveCount(0); } // a stopped run left it moved
  await driveModeOn(page);
  await resetFakeDrive(page);
  page.on("dialog", (d) => d.accept());
  await page.goto("/app/device-pos");
  await expect(page.getByTestId("move-card")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Move all my data" }).click();

  const code = page.getByTestId("recovery-code"), failed = page.getByRole("button", { name: "Cancel the move" });
  await expect(code.or(failed)).toBeVisible({ timeout: 180_000 });
  if (await failed.isVisible()) throw new Error(`Move failed: ${await page.getByTestId("move-card").innerText()}`);
  await expect(page.getByText(/All \d+ checks matched/)).toBeVisible();
  await page.getByLabel(/saved the recovery code/).check();
  await page.getByRole("button", { name: "Done" }).click();

  // The device is now the pharmacy: the catalogue and stock moved from Medoro are there, and Drive has a full copy.
  await page.getByRole("tab", { name: "Stock" }).click();
  await expect(page.getByText(/Paracetamol/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Billing" }).click();
  await expect(page.getByText("Last full copy")).toBeVisible();

  // Medoro says so on the Drive mode card and in notifications (refusing changes is covered by tests/integration).
  await page.goto("/app/lab");
  await expect(page.getByTestId("move-status")).toContainText("Your data lives in your Google Drive");
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText(/now lives in your Google Drive/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Turn (on|off) Drive mode/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Undo the move" }).click();
  await expect(page.getByRole("button", { name: "Turn off Drive mode" })).toBeVisible();
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
});
