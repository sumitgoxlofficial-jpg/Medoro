import { test, expect } from "@playwright/test";
import { answerDialogs, db, expectToast, importMedicines, monthsAhead, quickSale, rowOf, switchBranch, tenant, uid } from "./helpers";

/** Spec 4 · inventory: receive, quarantine/release, expiry, stock count, inter-branch transfer. */
test.describe("inventory", () => {
  test("add a medicine, receive a batch, quarantine and release it", async ({ page }) => {
    const name = `Inv Pan ${uid()}`;
    answerDialogs(page, "Damaged strips, supplier advisory");
    await page.goto("/app/inventory");
    await page.getByRole("button", { name: "Add medicine" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Brand name *").fill(name);
    await dlg.getByLabel("Generic / salt *").fill("Pantoprazole");
    await dlg.getByLabel("Strength *").fill("40 mg");
    await dlg.getByLabel("Manufacturer *").fill("Alkem");
    await dlg.getByLabel("MRP per pack ₹ *").fill("abc");
    await dlg.getByRole("button", { name: "Save medicine" }).click();
    await expect(dlg.getByText("Enter a valid MRP.")).toBeVisible();
    await dlg.getByLabel("MRP per pack ₹ *").fill("145.50");
    await dlg.getByRole("button", { name: "Save medicine" }).click();
    await expectToast(page, "Medicine added. Receive a batch to make it sellable.");

    const drawer = page.getByRole("dialog", { name });
    await expect(drawer.getByText("No batches at this branch yet.")).toBeVisible();
    const batch = `PN${uid()}`;
    await drawer.getByLabel("Batch number").fill(batch);
    await drawer.getByLabel("Expiry month").fill(monthsAhead(30).iso);
    await drawer.getByLabel("Quantity").fill("30");
    await drawer.getByLabel("Cost per pack").fill("98.40");
    await expect(drawer.getByLabel("MRP per pack")).toHaveValue("145.50");
    await drawer.getByRole("button", { name: "Add opening stock" }).click();
    await expectToast(page, `Batch ${batch} received: 30 units.`);
    const line = drawer.locator("div.grid").filter({ hasText: batch }).first();
    await expect(line.getByText("Sellable", { exact: true })).toBeVisible();
    await expect(drawer.getByText(/Sellable · reorder/).locator("..")).toContainText("30 · 10");

    await line.getByRole("button", { name: "Quarantine" }).click();
    await expectToast(page, "Batch quarantined. It is blocked from sale.");
    await expect(line.getByText("Quarantined")).toBeVisible();
    await expect(line).toContainText("Damaged strips");
    await expect(drawer.getByText(/Sellable · reorder/).locator("..")).toContainText("0 · 10");

    await line.getByRole("button", { name: "Release" }).click();
    await expectToast(page, "Batch released for sale.");
    await expect(line.getByText("Sellable", { exact: true })).toBeVisible();
    await expect(drawer.getByText("No movements yet.")).toHaveCount(0);
  });

  test("near-expiry batches show on the expiry page; a stock count posts the variance", async ({ page }) => {
    const run = uid(), name = `Inv Expiro ${run}`, near = `NE${run}`, far = `FA${run}`;
    await importMedicines(page, [
      { name, mrp: 60, batch: near, expiry: monthsAhead(2).slash, qty: 12, cost: 40 },
      { name, mrp: 60, batch: far, expiry: monthsAhead(24).slash, qty: 30, cost: 40 },
    ]);

    await page.goto("/app/expiry?w=90");
    const r = rowOf(page, near);
    await expect(r).toContainText(name);
    await expect(r).toContainText(/\d+ days/);
    await expect(r).toContainText("12");
    await expect(rowOf(page, far)).toHaveCount(0);

    await page.goto("/app/count");
    await page.getByPlaceholder("Filter by name, batch or rack").fill(name);
    await page.getByLabel(`Counted ${name} ${far}`).fill("27");
    await expect(rowOf(page, far)).toContainText("-3");
    await page.getByRole("button", { name: "Post adjustments" }).click();
    await expectToast(page, /^SC-[\d-]+ posted\. 1 batch adjustment recorded in the ledger\.$/);
    await expect(page.getByText("Recent counts")).toBeVisible();
    const b = await db().batch.findFirstOrThrow({ where: { batchNo: far } });
    expect(b.qtyAvailable).toBe(27);
  });

  test("transfer between branches: request from expiry, approve, receive", async ({ page }) => {
    const run = uid(), name = `Inv Moxi ${run}`, mainBatch = `TM${run}`, kotBatch = `TK${run}`;
    const [main, kothrud] = ["Main branch", "Kothrud"];
    answerDialogs(page, "3");

    // Main holds a near-expiry batch that doesn't sell there; Kothrud sells the same medicine.
    await importMedicines(page, [{ name, mrp: 80, batch: mainBatch, expiry: monthsAhead(2).slash, qty: 10, cost: 50 }]);
    await switchBranch(page, kothrud);
    await importMedicines(page, [{ name, mrp: 80, batch: kotBatch, expiry: monthsAhead(20).slash, qty: 5, cost: 50 }]);
    await quickSale(page, name);
    await page.getByRole("button", { name: "New sale" }).click();
    await switchBranch(page, main);

    await page.goto("/app/expiry?w=90");
    const r = rowOf(page, mainBatch);
    await expect(r).toContainText(`${kothrud} sells`);
    await r.getByRole("button", { name: "Transfer" }).click();
    await expectToast(page, /requested\. Approve it in Users & branches\./);

    await page.goto("/app/users?tab=branches");
    const tr = page.locator("div.grid").filter({ hasText: `${main} → ${kothrud}` }).filter({ hasText: name });
    await expect(tr.getByText("Pending approval")).toBeVisible();
    await tr.getByRole("button", { name: "Approve" }).click();
    await expectToast(page, "Approved. Stock is in transit.");
    await expect(tr.getByText("In transit")).toBeVisible();
    await tr.getByRole("button", { name: "Mark received" }).click();
    await expect(tr.getByText("Received", { exact: true })).toBeVisible();

    const t = await tenant();
    const kot = await db().branch.findFirstOrThrow({ where: { tenantId: t.id, name: kothrud } });
    const moved = await db().batch.findFirstOrThrow({ where: { branchId: kot.id, batchNo: mainBatch } });
    expect(moved.qtyAvailable).toBe(3);
    const left = await db().batch.findFirstOrThrow({ where: { branchId: { not: kot.id }, batchNo: mainBatch } });
    expect(left.qtyAvailable).toBe(7);
  });
});
