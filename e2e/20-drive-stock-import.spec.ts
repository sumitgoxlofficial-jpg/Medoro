import { test, expect, type Page } from "@playwright/test";
import { chooseImportFile, importMedicines, monthsAhead, openTab, uid } from "./helpers";

async function driveOn(page: Page, seed: string) {
  await importMedicines(page, [{ name: seed, mrp: 40, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 5, cost: 25 }]);
  await page.goto("/app/lab");
  await expect(page.getByRole("button", { name: /Turn (on|off) Drive mode/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Turn on Drive mode" }).isVisible()) {
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Turn on Drive mode" }).click();
  }
  await expect(page.getByRole("link", { name: /Open billing on this device/ })).toBeVisible();
  await page.goto("/app/pos");
  await page.getByRole("link", { name: /Drive mode is on/ }).click();
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

}

async function driveOff(page: Page) {
  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
}

// Drive mode: a shop uploads its old stock list (Excel/CSV) on the counter itself, and it shows up in Stock.
test("counter imports a plain stock list from another billing program", async ({ page }) => {
  await driveOn(page, `Drv ${uid()}`);
  await openTab(page, "Stock");
  const name = `OLDSTK ${uid()} TAB`;
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const csv = `Item Name,Batch,Expiry,Qty,MRP,Rate\n${name},X1,${monthsAhead(18).slash},12,50,30\n`;
  const dlg = await chooseImportFile(page, { name: "stock.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(dlg.getByText(/assumed form Tablet, manufacturer not given, GST 12%/)).toBeVisible();
  await dlg.getByRole("button", { name: /^Import 1 row$/ }).click();
  await expect(dlg.getByText("Import finished")).toBeVisible();
  await dlg.getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Search stock").fill("OLDSTK");
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("12");

  await driveOff(page);
});

// Drive mode: the supplier's bill file is uploaded on the Purchases screen and the stock goes up by itself.
test("counter uploads a purchase bill and stock updates", async ({ page }) => {
  const med = `PURCH${uid()} TAB`;
  await driveOn(page, med);
  await openTab(page, "Purchases");
  await page.getByLabel("New supplier").fill("Bill Agency");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Bill file")).toBeEnabled();
  const csv = `Item Name,Batch,Expiry,Qty,Rate,MRP,GST\n${med},PB1,${monthsAhead(20).slash},30,24,40,12\n`;
  await page.getByLabel("Bill file").setInputFiles({ name: "bill.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(med).first()).toBeVisible();
  await page.getByLabel("Bill no.").fill(`PB-${uid()}`);
  await page.getByRole("button", { name: "Save bill and add stock" }).first().click();
  await expect(page.getByText(/Stock updated/)).toBeVisible();
  await openTab(page, "Stock");
  await page.getByLabel("Search stock").fill(med);
  await expect(page.getByRole("row", { name: new RegExp(med) })).toContainText("35");
  await driveOff(page);
});
