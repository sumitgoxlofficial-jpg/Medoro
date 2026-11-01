import { test, expect } from "@playwright/test";
import { driveModeOn, importMedicines, monthsAhead, uid } from "./helpers";

// DriveDB phase 6: the counter's assistant answers from the device's own data (built-in rules: no model on the test server).
test("ask the counter about sales and stock", async ({ page }) => {
  const name = `Ask ${uid()}`;
  await importMedicines(page, [{ name, mrp: 40, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 12, cost: 25 }]);
  await driveModeOn(page);
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();
  await page.getByRole("tab", { name: "Ask" }).click();
  await page.getByRole("button", { name: "Sales today" }).click();
  await expect(page.getByTestId("answer").first()).toContainText(/Today so far: ₹0 across 0 bills/);
  await expect(page.getByTestId("answer").first()).toContainText("Built-in rules");
  await page.getByLabel("Ask a question").fill(`stock of ${name}`);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("answer").first()).toContainText(name);
  await page.getByLabel("Ask a question").fill("What is the dose of paracetamol for a child?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("answer").first()).not.toContainText(/mg|ml/);

  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
});
