import { test, expect } from "@playwright/test";
import { db, expectToast, importMedicines, rowOf, uid } from "./helpers";

/** Spec 5 · purchases: purchase order, GRN against it with the totals check, supplier payment. */
test("PO → place → GRN against PO with totals check → supplier payment", async ({ page }) => {
  const run = uid(), supplier = `Mahavir Agencies ${run}`, med = `Pur Montair ${run}`, batch = `MN${run}`;
  await importMedicines(page, [{ name: med, generic: "Montelukast + Levocetirizine", strength: "10/5 mg", mrp: 210, gst: 12 }]);

  // Supplier
  await page.goto("/app/parties");
  await page.getByRole("button", { name: "Add supplier" }).first().click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name *").fill(supplier);
  await dlg.getByRole("textbox", { name: "GSTIN" }).fill("27AABCM1234F1Z5");
  await dlg.getByLabel("Credit terms (days)").fill("15");
  await dlg.getByRole("button", { name: "Save supplier" }).click();
  await expectToast(page, "Supplier added.");

  // Purchase order: draft, then placed
  await page.goto("/app/purchases");
  await page.getByRole("button", { name: "New purchase order" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Supplier").selectOption({ label: supplier });
  await dlg.getByLabel("Medicine").selectOption({ label: `${med} 10/5 mg` });
  await dlg.getByLabel("Quantity", { exact: true }).fill("20");
  await dlg.getByLabel("PTR", { exact: true }).fill("150"); // the rate is the PTR (price to retailer)
  await expect(dlg.getByText("₹3,000.00")).toBeVisible();
  await dlg.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, /PO-.* saved as a draft/);
  const po = await db().purchaseOrder.findFirstOrThrow({ where: { supplier: { name: supplier } } });
  const row = rowOf(page, po.no);
  await expect(row.getByText("Draft")).toBeVisible();
  await row.getByRole("button", { name: "Place order" }).click();
  await expect(row.getByText("Ordered")).toBeVisible();

  // GRN against the PO: lines come from the order; approval waits for complete lines and matching totals
  await row.getByRole("button", { name: "Receive" }).click();
  await expect(page).toHaveURL(/tab=receive&po=/);
  await expect(page.getByLabel("Against PO")).toHaveValue(po.id);
  await page.getByLabel("Invoice no.").fill(`MA/${run}/77`);
  await page.getByLabel("Batch").fill(batch);
  await page.getByLabel("Expiry").fill("2031-09");
  await expect(page.getByLabel("Qty", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("PTR", { exact: true })).toHaveValue("150.00");
  const approve = page.getByRole("button", { name: "Approve & post GRN" });
  await expect(page.getByText("Enter the printed total")).toBeVisible();
  await expect(approve).toBeDisabled();
  // ₹3,000 taxable + 12% GST = ₹3,360
  await expect(page.getByText("Calculated").locator("strong")).toHaveText("₹3,360.00");
  await page.getByLabel("Total printed on invoice ₹").fill("3400");
  await expect(page.getByText("Difference ₹40.00")).toBeVisible();
  await expect(approve).toBeDisabled();
  await page.getByLabel("Total printed on invoice ₹").fill("3360.40");
  await expect(page.getByText(/Totals match \(round-off/)).toBeVisible();
  await expect(page.getByText("All lines validated")).toBeVisible();
  await approve.click();
  await expect(page.getByText("GRN posted", { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`GRN-.* posted · 1 batch line\\(s\\) · ₹3,360\\.40 added to ${supplier} payable`))).toBeVisible();

  await page.getByRole("button", { name: "Back to orders" }).click();
  await expect(rowOf(page, po.no).getByText("Received", { exact: true })).toBeVisible();
  const b = await db().batch.findFirstOrThrow({ where: { batchNo: batch } });
  expect(b.qtyAvailable).toBe(20);

  // Supplier payment against the payable
  await page.goto("/app/parties");
  const sup = rowOf(page, supplier);
  await expect(sup).toContainText("₹3,360");
  await sup.getByRole("button", { name: "Record payment" }).click();
  dlg = page.getByRole("dialog");
  await expect(dlg.getByText("₹3,360.40")).toBeVisible();
  await dlg.getByLabel("Amount").fill("1000");
  await dlg.getByRole("button", { name: "Post voucher" }).click();
  await expectToast(page, /posted for ₹1,000\.00\./);
  await expect(rowOf(page, supplier)).toContainText("₹2,360");

  // Supplier statement: GRN and payment as ledger lines, CSV and print versions.
  await rowOf(page, supplier).getByRole("button", { name: "Statement" }).click();
  await expect(page.getByRole("heading", { name: `Statement · ${supplier}` })).toBeVisible();
  await expect(page.getByText(/^Closing \(.*\) ₹2,360\.40$/)).toBeVisible();
  await expect(page.locator("tr").filter({ hasText: /GRN-/ }).first()).toContainText("₹3,360.40");
  await expect(page.locator("tr").filter({ hasText: /₹1,000\.00/ }).first()).toBeVisible();
  const csv = await page.request.get((await page.getByRole("link", { name: "CSV" }).getAttribute("href"))!);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toMatch(/3,?360\.40/);
  const print = await page.request.get((await page.getByRole("link", { name: "Print" }).getAttribute("href"))!);
  expect(print.status()).toBe(200);
  expect(await print.text()).toContain(supplier);
});
