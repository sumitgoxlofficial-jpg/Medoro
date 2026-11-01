import { test, expect } from "@playwright/test";
import { db, driveModeOn, importMedicines, monthsAhead, tenant, uid } from "./helpers";

// DriveDB phase 5 (slice 2): stock corrections and counts, blocking a batch, home delivery orders, loyalty points.
test("device stock corrections, a cash-on-delivery order and loyalty points", async ({ page }) => {
  const name = `Ops ${uid()}`;
  await importMedicines(page, [{ name, mrp: 100, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 20, cost: 60 }]);
  // Loyalty on: 10 points per ₹100, 1 point = ₹1, use from 1 point.
  const t = await tenant();
  await db().tenant.update({ where: { id: t.id }, data: { settings: { ...(t.settings as object), loyalty: { enabled: true, earnPer100: 10, pointValuePaise: 100, minRedeem: 1, expiryMonths: 12, notify: false, template: "loyalty_points" } } } });
  await driveModeOn(page);
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  // Stock: write off 2 damaged, recall and release the batch, then a count.
  await page.getByRole("tab", { name: "Stock" }).click();
  await page.getByLabel("Search stock").fill(name);
  await page.getByRole("button", { name: `Batches of ${name}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^Quantity for/).fill("2");
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/now 18 /)).toBeVisible();
  await dlg.getByLabel(/^Status of/).selectOption("recalled");
  await expect(page.getByText(/is blocked from sale/)).toBeVisible();
  await dlg.getByLabel(/^Status of/).selectOption("ok");
  await expect(page.getByText(/can be sold again/)).toBeVisible();
  await dlg.getByLabel(/^Counted/).fill("17");
  await dlg.getByRole("button", { name: "Save stock count" }).click();
  await expect(page.getByText(/1 batch\(es\) corrected/)).toBeVisible();
  await dlg.getByRole("button", { name: "Close" }).last().click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("17 ");

  // A cash-on-delivery order for a new customer: take, pack & bill, out, delivered.
  const phone = "98" + String(Date.now()).slice(-8);
  await page.getByRole("tab", { name: "Orders" }).click();
  await page.getByRole("button", { name: "New order" }).click();
  await page.getByLabel("Order customer").fill(phone);
  await page.getByLabel("New customer name").fill("Sunita Devi");
  await page.getByLabel("Delivery address").fill("Quarter 22, Sector 4, Bokaro");
  await page.getByLabel("Order item").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel(`Quantity ${name}`).fill("2");
  await page.getByRole("button", { name: "Take order" }).click();
  await expect(page.getByText(/Order D\w{4}-O1 taken/)).toBeVisible();
  await page.getByRole("button", { name: /^Pack D/ }).click();
  await expect(page.getByRole("dialog").getByText("TAX INVOICE")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
  page.once("dialog", (d) => d.accept("Raju"));
  await page.getByRole("button", { name: /^Send out D/ }).click();
  await expect(page.getByText(/out for delivery with Raju/)).toBeVisible();
  await page.getByRole("button", { name: /^Delivered D/ }).click();
  await expect(page.getByText(/Delivered\. Cash ₹200\.00 recorded/)).toBeVisible();

  // She earned 20 points on the ₹200 order; spend 20 on a counter bill.
  await page.getByRole("tab", { name: "Billing" }).click();
  await page.getByLabel("Search medicine").fill(name);
  await page.getByRole("button", { name }).click();
  await page.getByLabel("Customer").fill(phone.slice(0, 6));
  await page.getByRole("button", { name: /Sunita Devi/ }).click();
  await expect(page.getByText("20 pts")).toBeVisible();
  await page.getByLabel("Points to use").fill("20");
  await expect(page.getByText(/to pay ₹80\.00/)).toBeVisible();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByText(/saved on this device.*8 points earned/)).toBeVisible();

  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
  // Put the pharmacy's loyalty settings back for the rest of the suite.
  const now = await tenant();
  await db().tenant.update({ where: { id: now.id }, data: { settings: { ...(now.settings as object), loyalty: (t.settings as { loyalty?: object }).loyalty ?? { enabled: false } } } });
});
