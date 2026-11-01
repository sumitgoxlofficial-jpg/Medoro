import { test, expect } from "@playwright/test";
import { importMedicines, monthsAhead, uid } from "./helpers";

// Drive mode pilot: the owner turns it on, loads the catalogue onto this browser and bills there.
test("owner turns on Drive mode and bills on the device", async ({ page }) => {
  const name = `Drv ${uid()}`;
  await importMedicines(page, [{ name, mrp: 40, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 20, cost: 25 }]);
  await page.goto("/app/lab");
  // A run that stopped half-way may have left it on.
  await expect(page.getByRole("button", { name: /Turn (on|off) Drive mode/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Turn on Drive mode" }).isVisible()) {
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Turn on Drive mode" }).click();
  }
  await expect(page.getByRole("link", { name: /Open billing on this device/ })).toBeVisible();

  await page.goto("/app/pos");
  await page.getByRole("link", { name: /Drive mode is on/ }).click();
  await expect(page).toHaveURL(/\/app\/device-pos/);
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  await page.getByLabel("Search medicine").fill(name);
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByText(/Bill D\w{4}\d{4}-000001 · .* saved on this device/)).toBeVisible();
  // The bill opens ready to print; the day's bills are under "Bills & day-end".
  await expect(page.getByRole("dialog").getByText("TAX INVOICE")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("tab", { name: "Bills & day-end" }).click();
  await expect(page.getByText(/D\w{4}\d{4}-000001 · Walk-in · 1 item/)).toBeVisible();

  // Turn it off again so the rest of the suite runs as normal.
  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
  await page.goto("/app/device-pos");
  await expect(page).toHaveURL(/\/app\/pos$/);
});
