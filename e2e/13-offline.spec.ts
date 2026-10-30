import { test, expect } from "@playwright/test";
import { OWNER_STATE, db, expectToast, importMedicines, uid } from "./helpers";

/** Spec 13 · offline billing: turn it on for this device, lose the connection, bill, reconnect → the bill posts with an invoice number. */
test("bill offline and post on reconnect", async ({ page, browser }) => {
  const run = uid(), med = `Off Cetzine ${run}`;
  await importMedicines(page, [{ name: med, generic: "Cetirizine", strength: "10 mg", mrp: 22, gst: 12, batch: `OC${run}`, expiry: "06/2032", qty: 40, cost: 14 }]);

  // Service workers bypass the browser's offline switch, so this counter runs without one.
  const ctx = await browser.newContext({ storageState: OWNER_STATE, serviceWorkers: "block" });
  const p = await ctx.newPage();
  await p.goto("/app/sync");
  const device = `Counter ${run}`;
  await p.getByLabel(/Name this device/).fill(device);
  await p.getByRole("button", { name: "Turn on for this device" }).click();
  await expectToast(p, "Offline billing is ready on this device. If the connection drops, open Offline billing.");
  await expect(p.getByText("On for this device")).toBeVisible();

  await p.goto("/offline");
  await expect(p.getByText(new RegExp(`· ${device}`))).toBeVisible();
  await expect(p.getByText("Online", { exact: true })).toBeVisible();

  await ctx.setOffline(true);
  await expect(p.getByText("No internet")).toBeVisible();
  await p.getByLabel("Search medicine").fill(med);
  await p.getByRole("button", { name: new RegExp(med) }).click();
  await expect(p.getByText(`Batch OC${run}`)).toBeVisible();
  await p.getByRole("button", { name: "More" }).click();
  await p.getByRole("button", { name: "Complete offline bill (F9)" }).click();
  const receipt = p.getByRole("dialog", { name: "Offline receipt" });
  await expect(receipt.getByText(/^Provisional receipt /)).toBeVisible();
  await expect(receipt.getByText("₹44.00")).toBeVisible();
  await receipt.getByRole("button", { name: "Close (Esc)" }).click();
  await expect(p.getByText("1 waiting")).toBeVisible();
  const dev = await db().device.findFirstOrThrow({ where: { name: device } });
  expect(await db().offlineOp.count({ where: { deviceId: dev.id } })).toBe(0);

  await ctx.setOffline(false);
  await expect(p.getByText(/^Sent 1 bill: 1 posted\./)).toBeVisible({ timeout: 20_000 });
  await expect(p.getByText("All sent")).toBeVisible();
  const op = await db().offlineOp.findFirstOrThrow({ where: { deviceId: dev.id } });
  expect(op.status).toBe("posted");
  const invoiceNo = (op.conflict as { invoiceNo?: string }).invoiceNo!;
  expect(invoiceNo).toBeTruthy();
  await expect(p.getByText(invoiceNo)).toBeVisible();
  const sale = await db().sale.findFirstOrThrow({ where: { invoiceNo }, include: { items: true } });
  expect(sale.items[0].qty).toBe(2);
  await ctx.close();
});
