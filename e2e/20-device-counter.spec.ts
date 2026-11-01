import { test, expect } from "@playwright/test";
import { importMedicines, monthsAhead, uid } from "./helpers";

// DriveDB phase 3: a whole counter day on the device, then billing with the internet off (counter PIN).
test("device counter: stock in, customers, credit, return, day-end, then offline billing with the PIN", async ({ page, context }) => {
  const name = `Ctr ${uid()}`;
  await importMedicines(page, [{ name, mrp: 50, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 10, cost: 30 }]);
  await page.goto("/app/lab");
  await expect(page.getByRole("button", { name: /Turn (on|off) Drive mode/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Turn on Drive mode" }).isVisible()) {
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Turn on Drive mode" }).click();
    await expect(page.getByRole("button", { name: "Turn off Drive mode" })).toBeVisible();
  }
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  // Stock in: a supplier bill adds 5 packs + 1 free.
  await page.getByRole("tab", { name: "Purchases" }).click();
  await page.getByLabel("New supplier").fill("Bokaro Agency");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Bill number").fill(`SB-${uid()}`);
  await page.getByLabel("Add item").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel("Batch", { exact: true }).fill(`N${uid()}`);
  await page.getByLabel("Expiry", { exact: true }).fill(monthsAhead(30).iso);
  await page.getByLabel("Packs", { exact: true }).fill("5");
  await page.getByLabel("Free packs").fill("1");
  await page.getByLabel("Rate", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Save bill and add stock" }).click();
  await expect(page.getByText(/entered: 1 item\(s\), ₹168\.00 incl\. GST/)).toBeVisible();
  await page.getByRole("tab", { name: "Stock" }).click();
  await page.getByLabel("Search stock").fill(name);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("16 ");

  // Customer with credit, a credit bill, then part payment.
  await page.getByRole("tab", { name: "Customers" }).click();
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByLabel("Customer name").fill("Asha Devi");
  await page.getByLabel("Mobile").fill("9822" + String(Date.now()).slice(-6));
  await page.getByLabel("Credit limit").fill("1000");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("tab", { name: "Billing" }).click();
  await page.getByLabel("Search medicine").fill(name);
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name }).click();
  await page.getByLabel("Customer").fill("Asha");
  await page.getByRole("button", { name: /Asha Devi/ }).click();
  await page.getByRole("radio", { name: "CREDIT" }).click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByRole("dialog").getByText("TAX INVOICE")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Asha Devi");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("tab", { name: "Customers" }).click();
  await page.getByRole("button", { name: "Receive from Asha Devi" }).click();
  await page.getByLabel("Amount").fill("40");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Asha Devi now owes ₹60\.00/)).toBeVisible();

  // Return one pack from the bill, credited to her account; day-end adds up.
  await page.getByRole("tab", { name: "Bills & day-end" }).click();
  await page.getByRole("button", { name: /^Return from/ }).first().click();
  await page.getByLabel(`Return quantity ${name}`).fill("1");
  await page.getByLabel("Reason").fill("Not needed");
  await page.getByRole("dialog").locator("select").nth(1).selectOption("credit");
  await page.getByRole("button", { name: "Issue credit note" }).click();
  await expect(page.getByText(/Credit note CN.*refund ₹50\.00, 1 line\(s\) back in stock/)).toBeVisible();
  await expect(page.getByText("Credit (to collect)").locator("..")).toContainText("₹100.00");
  await expect(page.getByText("Credited to accounts").locator("..")).toContainText("₹50.00");
  await expect(page.getByText("Cash in drawer from today").locator("..")).toContainText("₹40.00");

  // Counter PIN, then the internet goes off: the counter keeps billing at /device.
  await page.getByRole("tab", { name: "Counter" }).click();
  await page.getByLabel("New PIN").fill("2468");
  await page.getByLabel("Repeat PIN").fill("2468");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByText("Counter PIN saved on this device.")).toBeVisible();
  await page.goto("/device");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect(page.getByLabel("Counter PIN")).toBeVisible();
  await page.reload(); // now under the service worker, which keeps this page and its files
  await expect(page.getByLabel("Counter PIN")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel("Counter PIN").fill("1111");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Wrong PIN.")).toBeVisible();
  await page.getByLabel("Counter PIN").fill("2468");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText(/Offline: bills save on this device/)).toBeVisible();
  await page.getByLabel("Search medicine").fill(name);
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByText(/-000002 · ₹50\.00 saved on this device/)).toBeVisible();
  await context.setOffline(false);

  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
});
