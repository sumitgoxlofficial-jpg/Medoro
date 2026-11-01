import { test, expect } from "@playwright/test";

// DriveDB phase 1: billing on the device's own database (SQLite in the browser), no server involved.
test("owner bills on the device database and stock goes down", async ({ page }) => {
  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Open device database" }).click();
  const dolo = page.getByRole("button", { name: /Dolo 650/ });
  await expect(dolo).toContainText("20 strips");
  await dolo.click();
  await dolo.click();
  await page.getByRole("button", { name: "Make bill" }).click();
  await expect(page.getByText(/Bill DEMO12\d{3}-\d{6} saved on this device/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Dolo 650/ })).toContainText("18 strips");
  await expect(page.getByText(/Changes waiting for Drive: \d+/)).toBeVisible();
  // A Schedule H medicine gets the prescriber filled in by the demo; the bill still saves.
  await page.getByRole("button", { name: /Azithral 500/ }).click();
  await page.getByRole("button", { name: "Make bill" }).click();
  await expect(page.getByText(/Bill DEMO12\d{3}-000002 saved/)).toBeVisible();
  // Data survives a reload: it lives on the device.
  await page.reload();
  await page.getByRole("button", { name: "Open device database" }).click();
  await expect(page.getByText("Bills: 2")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: "Open device database" })).toBeVisible();
});
