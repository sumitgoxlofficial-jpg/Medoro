import { test, expect } from "@playwright/test";
import { driveModeOn, importMedicines, monthsAhead, uid } from "./helpers";

// DriveDB phase 5 (slice 3): branch transfers, WhatsApp bill links and the activity log on the device.
test("device: send stock to the other branch, WhatsApp a bill, see it all in the activity log", async ({ page, context }) => {
  const name = `Trf ${uid()}`;
  await importMedicines(page, [{ name, mrp: 50, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 20, cost: 30 }]);
  await driveModeOn(page);
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  // Send 5 to the other branch.
  await page.getByRole("tab", { name: "Stock" }).click();
  await page.getByLabel("Search stock").fill(name);
  await page.getByRole("button", { name: `Batches of ${name}` }).click();
  await page.getByLabel(/^Send quantity/).fill("5");
  await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Sent 5 to .*15 left here/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();

  // A bill for a customer with a mobile: the bill has a WhatsApp button with the bill text.
  const phone = "97" + String(Date.now()).slice(-8);
  await page.getByRole("tab", { name: "Customers" }).click();
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByLabel("Customer name").fill("Kiran");
  await page.getByLabel("Mobile").fill(phone);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("tab", { name: "Billing" }).click();
  await page.getByLabel("Search medicine").fill(name);
  await page.getByRole("button", { name }).click();
  await page.getByLabel("Customer").fill("Kiran");
  await page.getByRole("button", { name: /Kiran/ }).click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByRole("dialog").getByText("TAX INVOICE")).toBeVisible();
  await context.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "WhatsApp" })); // no internet in tests
  const [wa] = await Promise.all([context.waitForEvent("page"), page.getByRole("dialog").getByRole("button", { name: "WhatsApp" }).click()]);
  await wa.waitForLoadState();
  const url = new URL(wa.url());
  expect(url.host).toBe("wa.me");
  expect(url.pathname).toBe(`/91${phone}`);
  expect(url.searchParams.get("text")).toContain(`${name} × 1 = ₹50.00`);
  await wa.close();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

  // The activity log shows the bill and the transfer.
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByText(/Bill D\w{4}\d{4}-000001 · Kiran/)).toBeVisible();
  await expect(page.getByText(new RegExp(`Sent to another branch: -5 · ${name}`))).toBeVisible();

  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
});
