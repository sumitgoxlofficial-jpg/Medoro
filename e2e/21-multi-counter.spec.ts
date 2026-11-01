import { test, expect, type Page } from "@playwright/test";
import { anonContext, createStaff, driveModeOn, employeeLogin, importMedicines, monthsAhead, resetFakeDrive, state, uid } from "./helpers";

// DriveDB phase 4: owner and staff counters share one pharmacy through Google Drive (the test server's fake,
// through Medoro's relay). Staff join with the owner's approval; both see each other's bills and the same stock;
// a removed device is shut out.
test("a staff counter joins with approval, both counters stay in step, and removing it shuts it out", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const name = `Mlt ${uid()}`;
  await importMedicines(page, [{ name, mrp: 40, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 50, cost: 20 }]);
  const staff = await createStaff(browser, page, "Cashier", `Ravi ${uid()}`);
  await resetFakeDrive(page);
  await driveModeOn(page);

  // Owner counter: load, set up Drive.
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();
  await page.getByRole("button", { name: "Set up Drive storage" }).click();
  await page.getByLabel(/saved the recovery code/).check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Last full copy")).toBeVisible();

  // Staff counter (another browser): signs in, asks to join.
  const sctx = await anonContext(browser);
  const sp = await sctx.newPage();
  await employeeLogin(sp, state().tenantCode, staff.employeeNo, staff.pin);
  await expect(sp).toHaveURL(/\/app$/);
  await sp.goto("/app/device-pos");
  await expect(sp.getByText(/has asked to join/)).toBeVisible();

  // Owner approves it under Counter → Devices.
  await page.getByRole("tab", { name: "Counter" }).click();
  await page.getByRole("button", { name: new RegExp(`Approve .*${staff.name}`) }).click();
  await expect(page.getByText(/approved\. It sets itself up from Google Drive/)).toBeVisible();

  // Staff sets up from Drive (no recovery code) and bills.
  await sp.reload();
  await sp.getByRole("button", { name: "Set up from Google Drive" }).click();
  await expect(sp.getByText(/Restored from Google Drive/)).toBeVisible();
  const sell = async (p: Page, packs: number) => {
    await p.getByRole("tab", { name: "Billing" }).click();
    await p.getByLabel("Search medicine").fill(name);
    for (let i = 0; i < packs; i++) await p.getByRole("button", { name }).click();
    await p.getByRole("button", { name: /Complete bill/ }).click();
    await expect(p.getByText(/saved on this device/).last()).toBeVisible();
    await p.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
  };
  await sell(sp, 3);
  await sell(page, 2);

  // Both counters end with both bills and the same stock (50 − 3 − 2).
  const stockOf = async (p: Page) => {
    await p.getByRole("tab", { name: "Stock" }).click();
    await p.getByLabel("Search stock").fill(name);
    return p.getByRole("row", { name: new RegExp(name) });
  };
  for (const p of [page, sp]) {
    await expect(async () => {
      await p.getByRole("tab", { name: "Billing" }).click();
      await p.getByRole("button", { name: "Sync now" }).click();
      await expect(await stockOf(p)).toContainText("45 ", { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await p.getByRole("tab", { name: "Bills & day-end" }).click();
    await expect(p.getByText(/· Walk-in · 1 item/)).toHaveCount(2);
  }

  // Owner removes the staff device: it is shut out.
  await page.getByRole("tab", { name: "Counter" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: new RegExp(`Remove .*${staff.name}`) }).click();
  await expect(page.getByText(/removed\./)).toBeVisible();
  await sp.reload();
  await expect(sp.getByText(/removed this device from Drive mode/).first()).toBeVisible({ timeout: 30_000 });
  await sctx.close();

  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
});
