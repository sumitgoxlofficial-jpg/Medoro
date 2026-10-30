import { test, expect } from "@playwright/test";
import { OWNER_STATE, addToCart, anonContext, createStaff, employeeLogin, state, answerDialogs, completeSale, db, expectToast, importMedicines, monthsAhead, newSale, uid } from "./helpers";

/** Spec 6 · POS billing. */
test.describe("POS", () => {
  const run = uid();
  const otc = `Pos Dolo ${run}`, rx = `Pos Augmentin ${run}`, early = `DE${run}`, late = `DL${run}`, barcode = `89${Date.now().toString().slice(-11)}`;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: OWNER_STATE });
    const page = await ctx.newPage();
    await importMedicines(page, [
      { name: otc, generic: "Paracetamol", strength: "650 mg", mrp: 60, batch: late, expiry: monthsAhead(20).slash, qty: 50, cost: 40, barcode },
      { name: otc, generic: "Paracetamol", strength: "650 mg", mrp: 60, batch: early, expiry: monthsAhead(8).slash, qty: 50, cost: 40 },
      { name: rx, generic: "Amoxicillin + Clavulanic acid", strength: "625 mg", mrp: 223.5, schedule: "H", batch: `AU${run}`, expiry: monthsAhead(14).slash, qty: 20, cost: 160 },
    ]);
    await ctx.close();
  });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => { window.print = () => {}; });
  });

  test("FEFO batch, Rx prescriber rule, discount cap, split payment, thermal and A4 invoices", async ({ page }) => {
    await page.goto("/app/pos");
    await addToCart(page, otc);
    const sel = page.getByLabel(`Batch for ${otc}`);
    await expect(sel.locator("option:checked")).toContainText(early); // earliest expiry first, though imported second
    await addToCart(page, rx);
    await expect(page.getByText("Schedule H/H1: prescription required")).toBeVisible();

    await page.getByRole("button", { name: /^Complete sale/ }).click();
    await expectToast(page, "Enter prescriber name for Schedule H/H1 items.");
    // The prescriber is a doctor picker; a typed name still works.
    await page.getByLabel("Prescriber", { exact: true }).fill("Dr. S. Deshmukh");
    await page.getByLabel("Prescription number").fill("RX-4471");

    await page.getByLabel("Discount percent").fill("25");
    await page.getByRole("button", { name: /^Complete sale/ }).click();
    await expectToast(page, "Discount above 20% needs manager approval.");
    await page.getByLabel("Discount percent").fill("10");

    await page.getByRole("button", { name: "Split", exact: true }).click();
    await page.getByLabel("Cash part").fill("500");
    await page.getByRole("button", { name: /^Complete sale/ }).click();
    await expectToast(page, "Enter a cash part between ₹1 and the total.");
    await page.getByLabel("Cash part").fill("100");
    const invoice = await completeSale(page);
    expect(invoice).toMatch(/\d/);
    const modal = page.getByRole("dialog");
    await expect(modal.getByText(/^CASH ₹100\.00 \+ UPI ₹/)).toBeVisible();
    await expect(modal.getByText("Dr. S. Deshmukh")).toBeVisible();

    const sale = await db().sale.findFirstOrThrow({ where: { invoiceNo: invoice }, include: { items: true, payments: true } });
    expect(sale.payments.map((p) => p.mode).sort()).toEqual(["cash", "upi"]);
    const batches = await db().batch.findMany({ where: { id: { in: sale.items.map((i) => i.batchId) } } });
    expect(batches.map((b) => b.batchNo)).toContain(early);
    expect(batches.map((b) => b.batchNo)).not.toContain(late);
    expect(Number(sale.discountPct)).toBe(10);

    for (const [button, marker] of [["Thermal 80mm", "TAX INVOICE"], ["A4 / PDF", "Bill to:"]] as const) {
      const [popup] = await Promise.all([page.waitForEvent("popup"), modal.getByRole("button", { name: button }).click()]);
      await popup.waitForLoadState();
      expect(popup.url()).toContain(`/print/invoice/${sale.id}?format=${button.startsWith("A4") ? "a4" : "thermal"}`);
      await expect(popup.getByText(marker)).toBeVisible();
      await expect(popup.getByText(invoice).first()).toBeVisible();
      await expect(popup.getByText(/Deshmukh/).first()).toBeVisible();
      await expect(popup.getByText(early).first()).toBeVisible();
      await popup.close();
    }
  });

  test("credit sale within the customer's limit; over the limit is refused", async ({ page }) => {
    const name = `Credit Customer ${run}`;
    await page.goto("/app/pos");
    await page.getByRole("button", { name: "New", exact: true }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name *").fill(name);
    await dlg.getByLabel("Credit limit ₹").fill("100");
    await dlg.getByRole("button", { name: "Save customer" }).click();
    await expect(page.locator("#pos-cust")).toHaveValue(/.+/);
    await expect(page.getByText("Outstanding ₹0 · limit ₹100")).toBeVisible();

    await addToCart(page, otc);
    await page.getByRole("button", { name: "Increase" }).click();
    await page.getByRole("button", { name: "Credit", exact: true }).click();
    await page.getByRole("button", { name: /^Complete sale/ }).click();
    await expectToast(page, `Exceeds ${name}'s credit limit (₹100).`);
    await page.getByRole("button", { name: "Decrease" }).click();
    await expect(page.getByText("After this sale: ₹60 of ₹100 limit")).toBeVisible();
    const invoice = await completeSale(page);
    await expect(page.getByRole("dialog").getByText("CREDIT", { exact: true })).toBeVisible();
    await newSale(page);

    // Second bill would take the customer to ₹120 owed.
    await page.locator("#pos-cust").selectOption({ label: name });
    await expect(page.getByText("Outstanding ₹60 · limit ₹100")).toBeVisible();
    await addToCart(page, otc);
    await page.getByRole("button", { name: "Credit", exact: true }).click();
    await page.getByRole("button", { name: /^Complete sale/ }).click();
    await expectToast(page, `Exceeds ${name}'s credit limit (₹100).`);
    const s = await db().sale.findFirstOrThrow({ where: { invoiceNo: invoice } });
    expect(s.payMode).toBe("credit");
  });

  test("hold a cart, recall it; barcode scan adds the item", async ({ page }) => {
    answerDialogs(page);
    await page.goto("/app/pos");
    const search = page.getByLabel("Search medicine");
    await search.fill(barcode);
    await search.press("Enter");
    await expect(page.getByLabel(`Batch for ${otc}`)).toBeVisible();
    await page.getByRole("button", { name: "Hold (F4)" }).click();
    await expectToast(page, "Cart held. Recall it from the bar above the cart.");
    await expect(page.getByText("Scan a barcode or search to start a bill")).toBeVisible();
    const chip = page.getByRole("button", { name: /^Held \d{2}:\d{2} · 1 item · ₹60$/ });
    await expect(chip).toBeVisible();

    // A held cart survives a reload and is recalled intact.
    await page.reload();
    await chip.click();
    await expect(page.getByLabel(`Batch for ${otc}`)).toBeVisible();
    await expect(chip).toHaveCount(0);
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("Scan a barcode or search to start a bill")).toBeVisible();
  });

  test("a discount above the cashier's cap needs a manager's PIN at the counter", async ({ page, browser }) => {
    const approver = await createStaff(browser, page, "Pharmacist", `Approver ${run}`);
    const cashier = await createStaff(browser, page, "Cashier", `Till ${run}`);
    const ctx = await anonContext(browser);
    const p = await ctx.newPage();
    await employeeLogin(p, state().tenantCode, cashier.employeeNo, cashier.pin);
    await expect(p).toHaveURL(/\/app$/);
    await p.goto("/app/pos");
    await addToCart(p, otc);
    await p.getByLabel("Discount percent").fill("60");
    await expect(p.getByText("Discounts above 50% aren’t allowed.")).toBeVisible();
    await p.getByLabel("Discount percent").fill("10");
    await p.getByRole("button", { name: /^Complete sale/ }).click();
    await expectToast(p, "Discount above 5% needs manager approval.");

    await p.getByRole("button", { name: "Get manager approval for 10%" }).click();
    const dlg = p.getByRole("dialog");
    await dlg.getByLabel(/Manager’s employee ID/).fill(approver.employeeNo);
    await dlg.getByLabel("Manager’s PIN or password").fill("1357");
    await dlg.getByRole("button", { name: "Approve" }).click();
    await expect(dlg.getByText(/Wrong ID or PIN\/password, or this person can’t approve discounts\. 4 attempts left\./)).toBeVisible();
    await dlg.getByLabel("Manager’s PIN or password").fill(approver.pin);
    await dlg.getByRole("button", { name: "Approve" }).click();
    await expectToast(p, `Discount approved by ${approver.name}.`);
    await expect(p.getByText(`Approved by ${approver.name} for this cart`)).toBeVisible();

    // Changing the cart voids the approval.
    await p.getByRole("button", { name: "Increase" }).click();
    await expect(p.getByRole("button", { name: "Get manager approval for 10%" })).toBeVisible();
    await p.getByRole("button", { name: "Decrease" }).click();
    await expect(p.getByText(`Approved by ${approver.name} for this cart`)).toBeVisible();

    const invoice = await completeSale(p);
    const sale = await db().sale.findFirstOrThrow({ where: { invoiceNo: invoice } });
    expect(Number(sale.discountPct)).toBe(10);
    expect(await db().discountApproval.count({ where: { approvedBy: (await db().user.findFirstOrThrow({ where: { employeeNo: approver.employeeNo } })).id, usedAt: { not: null } } })).toBe(1);
    await ctx.close();
  });

  test("double-clicking Complete posts the bill once", async ({ page }) => {
    await page.goto("/app/pos");
    const before = await db().sale.count();
    await addToCart(page, otc);
    await page.getByRole("button", { name: /^Complete sale/ }).dblclick();
    await expect(page.getByText("Sale committed")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await db().sale.count()).toBe(before + 1);
  });
});
