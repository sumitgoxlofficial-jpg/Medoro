import { test, expect } from "@playwright/test";
import { chooseImportFile, importMedicines, monthsAhead, openTab, uid } from "./helpers";

// Drive mode: a shop uploads its old stock list (Excel/CSV) on the counter itself, and it shows up in Stock.
test("counter imports a plain stock list from another billing program", async ({ page }) => {
  const seed = `Drv ${uid()}`;
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

  await page.goto("/app/lab");
  await page.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(page.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
});
