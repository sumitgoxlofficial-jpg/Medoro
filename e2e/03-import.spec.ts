import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { xlsx } from "../tests/xlsx";
import { chooseImportFile, db, rowOf, tenant, uid } from "./helpers";

/** Spec 3 · data import: medicines with opening stock from a file; a bad file explains every row and saves nothing. */
test("import medicines with opening stock; a failing file shows per-row reasons and saves nothing", async ({ page }) => {
  const run = uid();
  const t = await tenant();

  // ── A broken Excel file: every problem listed by row, import blocked, nothing written
  const bad = xlsx([
    ["Brand name", "Generic / salt", "Strength", "Form", "Manufacturer", "MRP", "GST %", "Batch", "Expiry", "Opening qty", "Cost per pack (excl. GST)"],
    [`Bad Okacet ${run}`, "Cetirizine", "10 mg", "Tablet", "Cipla", 18.5, 12, `OK${run}`, "11/2031", 20, 12],
    [`Bad Crocin ${run}`, "Paracetamol", "650 mg", "Pill", "GSK", 30, 7, `CR${run}`, "11/2031", 10, 20],
    [`Bad Expired ${run}`, "Ibuprofen", "400 mg", "Tablet", "Abbott", 25, 12, `EX${run}`, "01/2020", 10, 15],
    [`Bad Costly ${run}`, "Pantoprazole", "40 mg", "Tablet", "Sun", 50, 12, `CO${run}`, "11/2031", "ten", 60],
  ]);
  await page.goto("/app/inventory");
  await page.getByRole("button", { name: "Import", exact: true }).first().click();
  let dlg = await chooseImportFile(page, { name: "stock.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bad) });
  await expect(dlg.getByText("with problems")).toBeVisible();
  await expect(dlg.getByText(/Nothing is imported until every row is fine/)).toBeVisible();
  await expect(rowOf(dlg, `Bad Crocin ${run}`)).toContainText("Form “Pill” isn’t one of");
  await expect(rowOf(dlg, `Bad Crocin ${run}`)).toContainText("GST “7” should be 0, 5, 12, 18 or 28.");
  await expect(rowOf(dlg, `Bad Expired ${run}`)).toContainText(/expired \(01\/2020\)/);
  await expect(rowOf(dlg, `Bad Costly ${run}`)).toContainText("Quantity “ten” must be a whole number of packs.");
  await expect(rowOf(dlg, `Bad Costly ${run}`)).toContainText("Cost is above MRP.");
  await expect(dlg.getByRole("button", { name: "Fix the problems to import" })).toBeDisabled();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  expect(await db().medicine.count({ where: { tenantId: t.id, name: { startsWith: "Bad " } } })).toBe(0);

  // ── The CSV fixture: three medicines, three opening batches
  const csv = readFileSync(path.join(__dirname, "fixtures", "medicines.csv"), "utf8").replaceAll("{{RUN}}", run);
  await page.getByRole("button", { name: "Import", exact: true }).first().click();
  dlg = await chooseImportFile(page, { name: "medicines.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(dlg.getByText("columns found: 17 of 17")).toBeVisible();
  await expect(rowOf(dlg, `Imp Calpol ${run}`).first()).toBeVisible();
  await dlg.getByRole("button", { name: "Import 4 rows" }).click();
  await expect(dlg.getByText("Import finished")).toBeVisible();
  await expect(dlg.getByText(/3 created · 3 batches added · 0 skipped/)).toBeVisible();
  await dlg.getByRole("button", { name: "Done" }).click();

  // Stock is sellable at this branch.
  await page.getByLabel("Search inventory").fill(`Imp Calpol ${run}`);
  const row = rowOf(page, `Imp Calpol ${run}`);
  await expect(row).toBeVisible();
  await expect(row.locator("td").nth(2)).toHaveText("65");
  await row.click();
  const drawer = page.getByRole("dialog", { name: `Imp Calpol ${run}` });
  await expect(drawer.getByText(`CP${run}A`, { exact: true })).toBeVisible();
  await expect(drawer.getByText(`CP${run}B`, { exact: true })).toBeVisible();

  // Running the same file again is safe: everything is already on file.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Import", exact: true }).first().click();
  dlg = await chooseImportFile(page, { name: "medicines.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(dlg.getByRole("button", { name: "Nothing new to import" })).toBeDisabled();
  expect(await db().batch.count({ where: { tenantId: t.id, batchNo: { startsWith: `CP${run}` } } })).toBe(2);
});
