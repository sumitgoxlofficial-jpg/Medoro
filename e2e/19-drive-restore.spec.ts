import { test, expect } from "@playwright/test";
import { OWNER_STATE, driveModeOn, importMedicines, monthsAhead, resetFakeDrive, uid } from "./helpers";

// DriveDB phase 2: the device saves the pharmacy to (the test server's fake) Google Drive through Medoro's relay,
// encrypted; a fresh device restores it with the recovery code.
test("set up Drive storage, then restore everything on a fresh device with the recovery code", async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: OWNER_STATE });
  const page = await ctxA.newPage();
  const name = `Rst ${uid()}`;
  await importMedicines(page, [{ name, mrp: 50, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 20, cost: 30 }]);
  await resetFakeDrive(page);
  await driveModeOn(page);
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();
  const bill = async () => {
    await page.getByLabel("Search medicine").fill(name);
    await page.getByRole("button", { name }).click();
    await page.getByRole("button", { name: /Complete bill/ }).click();
    await expect(page.getByText(/saved on this device/).last()).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
  };
  await bill();

  await page.getByRole("button", { name: "Set up Drive storage" }).click();
  const code = (await page.getByTestId("recovery-code").textContent())!.trim();
  expect(code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  await page.getByLabel(/saved the recovery code/).check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Last full copy")).toBeVisible();
  await bill(); // goes up as a change file within a few seconds
  await expect(page.getByText("Changes waiting").locator("xpath=following-sibling::span[1]")).toHaveText("0", { timeout: 30_000 });
  await ctxA.close();

  const ctxB = await browser.newContext({ storageState: OWNER_STATE });
  const pageB = await ctxB.newPage();
  await pageB.goto("/app/device-pos");
  await expect(pageB.getByText("Or restore from Google Drive")).toBeVisible();
  await pageB.getByLabel("Drive recovery code").fill(code.replace(/^..../, "0000"));
  await pageB.getByRole("button", { name: "Restore from Google Drive" }).click();
  await expect(pageB.getByText(/doesn’t open this pharmacy/)).toBeVisible();
  await pageB.getByLabel("Drive recovery code").fill(code.toLowerCase());
  await pageB.getByRole("button", { name: "Restore from Google Drive" }).click();
  await expect(pageB.getByText(/Restored from Google Drive/)).toBeVisible();
  await pageB.getByRole("tab", { name: "Bills & day-end" }).click();
  await expect(pageB.getByText(/-000001 · Walk-in/)).toBeVisible();
  await expect(pageB.getByText(/-000002 · Walk-in/)).toBeVisible();
  await pageB.getByRole("tab", { name: "Billing" }).click();
  await expect(pageB.getByText("Last full copy")).toBeVisible();

  await pageB.goto("/app/lab");
  await pageB.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(pageB.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
  await ctxB.close();
});
