import { test, expect } from "@playwright/test";
import { db, expectToast, importMedicines, quickSale, uid } from "./helpers";

/** Spec 7 · returns and shift: return against an invoice (restock), credit note, shift close with a cash difference. */
test("open shift → cash sale → return with credit note → close shift short", async ({ page }) => {
  const run = uid(), med = `Ret Allegra ${run}`, batch = `RA${run}`;
  await importMedicines(page, [{ name: med, generic: "Fexofenadine", strength: "120 mg", mrp: 100, batch, expiry: "12/2031", qty: 20, cost: 70 }]);

  await page.goto("/app/returns");
  await expect(page.getByText("Shift · Browser counter")).toBeVisible();
  const close = page.getByRole("button", { name: "Close shift & post" });
  if (await close.isVisible()) { // left open by an earlier run
    const exp = (await page.getByText("Expected in drawer").locator("..").locator(".tnum").innerText()).replace(/[₹,]/g, "");
    await page.getByLabel("Counted cash (₹)").fill(exp);
    await close.click();
    await expectToast(page, /Shift closed/);
  }
  await page.getByLabel("Opening float (₹)").fill("500");
  await page.getByRole("button", { name: "Open shift" }).click();
  await expectToast(page, "Shift opened.");
  await expect(page.getByText("Expected in drawer").locator("..")).toContainText("₹500.00");

  const invoice = await quickSale(page, med, 2);
  const sale = await db().sale.findFirstOrThrow({ where: { invoiceNo: invoice } });
  expect(Number(sale.totalPaise)).toBe(20000);

  // Return one sealed strip for cash.
  await page.goto("/app/returns");
  await page.getByLabel("Find invoice").fill(invoice);
  await page.getByLabel("Invoice", { exact: true }).selectOption(sale.id);
  await expect(page.getByText(/sold 2 · returned 0/)).toBeVisible();
  await page.getByLabel(`Return qty ${med}`).fill("1");
  await page.getByLabel("Condition").selectOption("sealed");
  await page.getByLabel("Refund mode").selectOption("Cash");
  await expect(page.getByText(/^Refund ₹100\.00$/)).toBeVisible();
  await page.getByRole("button", { name: "Issue credit note" }).click();
  await expectToast(page, "Enter the reason for the return.");
  await page.getByLabel("Reason").fill("Customer bought extra");
  await page.getByRole("button", { name: "Issue credit note" }).click();
  await expectToast(page, /CN.* issued for ₹100\.00\./);
  await expect(page.getByText(/sold 2 · returned 1/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Credit notes today").locator("..")).toContainText(invoice);
  const b = await db().batch.findFirstOrThrow({ where: { batchNo: batch } });
  expect(b.qtyAvailable).toBe(19); // 20 − 2 sold + 1 sealed return

  // Shift: 500 float + 200 cash sale − 100 cash refund = 600 expected; 590 counted.
  await expect(page.getByText("Expected in drawer").locator("..")).toContainText("₹600.00");
  await page.getByLabel("Counted cash (₹)").fill("590");
  await expect(page.getByText("Difference −₹10.00 (short)")).toBeVisible();
  await page.getByRole("button", { name: "Close shift & post" }).click();
  await expectToast(page, "Shift closed. Difference −₹10.00 posted to Cash short/excess.");
  await expect(page.getByText(/Last shift closed .* expected ₹600\.00 · counted ₹590\.00/)).toBeVisible();
});
