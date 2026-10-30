import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { addToCart, completeSale, db, expectToast, monthsAhead, newSale, switchBranch, tenant, toast } from "./helpers";

/**
 * Marketing screenshots (not part of the suite). Seeds a realistic Pune pharmacy through the UI, backdates
 * part of the sales history so the dashboard has two weeks of data, and saves screenshots for the website.
 *   CAPTURE=1 CAPTURE_OUT=/mnt/q/src/medoro-wt/web/design/captures \
 *     bash wsl-e2e.sh web --project=capture
 */
const OUT = process.env.CAPTURE_OUT ?? path.join(__dirname, "..", "test-results", "captures");
test.use({ deviceScaleFactor: 2 });

type Med = { name: string; generic: string; strength: string; form: string; mfr: string; pack: string; mrp: number; gst: number; sch?: string; reorder: number; batches: [string, number, number, number][] };
// batches: [batch no, expiry in months from now, opening qty, cost per pack]
const MEDS: Med[] = [
  { name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", mfr: "Micro Labs", pack: "15 tabs", mrp: 33.6, gst: 12, reorder: 40, batches: [["DL24091", 7, 46, 22.1], ["DL25013", 22, 180, 22.4]] },
  { name: "Pan-D", generic: "Pantoprazole + Domperidone", strength: "40/30 mg", form: "Capsule", mfr: "Alkem", pack: "15 caps", mrp: 236.5, gst: 12, reorder: 20, batches: [["PD5172", 18, 64, 151]] },
  { name: "Azithral 500", generic: "Azithromycin", strength: "500 mg", form: "Tablet", mfr: "Alembic", pack: "5 tabs", mrp: 119.5, gst: 12, sch: "H1", reorder: 15, batches: [["AZ3307", 14, 38, 78]] },
  { name: "Shelcal 500", generic: "Calcium + Vitamin D3", strength: "500 mg", form: "Tablet", mfr: "Torrent", pack: "15 tabs", mrp: 131.2, gst: 12, reorder: 20, batches: [["SC8841", 16, 72, 84]] },
  { name: "Augmentin 625 Duo", generic: "Amoxicillin + Clavulanic acid", strength: "625 mg", form: "Tablet", mfr: "GSK", pack: "10 tabs", mrp: 223.5, gst: 12, sch: "H", reorder: 10, batches: [["AG1290", 11, 26, 161]] },
  { name: "Montair LC", generic: "Montelukast + Levocetirizine", strength: "10/5 mg", form: "Tablet", mfr: "Cipla", pack: "15 tabs", mrp: 287, gst: 12, sch: "H", reorder: 15, batches: [["MLC0921", 13, 41, 189]] },
  { name: "Telma 40", generic: "Telmisartan", strength: "40 mg", form: "Tablet", mfr: "Glenmark", pack: "15 tabs", mrp: 251.6, gst: 12, sch: "H", reorder: 15, batches: [["TM4410", 19, 7, 166]] },
  { name: "Glycomet GP 1", generic: "Metformin + Glimepiride", strength: "500/1 mg", form: "Tablet", mfr: "USV", pack: "15 tabs", mrp: 128.4, gst: 12, sch: "H", reorder: 20, batches: [["GG7731", 15, 58, 82]] },
  { name: "Thyronorm 50", generic: "Thyroxine", strength: "50 mcg", form: "Tablet", mfr: "Abbott", pack: "120 tabs", mrp: 218, gst: 12, sch: "H", reorder: 10, batches: [["TN2205", 20, 4, 141]] },
  { name: "Okacet", generic: "Cetirizine", strength: "10 mg", form: "Tablet", mfr: "Cipla", pack: "10 tabs", mrp: 18.5, gst: 12, reorder: 30, batches: [["OK6612", 24, 140, 11]] },
  { name: "Ascoril LS", generic: "Ambroxol + Levosalbutamol + Guaifenesin", strength: "100 ml", form: "Syrup", mfr: "Glenmark", pack: "100 ml", mrp: 118, gst: 12, reorder: 12, batches: [["AS0450", 2, 9, 77], ["AS0611", 17, 30, 79]] },
  { name: "Volini Gel", generic: "Diclofenac + Methyl salicylate", strength: "30 g", form: "Gel", mfr: "Sun Pharma", pack: "30 g", mrp: 165, gst: 18, reorder: 8, batches: [["VG9921", 21, 24, 104]] },
  { name: "Becosules", generic: "B-complex + Vitamin C", strength: "Multivitamin", form: "Capsule", mfr: "Pfizer", pack: "20 caps", mrp: 52.3, gst: 12, reorder: 25, batches: [["BC1140", 1, 18, 33], ["BC1302", 15, 90, 34]] },
  { name: "Benadryl Cough", generic: "Diphenhydramine", strength: "150 ml", form: "Syrup", mfr: "Johnson & Johnson", pack: "150 ml", mrp: 132, gst: 12, reorder: 10, batches: [["BD7781", 1, 14, 86]] },
  { name: "Liv 52", generic: "Herbal hepatoprotective", strength: "Herbal", form: "Tablet", mfr: "Himalaya", pack: "100 tabs", mrp: 175, gst: 12, reorder: 10, batches: [["LV3021", 2, 11, 112]] },
  { name: "Combiflam", generic: "Ibuprofen + Paracetamol", strength: "400/325 mg", form: "Tablet", mfr: "Sanofi", pack: "20 tabs", mrp: 46.5, gst: 12, reorder: 30, batches: [["CF5530", 3, 22, 29], ["CF6011", 23, 120, 30]] },
  { name: "Electral", generic: "Oral rehydration salts", strength: "21.8 g", form: "Sachet", mfr: "FDC", pack: "1 sachet", mrp: 22, gst: 12, reorder: 50, batches: [["EL2290", 26, 200, 13]] },
  { name: "Rantac 150", generic: "Ranitidine", strength: "150 mg", form: "Tablet", mfr: "J B Chemicals", pack: "30 tabs", mrp: 42.6, gst: 12, reorder: 20, batches: [["RT8812", 12, 75, 26]] },
  { name: "Ecosprin 75", generic: "Aspirin", strength: "75 mg", form: "Tablet", mfr: "USV", pack: "14 tabs", mrp: 5.6, gst: 12, reorder: 40, batches: [["EC1029", 18, 160, 3.2]] },
  { name: "Calpol 500", generic: "Paracetamol", strength: "500 mg", form: "Tablet", mfr: "GSK", pack: "15 tabs", mrp: 16.3, gst: 12, reorder: 30, batches: [["CP4471", 9, 95, 10]] },
];

// [name, mobile, credit limit, opening balance owed, WhatsApp opt-in]
const CUSTOMERS: [string, string, number, number, boolean][] = [
  ["Sunita Deshpande", "9822014587", 0, 0, true], ["Rajesh Patil", "9890245613", 3000, 640, true], ["Mohammed Shaikh", "9763318420", 0, 0, true], ["Kavita Joshi", "9921457806", 0, 0, false],
  ["Anil Kulkarni", "9850163379", 5000, 1280, true], ["Priya Nair", "9545021768", 0, 0, true], ["Harpreet Singh", "9370488125", 2000, 0, false], ["Meena Gaikwad", "9881276504", 0, 0, true],
];

// Each sale: items [medicine, qty], customer index (-1 walk-in), pay mode, days ago.
type Sale = { items: [string, number][]; c: number; pay: "Cash" | "UPI" | "Card" | "Credit"; ago: number; rx?: string };
const SALES: Sale[] = [
  { items: [["Dolo 650", 2], ["Okacet", 1]], c: -1, pay: "Cash", ago: 13 }, { items: [["Telma 40", 1], ["Ecosprin 75", 2]], c: 4, pay: "UPI", ago: 13, rx: "Dr. V. Apte" },
  { items: [["Pan-D", 1], ["Shelcal 500", 1]], c: 0, pay: "UPI", ago: 12 }, { items: [["Combiflam", 1], ["Electral", 4]], c: -1, pay: "Cash", ago: 11 },
  { items: [["Glycomet GP 1", 2]], c: 1, pay: "Card", ago: 11, rx: "Dr. S. Mehta" }, { items: [["Montair LC", 1], ["Ascoril LS", 1]], c: 2, pay: "UPI", ago: 10, rx: "Dr. N. Khan" },
  { items: [["Dolo 650", 3], ["Volini Gel", 1]], c: -1, pay: "Cash", ago: 9 }, { items: [["Thyronorm 50", 1]], c: 3, pay: "UPI", ago: 9, rx: "Dr. A. Rao" },
  { items: [["Augmentin 625 Duo", 1], ["Pan-D", 1]], c: 5, pay: "UPI", ago: 8, rx: "Dr. S. Mehta" }, { items: [["Shelcal 500", 2], ["Becosules", 2]], c: 7, pay: "Cash", ago: 7 },
  { items: [["Azithral 500", 1], ["Dolo 650", 1]], c: 6, pay: "Card", ago: 6, rx: "Dr. P. Kale" }, { items: [["Liv 52", 1], ["Rantac 150", 1]], c: -1, pay: "Cash", ago: 6 },
  { items: [["Telma 40", 1], ["Glycomet GP 1", 1]], c: 4, pay: "UPI", ago: 5, rx: "Dr. V. Apte" }, { items: [["Okacet", 2], ["Calpol 500", 2]], c: -1, pay: "Cash", ago: 4 },
  { items: [["Montair LC", 1]], c: 2, pay: "UPI", ago: 4, rx: "Dr. N. Khan" }, { items: [["Pan-D", 2], ["Electral", 6]], c: 0, pay: "UPI", ago: 3 },
  { items: [["Benadryl Cough", 1], ["Dolo 650", 2]], c: -1, pay: "Cash", ago: 2 }, { items: [["Shelcal 500", 1], ["Volini Gel", 1]], c: 7, pay: "Card", ago: 2 },
  { items: [["Augmentin 625 Duo", 1], ["Combiflam", 1]], c: 1, pay: "Credit", ago: 2, rx: "Dr. S. Mehta" }, { items: [["Becosules", 2], ["Ecosprin 75", 2]], c: -1, pay: "Cash", ago: 3 },
  { items: [["Dolo 650", 2], ["Pan-D", 1], ["Okacet", 1]], c: 5, pay: "UPI", ago: 0 }, { items: [["Glycomet GP 1", 2], ["Telma 40", 1]], c: 4, pay: "Credit", ago: 0, rx: "Dr. V. Apte" },
  { items: [["Montair LC", 1], ["Ascoril LS", 1]], c: 3, pay: "Cash", ago: 0, rx: "Dr. A. Rao" }, { items: [["Shelcal 500", 2]], c: 0, pay: "Card", ago: 0 },
  { items: [["Azithral 500", 1], ["Electral", 3]], c: 6, pay: "UPI", ago: 0, rx: "Dr. P. Kale" }, { items: [["Calpol 500", 2], ["Combiflam", 1]], c: -1, pay: "Cash", ago: 0 },
];

function csv(only?: string[]) {
  const head = ["Brand name", "Generic / salt", "Strength", "Form", "Manufacturer", "Pack", "MRP", "GST %", "Schedule", "HSN", "Barcode", "Reorder level", "Rack", "Batch", "Expiry", "Opening qty", "Cost per pack (excl. GST)"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = MEDS.flatMap((m, i) => (only && !only.includes(m.name) ? [] : m.batches).map(([b, months, qty, cost]) => [
    m.name, m.generic, m.strength, m.form, m.mfr, m.pack, m.mrp.toFixed(2), String(m.gst), m.sch ?? "", "3004",
    `8901${String(4200 + i).padStart(9, "0")}`, String(m.reorder), `R${1 + (i % 6)}-${1 + (i % 4)}`, only ? `${b}K` : b, monthsAhead(months).slash, String(only ? Math.ceil(qty / 3) : qty), cost.toFixed(2),
  ].map(esc).join(",")));
  return [head.join(","), ...rows].join("\n") + "\n";
}

async function importCsv(page: Page, text: string) {
  await page.goto("/app/inventory");
  await page.getByRole("button", { name: "Import", exact: true }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Choose file").setInputFiles({ name: "sanjeevani-stock.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
  await dlg.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await expect(dlg.getByText("Import finished")).toBeVisible({ timeout: 30_000 });
  await dlg.getByRole("button", { name: "Done" }).click();
}

async function sell(page: Page, s: Sale, custId: (i: number) => string) {
  for (const [m, q] of s.items) {
    await addToCart(page, m);
    if (q > 1) await page.getByLabel("Quantity").last().fill(String(q));
  }
  if (s.c >= 0) await page.locator("#pos-cust").selectOption(custId(s.c));
  if (s.rx) await page.getByLabel("Prescriber name").fill(s.rx);
  await page.getByRole("button", { name: s.pay, exact: true }).click();
  if (s.pay === "UPI") await page.getByPlaceholder(/UPI UTR/).fill(`4${Math.floor(Math.random() * 1e11)}`);
  return completeSale(page);
}

// Sales are append-only; the demo history is backdated with triggers off for this one statement.
async function backdate(tenantId: string, invoiceNo: string, ago: number, hour: number) {
  const at = new Date(Date.now() - ago * 86400_000);
  at.setHours(hour, (ago * 17 + hour * 7) % 60);
  const sale = await db().sale.findFirstOrThrow({ where: { tenantId, invoiceNo }, orderBy: { at: "desc" } });
  await db().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.sale.update({ where: { id: sale.id }, data: { at } });
  });
}

async function shot(page: Page, name: string, full = false) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full, animations: "disabled", caret: "hide" });
}

test("capture marketing screenshots", async ({ page, browser }) => {
  test.setTimeout(20 * 60_000);
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { window.print = () => {}; });
  page.on("dialog", (d) => { void d.accept(); });
  const t = await tenant();

  if ((await db().medicine.count({ where: { tenantId: t.id, name: "Dolo 650" } })) === 0) {
    await db().$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.tenant.update({ where: { id: t.id }, data: { name: "Sanjeevani Pharmacy" } });
    });
    await importCsv(page, csv());

    for (const [name, phone, limit, owes, optIn] of CUSTOMERS) {
      await page.goto("/app/parties?tab=cus");
      await page.getByRole("button", { name: "Add customer" }).first().click();
      const c = page.getByRole("dialog");
      await c.getByLabel("Name *").fill(name);
      await c.getByLabel("Mobile").fill(phone);
      if (limit) await c.getByLabel("Credit limit ₹").fill(String(limit));
      if (owes) await c.getByLabel("Opening balance they owe ₹").fill(String(owes));
      if (optIn) await c.getByText(/Customer agrees to receive invoices/).click();
      await c.getByRole("button", { name: "Save customer" }).click();
      await expectToast(page, "Customer added.");
    }
    for (const [name, gstin, owe] of [["Mahavir Pharma Distributors", "27AABCM4471F1Z2", "18450"], ["Shree Ganesh Medical Agencies", "27AAGFS2290K1Z8", "7920"]]) {
      await page.goto("/app/parties");
      await page.getByRole("button", { name: "Add supplier" }).first().click();
      const s = page.getByRole("dialog");
      await s.getByLabel("Name *").fill(name);
      await s.getByRole("textbox", { name: "GSTIN" }).fill(gstin);
      await s.getByLabel("Credit terms (days)").fill("21");
      await s.getByLabel("Opening balance you owe ₹").fill(owe);
      await s.getByRole("button", { name: "Save supplier" }).click();
      await expectToast(page, "Supplier added.");
    }

    // A purchase order for Telma 40, received against the distributor's bill; a second one still open.
    await page.goto("/app/purchases");
    await page.getByRole("button", { name: "New purchase order" }).click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Supplier").selectOption({ label: "Mahavir Pharma Distributors" });
    await dlg.getByLabel("Medicine").selectOption({ label: "Telma 40 40 mg" });
    await dlg.getByLabel("Quantity").fill("30");
    await dlg.getByLabel("Rate").fill("166");
    await dlg.getByRole("button", { name: "Save draft" }).click();
    await expectToast(page, /PO-.* saved as a draft/);
    const po = await db().purchaseOrder.findFirstOrThrow({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" } });
    const row = page.locator("tr").filter({ hasText: po.no });
    await row.getByRole("button", { name: "Place order" }).click();
    await expect(row.getByText("Ordered")).toBeVisible();
    await row.getByRole("button", { name: "Receive" }).click();
    await page.getByLabel("Invoice no.").fill("MPD/2526/4417");
    await page.getByLabel("Batch").fill("TM5520");
    await page.getByLabel("Expiry").fill(monthsAhead(26).iso);
    await page.getByLabel("Total printed on invoice ₹").fill("5577.60");
    await page.getByRole("button", { name: "Approve & post GRN" }).click();
    await expect(page.getByText("GRN posted", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to orders" }).click();
    await page.getByRole("button", { name: "New purchase order" }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Supplier").selectOption({ label: "Shree Ganesh Medical Agencies" });
    await dlg.getByLabel("Medicine").selectOption({ label: "Thyronorm 50 50 mcg" });
    await dlg.getByLabel("Quantity").fill("20");
    await dlg.getByLabel("Rate").fill("141");
    await dlg.getByRole("button", { name: "Save draft" }).click();
    await expectToast(page, /PO-.* saved as a draft/);

    const custs = await db().customer.findMany({ where: { tenantId: t.id }, select: { id: true, name: true } });
    const idOf = (i: number) => custs.find((c) => c.name === CUSTOMERS[i][0])!.id;
    await page.goto("/app/pos");
    for (const [i, s] of SALES.entries()) {
      const no = await sell(page, s, idOf);
      if (s.ago > 0) await backdate(t.id, no, s.ago, 11 + ((i * 3) % 9));
      await newSale(page);
    }

    // The second branch: a little stock and a few bills today.
    await switchBranch(page, "Kothrud");
    await importCsv(page, csv(["Dolo 650", "Pan-D", "Shelcal 500", "Okacet", "Electral", "Combiflam"]));
    await page.goto("/app/pos");
    const kothrud: Sale[] = [
      { items: [["Dolo 650", 2], ["Electral", 2]], c: -1, pay: "Cash", ago: 0 }, { items: [["Pan-D", 1], ["Shelcal 500", 1]], c: -1, pay: "UPI", ago: 0 },
      { items: [["Okacet", 2], ["Combiflam", 1]], c: -1, pay: "Cash", ago: 0 }, { items: [["Shelcal 500", 2]], c: -1, pay: "Card", ago: 0 },
    ];
    for (const s of kothrud) { await sell(page, s, idOf); await newSale(page); }
    await switchBranch(page, "Main branch");
  }

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await shot(page, "dashboard");

  await page.goto("/app/pos");
  await addToCart(page, "Dolo 650");
  await page.getByLabel("Quantity").last().fill("2");
  await addToCart(page, "Pan-D");
  await addToCart(page, "Azithral 500");
  await page.locator("#pos-cust").selectOption({ index: 1 });
  await page.getByLabel("Prescriber name").fill("Dr. S. Mehta");
  await page.getByPlaceholder(/Rx \/ register/).fill("RX-2291");
  await page.getByRole("button", { name: "UPI", exact: true }).click();
  await page.getByLabel("Search medicine").fill("dolo");
  await page.waitForTimeout(600);
  await shot(page, "pos");
  await page.getByLabel("Search medicine").fill("");
  await page.keyboard.press("Escape");

  await page.goto("/app/inventory");
  await shot(page, "inventory");
  await page.goto("/app/expiry");
  await page.getByRole("button", { name: "90 days", exact: true }).click().catch(() => page.getByText("90 days", { exact: true }).click());
  await shot(page, "expiry");
  await page.goto("/app/accounts");
  await shot(page, "accounts");
  await page.goto("/app/purchases");
  const open = page.locator("tr").filter({ hasText: "Shree Ganesh Medical Agencies" });
  await open.getByRole("button", { name: "Place order" }).click();
  await expect(open.getByText("Ordered")).toBeVisible();
  await open.getByRole("button", { name: "Receive" }).click();
  await page.getByLabel("Invoice no.").fill("SGMA/26/1187");
  await page.getByLabel("Batch").fill("TN3310");
  await page.getByLabel("Expiry").fill(monthsAhead(30).iso);
  await page.getByLabel("Total printed on invoice ₹").fill("3158.40");
  await expect(page.getByText(/Totals match/)).toBeVisible();
  await expect(toast(page, "Order placed")).toHaveCount(0, { timeout: 8000 });
  await shot(page, "purchases");
  await page.goto("/app/whatsapp");
  await shot(page, "whatsapp");
  await page.goto("/app/messaging");
  await page.getByText("Refill reminders", { exact: true }).click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, "messaging");
  await page.goto("/app/sync");
  await page.getByLabel(/Name this device/).fill("Counter 1");
  await page.getByRole("button", { name: "Turn on for this device" }).click();
  await expect(toast(page, "Offline billing is ready")).toBeVisible();
  await expect(toast(page, "Offline billing is ready")).toHaveCount(0, { timeout: 8000 });
  await shot(page, "sync");
  await page.goto("/app/backup");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expectToast(page, /Backup verified/);
  await page.reload();
  await shot(page, "backup");
  await page.goto("/app/intelligence");
  await shot(page, "intelligence");

  await page.goto("/app");
  await page.locator("body").click();
  await page.keyboard.press("Control+j");
  const drawer = page.getByRole("complementary", { name: "Medoro AI" });
  await expect(drawer).toBeVisible();
  const ask = drawer.getByLabel("Ask Medoro AI");
  await ask.fill("Aaj ki total sale kitni hai?");
  await ask.press("Enter");
  await page.waitForTimeout(2500);
  await ask.fill("stock of Dolo 650");
  await ask.press("Enter");
  await expect(drawer.getByText("search_medicines").last()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot(page, "ai");
  await page.keyboard.press("Control+j");

  const hi = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const hp = await hi.newPage();
  await hp.goto("/app");
  await hp.getByRole("button", { name: "हि", exact: true }).first().click();
  await expect(hp.getByText("आज की बिक्री").first()).toBeVisible();
  await shot(hp, "dashboard-hi");
  await hp.getByRole("button", { name: "EN", exact: true }).first().click();
  await expect(hp.getByText("Sales today").first()).toBeVisible();
  await hi.close();

  const m = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const mp = await m.newPage();
  await mp.goto("/app");
  await shot(mp, "mobile-dashboard");
  await mp.goto("/app/expiry");
  await shot(mp, "mobile-expiry");
  await m.close();
});

test("landing page screenshots", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const out = process.env.LANDING_OUT ?? path.join(OUT, "landing");
  mkdirSync(out, { recursive: true });
  const anon = { cookies: [], origins: [] };
  for (const [name, width, height, scale] of [["desktop", 1440, 900, 1], ["mobile", 390, 844, 2]] as const) {
    const still = await browser.newContext({ storageState: anon, viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce" });
    const p = await still.newPage();
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.evaluate(() => document.fonts.ready);
    for (let y = 0; y < (await p.evaluate(() => document.body.scrollHeight)); y += height) { await p.mouse.wheel(0, height); await p.waitForTimeout(120); }
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForLoadState("networkidle");
    await p.screenshot({ path: path.join(out, `${name}-full.png`), fullPage: true });
    await p.getByRole("button", { name: "हिंदी" }).click();
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(out, `${name}-hero-hi.png`) });
    expect(errors).toEqual([]);
    await still.close();

    const moving = await browser.newContext({ storageState: anon, viewport: { width, height }, deviceScaleFactor: scale });
    const mp = await moving.newPage();
    await mp.goto("/");
    await mp.evaluate(() => document.fonts.ready);
    await mp.waitForTimeout(1200);
    await mp.screenshot({ path: path.join(out, `${name}-motion-0-hero.png`) });
    for (const [i, y] of [height * 0.5, height * 1.2].entries()) {
      await mp.mouse.wheel(0, y - (i ? height * 0.5 : 0));
      await mp.waitForTimeout(700);
      await mp.screenshot({ path: path.join(out, `${name}-motion-${i + 1}-scroll.png`) });
    }
    for (const id of ["product", "switching", "security", "pricing", "faq"]) {
      await mp.evaluate((s) => document.getElementById(s)?.scrollIntoView({ behavior: "instant" as ScrollBehavior }), id);
      await mp.mouse.wheel(0, 200);
      await mp.waitForTimeout(800);
      await mp.screenshot({ path: path.join(out, `${name}-motion-${id}.png`) });
    }
    await moving.close();
  }
  const og = await browser.newContext({ storageState: anon, viewport: { width: 1440, height: 900 } });
  const op = await og.newPage();
  const img = await op.request.get("/opengraph-image");
  expect(img.status()).toBe(200);
  writeFileSync(path.join(out, "og-image.png"), await img.body());
  for (const route of ["/start", "/legal"]) {
    await op.goto(route);
    await op.evaluate(() => document.fonts.ready);
    await op.screenshot({ path: path.join(out, `desktop${route.replace("/", "-")}.png`) });
  }
  await og.close();
});