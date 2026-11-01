import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { driveModeOn, importMedicines, monthsAhead, uid } from "./helpers";

// DriveDB phase 5: accounts, reports and GST on the device.
test("device accounts, reports and GST: supplier payment, expense, cash book, profit and GSTR-1 download", async ({ page }) => {
  const name = `Bk ${uid()}`;
  await importMedicines(page, [{ name, mrp: 112, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 30, cost: 70 }]);
  await driveModeOn(page);
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  // A supplier bill: 10 packs at ₹70 + 12% GST = ₹784.
  await page.getByRole("tab", { name: "Purchases" }).click();
  await page.getByLabel("New supplier").fill("Jharkhand Pharma");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Bill number").fill(`JP-${uid()}`);
  await page.getByLabel("Add item").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel("Batch", { exact: true }).fill(`N${uid()}`);
  await page.getByLabel("Expiry", { exact: true }).fill(monthsAhead(30).iso);
  await page.getByLabel("Packs", { exact: true }).fill("10");
  await page.getByLabel("Rate", { exact: true }).fill("70");
  await page.getByRole("button", { name: "Save bill and add stock" }).click();
  await expect(page.getByText(/₹784\.00 incl\. GST/)).toBeVisible();

  // Accounts: pay ₹500 in cash, add a ₹100 cash expense.
  await page.getByRole("tab", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Pay Jharkhand Pharma" }).click();
  await page.getByLabel("Payment amount").fill("500");
  await page.getByLabel("Payment mode").selectOption("cash");
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByText(/Jharkhand Pharma is now owed ₹284\.00/)).toBeVisible();
  await page.getByLabel("Expense amount").fill("100");
  await page.getByLabel("Expense note").fill("Tea");
  await page.getByRole("button", { name: /Add expense for today/ }).click();
  await expect(page.getByText("Electricity · Tea")).toBeVisible();
  await expect(page.getByText(/Out ₹600\.00/)).toBeVisible();

  // A cash bill: 2 packs = ₹224.
  await page.getByRole("tab", { name: "Billing" }).click();
  await page.getByLabel("Search medicine").fill(name);
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByRole("dialog").getByText("TAX INVOICE")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

  // Day-end: cash in drawer = 224 − 500 − 100.
  await page.getByRole("tab", { name: "Bills & day-end" }).click();
  await expect(page.getByText("Cash in drawer from today").locator("..")).toContainText("−₹376.00");

  // Reports & GST: profit, and a GSTR-1 file with this sale.
  await page.getByRole("tab", { name: "Reports & GST" }).click();
  await expect(page.getByTestId("gross-profit")).not.toHaveText("₹0.00");
  await expect(page.getByRole("cell", { name: "B2CS (7)" })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /GSTR-1 JSON/ }).click()]);
  const g = JSON.parse(await readFile((await dl.path())!, "utf8"));
  expect(g.gstin).toMatch(/^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ\w$/);
  expect(g.b2cs.some((r: { rt: number }) => r.rt === 12)).toBe(true);

  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
});
