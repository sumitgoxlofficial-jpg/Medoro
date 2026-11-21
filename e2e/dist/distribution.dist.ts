import { expect, test, type Page } from "@playwright/test";
import { db, monthsAhead, totp, uid } from "../helpers";

/**
 * MEDORO Distribution, end to end through the UI: distributor sign-up → owner sign-in with TOTP → masters → GRN →
 * order → approval with stock reservation → mobile picking → packing → GST invoice → dispatch → proof of delivery
 * with collection → credit note; then the chemist portal: register → connect → distributor approves → order.
 * Runs on its own (project "dist"); it creates its own tenant, so it doesn't need the pharmacy setup project.
 */
test.describe.configure({ mode: "serial" });

const U = uid();
const D = { name: `Shah Pharma Distributors ${U}`, code: `SHAH-${U.slice(0, 4)}`, email: `owner-${U.toLowerCase()}@dist-e2e.in`, phone: `98${String(Math.floor(1e7 + Math.random() * 8e7))}`, password: "Distributor-42!pass" };
const CHEM = { name: `Sai Medical ${U}`, email: `chem-${U.toLowerCase()}@portal-e2e.in`, phone: `97${String(Math.floor(1e7 + Math.random() * 8e7))}`, password: "Chemist-42!pass" };
let secret = "";

async function act(page: Page, button: string | RegExp, ok: string | RegExp) {
  await page.getByRole("button", { name: button }).first().click();
  await expect(page.getByText(ok).first()).toBeVisible({ timeout: 20_000 });
}

test.beforeAll(async () => {
  // Sign-up and registration are rate-limited per network; earlier runs from this machine must not count.
  await db().loginAttempt.deleteMany({ where: { OR: [{ key: { startsWith: "rl:dist-signup:" } }, { key: { startsWith: "rl:portal-register:" } }] } });
});

test("distributor signs up and the owner enrols two-step verification", async ({ page }) => {
  await page.goto("/distributor-signup");
  // The same steps as pharmacy sign-up: business, owner account, godowns, backups.
  await expect(page.getByRole("heading", { name: "Create your distributor account" })).toBeVisible();
  await page.getByLabel("Business name", { exact: true }).fill(D.name);
  await page.getByLabel("GSTIN", { exact: true }).fill("27AAKFS3192P1Z6");
  await page.getByLabel("Wholesale drug licence", { exact: true }).fill("MH-PZ-20B-55501");
  await page.getByLabel("Address", { exact: true }).fill("Plot 7, Market Yard, Pune");
  await page.getByLabel("Business code", { exact: true }).fill(D.code);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Rajesh Shah");
  await page.getByLabel("Email", { exact: true }).fill(D.email);
  await page.getByLabel("Mobile number", { exact: true }).fill(D.phone);
  await page.getByLabel("Password", { exact: true }).fill(D.password);
  await page.getByLabel("Confirm password", { exact: true }).fill(D.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("New godown", { exact: true }).fill("Bhosari");
  await page.getByRole("button", { name: "Add godown" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download & print" }).click();
  await download;
  await page.getByLabel(/stored the recovery kit/).check();
  await page.getByRole("button", { name: "Create my distributor account" }).click();
  await expect(page.getByText("Your 7-day free trial has started")).toBeVisible({ timeout: 30_000 });
  const t = await db().tenant.findUniqueOrThrow({ where: { code: D.code }, include: { branches: true } });
  expect(t.product).toBe("distribution");
  expect(t.branches.map((b) => b.name).sort()).toEqual(["Bhosari", "Main godown"]);

  // Signed in by sign-up, like a new pharmacy owner: straight on to two-step verification.
  await page.getByRole("button", { name: "Set up two-step verification" }).click();
  await expect(page).toHaveURL(/\/signin\/mfa/);
  secret = (await page.locator("code").first().innerText()).replace(/\s+/g, "");
  await page.getByLabel("6-digit code", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  const save = page.getByText("Save your recovery codes");
  await expect(save).toBeVisible();
  await page.getByLabel("I’ve saved these codes", { exact: true }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  // The pharmacy app hands a distribution tenant over to the distribution ERP.
  await expect(page).toHaveURL(/\/dist$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Distributor dashboard" })).toBeVisible();
  await page.context().storageState({ path: "e2e/.auth/dist-owner.json" });
});

test.describe("as the distributor owner", () => {
  test.use({ storageState: "e2e/.auth/dist-owner.json" });

  test("masters, purchase GRN, order to delivery, collection and credit note", async ({ page }) => {
    page.on("dialog", (d) => void (d.type() === "prompt" ? d.accept("Customer asked to cancel") : d.accept()));
    // Company
    await page.goto("/dist/companies");
    await page.locator("summary", { hasText: "Add company" }).click();
    await page.getByLabel("Company name", { exact: true }).fill(`Cipla Ltd ${U}`);
    await act(page, "Save company", "Company saved.");
    // Supplier
    await page.locator("summary", { hasText: "Add supplier" }).click();
    await page.getByLabel("Supplier name", { exact: true }).fill(`Cipla C&F ${U}`);
    await act(page, "Save supplier", "Supplier saved.");
    // Product
    await page.goto("/dist/products");
    await page.locator("summary", { hasText: "Add product" }).click();
    await page.getByLabel("Product name", { exact: true }).fill("Azee 500");
    await page.getByLabel("Form", { exact: true }).fill("Tablet");
    await page.getByLabel("Pack", { exact: true }).fill("3 tabs");
    await page.getByLabel("Company", { exact: true }).selectOption({ label: `Cipla Ltd ${U}` });
    await page.getByLabel("MRP ₹ (incl. GST)", { exact: true }).fill("120");
    await page.getByLabel("PTR ₹ (ex-GST)", { exact: true }).fill("80");
    await act(page, "Add product", "Product saved.");
    await expect(page.getByRole("cell", { name: /Azee 500/ })).toBeVisible();
    // Chemist
    await page.goto("/dist/chemists");
    await page.locator("summary", { hasText: "Add chemist" }).click();
    await page.getByLabel("Firm name", { exact: true }).fill(`Kothrud Medicals ${U}`);
    await page.getByLabel("Drug licence (Form 20B)", { exact: true }).fill("MH-PZ-20B-77001");
    await page.getByLabel("Drug licence (Form 21B)", { exact: true }).fill("MH-PZ-21B-77001");
    await page.getByLabel("Licence valid until", { exact: true }).fill("2030-03-31");
    await page.getByLabel("Credit limit ₹", { exact: true }).fill("50000");
    await act(page, "Add chemist", "Chemist saved.");
    // GRN: stock arrives batch-wise and the supplier ledger is credited.
    await page.goto("/dist/purchases?tab=grn");
    await page.getByLabel("Supplier", { exact: true }).selectOption({ label: `Cipla C&F ${U}` });
    await page.getByLabel("Supplier invoice no.", { exact: true }).fill(`CIP-${U}`);
    await page.getByLabel("Product", { exact: true }).selectOption({ label: "Azee 500 · 3 tabs" });
    await page.getByLabel("Batch", { exact: true }).fill("AZ2401");
    await page.getByLabel("Expiry", { exact: true }).fill("2028-06");
    await page.getByLabel("Qty", { exact: true }).fill("100");
    await page.getByLabel("Rate ₹", { exact: true }).fill("70");
    await page.getByLabel("Printed total ₹", { exact: true }).fill("7840");
    await act(page, "Post GRN", /GRN GRN-\d{4}-\d+ posted/);

    // Order → approve → pick → pack → invoice
    await page.goto("/dist/orders/new");
    await page.getByLabel("Chemist", { exact: true }).selectOption({ label: `Kothrud Medicals ${U}` });
    await page.getByPlaceholder("Type 2+ letters, ↑ ↓ Enter").fill("Azee");
    await page.getByRole("option", { name: /Azee 500/ }).click();
    await page.locator("tbody input[type=number]").first().fill("12");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page).toHaveURL(/\/dist\/orders\/[0-9a-f-]+$/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Approve & reserve stock" }).click();
    await expect(page.getByText(/Pick list PK-/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "Open in warehouse app →" }).click();
    await page.getByRole("button", { name: "Picked all" }).first().click();
    await expect(page.getByRole("button", { name: "Picked ✓" })).toBeVisible();
    await page.getByRole("button", { name: "Packed — ready to invoice" }).click();
    await expect(page.getByText(/This pick list is/)).toBeVisible({ timeout: 20_000 });
    const order = await db().distOrder.findFirstOrThrow({ where: { customerId: (await db().customer.findFirstOrThrow({ where: { name: `Kothrud Medicals ${U}` } })).id } });
    await page.goto(`/dist/orders/${order.id}`);
    await page.getByRole("button", { name: "Raise invoice" }).click();
    await expect(page).toHaveURL(/\/dist\/invoices\//, { timeout: 20_000 });
    await expect(page.getByText("TAX INVOICE")).toBeVisible();
    // 12 × ₹80 = ₹960 + 12% GST = ₹1075.20 → ₹1075
    await expect(page.getByText("₹1,075.00").first()).toBeVisible();

    // Dispatch → deliver with ₹500 cash at the door
    await page.goto("/dist/dispatch");
    await page.locator("input[name=invoiceIds]").first().check();
    await page.getByLabel("Vehicle no.", { exact: true }).fill("MH12AB1234");
    await act(page, "Plan trip", /Dispatch DSP-/);
    await page.getByRole("button", { name: "Van left" }).first().click();
    await expect(page.getByText("out").first()).toBeVisible();
    await page.goto("/dist/deliveries");
    await page.getByText("Record delivery").first().click();
    await page.getByLabel("Received by", { exact: true }).fill("Mr. Patil");
    await page.getByLabel("Collected ₹", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText("Received by Mr. Patil · collected ₹500.00")).toBeVisible({ timeout: 20_000 });
    const cust = await db().customer.findFirstOrThrow({ where: { name: `Kothrud Medicals ${U}` } });
    expect((await db().distOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("delivered");

    // Credit control shows the remaining ₹575
    await page.goto(`/dist/chemists/${cust.id}`);
    await expect(page.getByText("₹575.00").first()).toBeVisible();

    // Credit note for 2 packs back to stock
    const inv = await db().distInvoice.findFirstOrThrow({ where: { customerId: cust.id } });
    await page.goto(`/dist/invoices/${inv.id}`);
    await page.locator("tbody input[type=number]").first().fill("2");
    await page.getByPlaceholder("Reason (printed on the credit note)").fill("Excess supplied");
    await page.getByRole("button", { name: /Issue credit note/ }).click();
    await expect(page.getByText(/Credit note C.+ issued/)).toBeVisible({ timeout: 20_000 });

    // Reports and GST render with data
    await page.goto("/dist/reports?id=sales-product");
    await expect(page.getByRole("cell", { name: "Azee 500" })).toBeVisible();
    await page.goto("/dist/gst");
    await expect(page.getByText("HSN summary (Table 12)")).toBeVisible();
    await page.goto("/dist/insights");
    await page.getByRole("button", { name: "Who owes us money?" }).click();
    await expect(page.getByText(/outstanding from 1 chemists/)).toBeVisible({ timeout: 20_000 });
  });
});

test("chemist registers on the portal, distributor approves, chemist orders", async ({ browser }) => {
  const chem = await browser.newContext();
  const p = await chem.newPage();
  await p.goto("/portal/register");
  await p.getByLabel("Pharmacy name", { exact: true }).fill(CHEM.name);
  await p.getByLabel("Owner / pharmacist", { exact: true }).fill("Sai Kulkarni");
  await p.getByLabel("Email", { exact: true }).fill(CHEM.email);
  await p.getByLabel("Mobile", { exact: true }).fill(CHEM.phone);
  await p.getByLabel("Drug licence (Form 20B)", { exact: true }).fill("MH-PZ-20B-88001");
  await p.getByLabel("Drug licence (Form 21B)", { exact: true }).fill("MH-PZ-21B-88001");
  await p.getByLabel("Licence valid until", { exact: true }).fill("2030-12-31");
  await p.getByLabel("Shop address", { exact: true }).fill("Shop 3, Karve Road, Pune");
  await p.getByLabel("PIN code", { exact: true }).fill("411004");
  await p.getByLabel("State", { exact: true }).selectOption("27");
  await p.getByLabel(/Password/).fill(CHEM.password);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Create account" }).click();
  await expect(p).toHaveURL(/\/portal$/, { timeout: 20_000 });
  await p.getByPlaceholder("Name, area or distributor code").fill(D.code);
  await p.getByRole("button", { name: "Search" }).click();
  await p.getByRole("checkbox").first().check();
  await p.getByRole("button", { name: "Ask to connect" }).click();
  await expect(p.getByText("Waiting for approval")).toBeVisible({ timeout: 20_000 });

  // Distributor approves
  const own = await browser.newContext({ storageState: "e2e/.auth/dist-owner.json" });
  const o = await own.newPage();
  await o.goto("/dist/portal-admin");
  await o.getByRole("button", { name: "Approve" }).first().click();
  await expect(o.getByRole("cell", { name: "approved", exact: true })).toBeVisible({ timeout: 20_000 });

  // Chemist orders; stock is shown as a band, never as exact packs (default setting)
  await p.goto(`/portal/${D.code}`);
  await expect(p.getByText("In stock").first()).toBeVisible();
  await p.getByRole("button", { name: "More" }).first().click();
  await p.getByRole("button", { name: "More" }).first().click();
  await p.getByRole("button", { name: "Place order" }).click();
  await expect(p).toHaveURL(/\/orders$/, { timeout: 20_000 });
  await expect(p.getByText("Awaiting approval")).toBeVisible();
  const ord = await db().distOrder.findFirstOrThrow({ where: { source: "portal" }, orderBy: { placedAt: "desc" } });
  expect(ord.placedByType).toBe("chemist");

  // The distributor sees it in the approval queue
  await o.goto("/dist/orders?status=pending");
  await expect(o.getByRole("cell", { name: CHEM.name })).toBeVisible();
  await chem.close(); await own.close();
});

// Phase D4 (docs/DIST_DRIVE_PLAN.md): the same distributor on its own device database, as one whose records live in its Drive.
test.describe("on its own device (Drive mode)", () => {
  test.use({ storageState: "e2e/.auth/dist-owner.json" });

  test("masters, a wholesale bill with a scheme, and a collection, all on the device", async ({ page }) => {
    const t = await db().tenant.findUniqueOrThrow({ where: { code: D.code }, select: { id: true, settings: true } });
    await db().tenant.update({ where: { id: t.id }, data: { settings: { ...(t.settings as object), driveMode: true } } });
    const tab = (k: string) => page.goto(`/dist/device?tab=${k}`);
    const toast = (s: string | RegExp) => expect(page.getByText(s).first()).toBeVisible({ timeout: 20_000 });
    await tab("wholesale");
    await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
    await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible({ timeout: 30_000 });

    // A new product with wholesale terms, made on the device.
    const prod = `Pantocid 40 ${U}`;
    await tab("products");
    await page.getByPlaceholder("Company name").fill(`Sun Pharma ${U}`);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await toast("Company added.");
    await page.getByPlaceholder("Name", { exact: true }).fill(prod);
    await page.getByPlaceholder("MRP (₹)").fill("150");
    await page.getByPlaceholder("Units per pack").fill("15");
    await page.getByRole("button", { name: "Add product" }).click();
    await toast("Product added. Set its wholesale terms.");
    await page.getByPlaceholder("Search products").fill(prod);
    await page.getByRole("button", { name: new RegExp(prod) }).click();
    await page.getByLabel("PTR (₹)").fill("100");
    await page.getByLabel("Company", { exact: true }).selectOption({ label: `Sun Pharma ${U}` });
    await page.getByRole("button", { name: "Save terms" }).click();
    await toast("Terms saved.");
    // 10+1 on it.
    await page.getByPlaceholder("Code").fill(`P${U.slice(0, 5)}`);
    await page.getByLabel("For", { exact: true }).selectOption({ label: prod });
    await page.getByPlaceholder("Buy").fill("10");
    await page.getByPlaceholder("Free").fill("1");
    await page.getByRole("button", { name: "Save scheme" }).click();
    await toast("Scheme saved.");

    // Stock in through the shared Purchases screen.
    await tab("purchases");
    await page.getByText("Type the bill", { exact: true }).click();
    await page.getByLabel("New supplier").fill(`Sun Depot ${U}`);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Bill number").fill(`SB-${U}`);
    await page.getByLabel("Add item").fill(prod);
    await page.getByRole("button", { name: new RegExp(prod) }).click();
    await page.getByLabel("Batch", { exact: true }).fill(`PB${U.slice(0, 5)}`);
    await page.getByLabel("Expiry", { exact: true }).fill(monthsAhead(24).iso);
    await page.getByLabel("Packs", { exact: true }).fill("50");
    await page.getByLabel("Rate", { exact: true }).fill("80");
    await page.getByRole("button", { name: "Save bill and add stock" }).click();
    await toast(/entered: 1 item\(s\)/);

    // A chemist with a wholesale profile.
    const firm = `Om Medicals ${U}`;
    await tab("chemists");
    await page.getByLabel("Firm name").fill(firm);
    await page.getByLabel("Mobile").fill("98" + String(Date.now()).slice(-8));
    await page.getByLabel("Credit limit (₹)").fill("50000");
    await page.getByLabel("State code").fill("27");
    await page.getByLabel("Drug licence 20B").fill("MH-PZ-20B-77001");
    await page.getByLabel("Licence valid till").fill("2030-03-31");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await toast("Chemist saved.");

    // Wholesale bill: 20 packs at ₹100 + 12% GST = ₹2,240, with 2 free by the scheme.
    await tab("wholesale");
    await page.getByLabel("Chemist", { exact: true }).fill(firm);
    await page.getByRole("button", { name: new RegExp(firm) }).click();
    await page.getByLabel("Product", { exact: true }).fill(prod);
    await page.getByRole("button", { name: new RegExp(prod) }).click();
    await page.getByLabel(`Packs of ${prod}`).fill("20");
    await expect(page.getByText(/\+ 2 free/)).toBeVisible();
    await expect(page.getByText("₹2,240.00").first()).toBeVisible();
    await page.getByRole("button", { name: "Save invoice" }).click();
    await toast(/Invoice .* saved: ₹2,240\.00\./);
    await expect(page.getByRole("dialog")).toContainText(prod);
    await page.keyboard.press("Escape");

    // Collect part of it; the chemist then owes ₹1,240.
    await tab("receivables");
    await page.getByLabel("Chemist", { exact: true }).fill(firm);
    await page.getByRole("button", { name: new RegExp(firm) }).click();
    await page.getByPlaceholder("Amount (₹)").fill("1000");
    await page.getByRole("button", { name: "Record payment" }).click();
    await toast(/now owes ₹1,240\.00/);

    // The distribution menu opens these device screens when the records live in Drive.
    await db().tenant.update({ where: { id: t.id }, data: { settings: { ...(t.settings as object), driveMode: true, driveOnly: true } } });
    await page.goto("/dist");
    await expect(page).toHaveURL(/\/dist\/device\?tab=wholesale/);
    await expect(page.getByRole("link", { name: "Receivables" }).first()).toHaveAttribute("href", "/dist/device?tab=receivables");
    await db().tenant.update({ where: { id: t.id }, data: { settings: t.settings ?? {} } });
  });
});
