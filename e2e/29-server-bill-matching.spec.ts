import { test, expect } from "@playwright/test";
import { addToCart, completeSale, importMedicines, monthsAhead, uid } from "./helpers";

const ddmm = () => { const d = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10).split("-"); return `${d[2]}/${d[1]}/${d[0]}`; };

// A pharmacy whose data is on this server (self-hosted): a bank statement credit carrying the bill's reference pays
// the credit bill by itself, through a receipt voucher; the match can be undone.
test("self-hosted: statement credit pays a credit bill through a receipt, and can be undone", async ({ page }) => {
  // Earlier specs may have left Drive mode on for this pharmacy.
  await page.goto("/app/lab");
  await expect(page.getByRole("button", { name: /Turn (on|off) Drive mode/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Turn off Drive mode" }).isVisible()) {
    await page.getByRole("button", { name: "Turn off Drive mode" }).click();
    await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
  }
  const med = `Bill ${uid()}`;
  await importMedicines(page, [{ name: med, mrp: 45, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 20, cost: 25 }]);

  // A ₹90 credit bill at the server POS.
  const cust = `Hospital ${uid()}`;
  await page.goto("/app/pos");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name *").fill(cust);
  await dlg.getByLabel("Credit limit ₹").fill("5000");
  await dlg.getByRole("button", { name: "Save customer" }).click();
  await expect(page.locator("#pos-cust")).toHaveValue(/.+/);
  await addToCart(page, med);
  await page.getByRole("button", { name: "Increase" }).click();
  await page.getByRole("button", { name: "Credit", exact: true }).click();
  const invoice = await completeSale(page);

  // UPI & Bank Connect lists the open bill with its references.
  await page.goto("/app/money");
  const row = page.locator("tr").filter({ hasText: invoice });
  await expect(row).toContainText(cust);
  const ref = (await row.locator("td").nth(4).innerText()).trim();
  expect(ref).toMatch(/^MD[A-Z0-9]+$/);

  // The bank statement shows the hospital's NEFT with the reference.
  await page.goto("/app/bank");
  const csv = ["Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance", `${ddmm()},"NEFT CR-SBIN0001234-CITY HOSPITAL-SBIN426306${String(Date.now()).slice(-6)} ${ref}",,${ddmm()},,90.00,`].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: `stmt-${uid()}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/1 new line\(s\) imported · 0 matched automatically, 1 paid credit bills/)).toBeVisible();

  // Paid: the bill left the open list, the match shows with its receipt voucher.
  await page.goto("/app/money");
  await expect(page.locator("tr").filter({ hasText: invoice })).toHaveCount(0);
  const match = page.getByRole("listitem").filter({ hasText: invoice });
  await expect(match).toContainText(/RV-/);
  await expect(match).toContainText("automatic, rule 1");

  // Undo reverses the receipt; the bill is open again and the credit waits (that pair is not suggested again).
  await match.getByRole("button", { name: `Undo ${invoice}` }).click();
  await expect(page.getByText("Match undone. The receipt is reversed.")).toBeVisible();
  await expect(page.locator("tr").filter({ hasText: invoice })).toContainText("₹90.00");
  await expect(page.getByText(/Bank credits to match to credit bills \([1-9]/)).toBeVisible();
});
