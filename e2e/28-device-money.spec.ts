import { test, expect } from "@playwright/test";
import { driveModeOn, importMedicines, monthsAhead, uid } from "./helpers";

const dmy = (daysAhead = 0) => {
  const d = new Date(Date.now() + 330 * 60_000 + daysAhead * 86400_000).toISOString().slice(0, 10).split("-");
  return `${d[2]}/${d[1]}/${d[0]}`;
};
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// UPI & Bank on the counter: a credit bill paid by UPI with the bill's Medoro reference is matched from the bank
// statement by itself; a counter "UPI" bill the statement doesn't show is flagged; nothing claims a live bank link.
test("bank statement upload matches a credit bill and flags a counter UPI payment the bank never got", async ({ page }) => {
  const name = `Bank ${uid()}`;
  await importMedicines(page, [{ name, mrp: 100, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 20, cost: 60 }]);
  await driveModeOn(page);
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  // A credit customer and a ₹300 credit bill.
  await page.getByRole("tab", { name: "Customers" }).click();
  await page.getByRole("button", { name: "Add customer" }).click();
  const cust = `Rahul ${uid()}`;
  await page.getByLabel("Customer name").fill(cust);
  await page.getByLabel("Mobile").fill("9822" + String(Date.now()).slice(-6));
  await page.getByLabel("Credit limit").fill("5000");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("tab", { name: "Billing" }).click();
  await page.getByLabel("Search medicine").fill(name);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name }).click();
  await page.getByLabel("Customer").fill(cust);
  await page.getByRole("button", { name: new RegExp(cust) }).click();
  await page.getByRole("radio", { name: "CREDIT" }).click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByRole("dialog").getByText("TAX INVOICE")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

  // A ₹200 bill marked UPI at the counter that never reaches the bank.
  await page.getByLabel("Search medicine").fill(name);
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name }).click();
  await page.getByRole("radio", { name: "UPI" }).click();
  await page.getByRole("button", { name: /Complete bill/ }).click();
  await expect(page.getByRole("dialog").getByText("TAX INVOICE")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

  // Connections: honest labels, no connect buttons; the shop's own UPI ID for bill QR codes.
  await page.getByRole("tab", { name: "UPI & Bank" }).click();
  await page.getByRole("button", { name: "Connections" }).click();
  await expect(page.getByText("Bank statement upload (any bank)").locator("..")).toContainText("Available");
  await expect(page.getByText("PhonePe Business").locator("..")).toContainText("Partner onboarding required");
  await expect(page.getByText("BharatPe", { exact: true }).locator("..")).toContainText("Not yet supported");
  for (const card of ["Bank connections", "Payment providers"]) await expect(page.getByText(card, { exact: true }).locator("..").getByRole("button")).toHaveCount(0);
  await page.getByLabel("Shop UPI ID").fill("sanjeevani@okhdfcbank");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();

  // The open credit bill offers a UPI QR carrying its Medoro reference.
  await page.getByRole("button", { name: "Reconcile" }).click();
  const billRow = page.getByRole("listitem").filter({ hasText: cust });
  await expect(billRow).toContainText("₹300.00");
  const invoiceNo = (await billRow.innerText()).split(" · ")[0].trim();
  await billRow.getByRole("button", { name: /UPI QR for/ }).click();
  await expect(page.getByRole("dialog")).toContainText(`MD${squash(invoiceNo)}`);
  await expect(page.getByRole("img", { name: "UPI payment QR" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

  // Upload an HDFC-style statement: the customer's UPI payment with the reference, and a later line so the
  // statement covers the days after the counter's UPI bill.
  await page.getByRole("button", { name: "Import statement" }).click();
  await page.getByLabel("Bank").selectOption("HDFC");
  await page.getByLabel("Last 4 digits").fill("4321");
  const csv = [
    "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    `${dmy()},"UPI-RAHUL-rahul@okhdfcbank-HDFC0001234-430512345678-MD${squash(invoiceNo)}",0000430512345678,${dmy()},,300.00,10300.00`,
    `${dmy(4)},"INT PD QTR",,${dmy(4)},,12.00,10312.00`,
  ].join("\n");
  await page.getByLabel("Statement file").setInputFiles({ name: "hdfc.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/2 credit\(s\), 0 debit\(s\)/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "430512345678", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import 2 transaction(s)" }).click();
  await expect(page.getByText(/2 new · 0 already imported or the same payment · 0 possible duplicate\(s\) to review · 1 matched automatically/)).toBeVisible();

  // The same file again adds nothing.
  await page.getByLabel("Statement file").setInputFiles({ name: "hdfc.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import 2 transaction(s)" }).click();
  await expect(page.getByText(/0 new · 2 already imported/)).toBeVisible();

  // Reconcile: the bill is paid; the counter UPI bill is flagged.
  await page.getByRole("button", { name: "Go to Reconcile" }).click();
  await expect(page.getByText("Matched automatically (latest)").locator("../..")).toContainText(`${invoiceNo} · ${cust} · rule 1`);
  await expect(page.getByText("Counter UPI not in the bank statement").locator("../..")).toContainText("₹200.00");
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByText("Needs attention")).toBeVisible();
  await expect(page.getByText("Automatic bank sync").locator("..")).toContainText("Not connected");

  // The customer owes nothing now.
  await page.getByRole("tab", { name: "Customers" }).click();
  await page.getByLabel("Search customers").fill(cust);
  await expect(page.getByRole("listitem").filter({ hasText: cust })).toContainText("nothing due");

  // Reports and the web page.
  await page.getByRole("tab", { name: "UPI & Bank" }).click();
  await page.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByText("Bank-wise collections").locator("..")).toContainText("HDFC Bank ••4321");
  await page.goto("/app/money");
  await expect(page.getByText("Your records live on your counters")).toBeVisible();
});
