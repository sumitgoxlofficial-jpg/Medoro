import { test, expect } from "@playwright/test";

// Drive mode pilot: the owner turns it on, loads the catalogue onto this browser and bills there.
test("owner turns on Drive mode and bills on the device", async ({ page }) => {
  await page.goto("/app/lab");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Turn on Drive mode" }).click();
  await expect(page.getByRole("link", { name: /Open billing on this device/ })).toBeVisible();

  await page.goto("/app/pos");
  await page.getByRole("link", { name: /Drive mode is on/ }).click();
  await expect(page).toHaveURL(/\/app\/device-pos/);
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  // First medicine in stock: add it and complete the bill.
  const first = page.locator("ul button:not([disabled])").first();
  await expect(first).toBeVisible();
  await first.click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByText(/Bill D\w{4}\d{4}-000001 · .* saved on this device/)).toBeVisible();
  await expect(page.getByText(/D\w{4}\d{4}-000001 · Walk-in · 1 item/)).toBeVisible();

  // Turn it off again so the rest of the suite runs as normal.
  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
  await page.goto("/app/device-pos");
  await expect(page).toHaveURL(/\/app\/pos$/);
});
