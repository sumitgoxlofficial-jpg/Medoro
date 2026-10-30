import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

/** Written by setup.e2e.ts after the first-run wizard; read by every spec. */
export const AUTH_DIR = path.join(__dirname, ".auth");
export const OWNER_STATE = path.join(AUTH_DIR, "owner.json");
const STATE_FILE = path.join(AUTH_DIR, "state.json");

export type SuiteState = {
  pharmacy: string; tenantCode: string; ownerName: string; ownerEmail: string; ownerPassword: string; totpSecret: string;
  branches: string[]; recoveryKey: string; recoveryCodes: string[];
};

export const OWNER = {
  pharmacy: "Sanjeevani E2E Pharmacy", tenantCode: "SANJ-E2E", ownerName: "Asha Kulkarni", ownerEmail: "owner@e2e-pharmacy.in",
  ownerPhone: "9822041736", ownerPassword: "Correct-Horse-42!", branches: ["Main branch", "Kothrud"],
};

export function saveState(s: SuiteState) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export function state(): SuiteState {
  if (!existsSync(STATE_FILE)) throw new Error("e2e/.auth/state.json is missing: run the setup project first (npx playwright test runs it automatically).");
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

// ───────────── Database (read-mostly checks; all writes go through the UI) ─────────────

let prisma: PrismaClient | null = null;
export const db = () => (prisma ??= new PrismaClient());

export async function tenant() {
  return db().tenant.findUniqueOrThrow({ where: { code: state().tenantCode } });
}

// ───────────── TOTP (RFC 6238, SHA-1, 6 digits, 30 s), same as src/server/totp.ts ─────────────

function base32(s: string) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error(`Not base32: ${ch}`);
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totp(secretB32: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// ───────────── Small UI helpers ─────────────

/** A short id so names stay unique if the suite is re-run against the same database. */
export const uid = () => randomBytes(3).toString("hex").toUpperCase();

/** The toast (role=status) with this text. */
export const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(toast(page, text).first()).toBeVisible();
}

/** Answers the next window.prompt/confirm with `value` (confirm: accept). */
export function answerDialogs(page: Page, value = "") {
  page.on("dialog", (d) => { void (d.type() === "prompt" ? d.accept(value) : d.accept()); });
}

/** MM/YYYY a number of months from today (expiry as printed on packs). */
export function monthsAhead(n: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return { slash: `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`, iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` };
}

export const money = (rupees: number) => "₹" + rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ───────────── Sign-in ─────────────

/** A context with nobody signed in (browser.newContext() in a test inherits the project's owner session). */
export const anonContext = (browser: Browser) => browser.newContext({ storageState: { cookies: [], origins: [] } });

export async function ownerPasswordStep(page: Page, email: string, password: string) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Email & password" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Enters the current TOTP. On first enrolment the recovery codes screen follows; its codes are returned. */
export async function enterTotp(page: Page, secret: string, trust = true): Promise<string[] | null> {
  await expect(page).toHaveURL(/\/signin\/mfa/);
  const box = page.getByLabel("Trust this counter PC for 30 days");
  if ((await box.isChecked()) !== trust) await box.click();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  const save = page.getByText("Save your recovery codes");
  await expect(save.or(page.getByRole("heading", { name: "Dashboard" }))).toBeVisible();
  let codes: string[] | null = null;
  if (await save.isVisible()) {
    codes = (await page.locator("div.grid.font-mono > span").allInnerTexts()).map((c) => c.trim());
    expect(codes).toHaveLength(10);
    await page.getByLabel("I’ve saved these codes").check();
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/app$/);
  return codes;
}

/** A fresh context signed in as the owner with password + TOTP (does not reuse the saved state). */
export async function freshOwner(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await anonContext(browser);
  const page = await context.newPage();
  const s = state();
  await ownerPasswordStep(page, s.ownerEmail, s.ownerPassword);
  await enterTotp(page, s.totpSecret);
  return { context, page };
}

export async function employeeLogin(page: Page, code: string, employeeNo: string, pin: string, counter?: string) {
  await page.goto("/signin?view=employee");
  await page.getByLabel("Pharmacy code").fill(code);
  await page.getByLabel("Employee ID").fill(employeeNo);
  await page.getByLabel("4-digit PIN").fill(pin);
  const c = counter ? page.getByRole("button", { name: new RegExp(counter) }) : page.getByRole("button", { name: /^Counter \d/ }).first();
  await c.click();
  await page.getByRole("button", { name: "Start shift" }).click();
}

// ───────────── Team ─────────────

/** Owner adds an employee on the Users screen; returns the invite code shown. */
export async function addEmployee(page: Page, p: { name: string; contact: string; role: "Manager" | "Pharmacist" | "Cashier" | "Accountant"; branch?: string }) {
  await page.goto("/app/users");
  await page.getByRole("button", { name: "Add employee" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Role").selectOption(p.role);
  await dlg.getByLabel("Full name").fill(p.name);
  await dlg.getByLabel(/^(Email|Mobile number or email)$/).fill(p.contact);
  if (p.branch) await dlg.getByLabel("Branch").selectOption({ label: p.branch });
  await dlg.getByRole("button", { name: "Create & get invite code" }).click();
  await expect(page.getByText(`Invite for ${p.name}`)).toBeVisible();
  const inv = await db().invite.findFirstOrThrow({ where: { contact: p.contact.toLowerCase(), usedAt: null }, orderBy: { createdAt: "desc" } });
  await expect(page.getByText(inv.code, { exact: true }).first()).toBeVisible();
  return inv.code;
}

/** The employee redeems the invite on the sign-in screen; returns their employee ID. */
export async function joinWithInvite(page: Page, p: { code: string; invite: string; contact: string; name: string; pin: string }) {
  await page.goto("/signin?view=employee");
  await page.getByRole("button", { name: "New employee? Create your account" }).click();
  await page.getByLabel("Pharmacy code").fill(p.code);
  await page.getByLabel("Invite code").fill(p.invite);
  await page.getByRole("button", { name: "Find my invite" }).click();
  await expect(page.getByText("Invite found:")).toBeVisible();
  await page.getByLabel(/on the invite/).fill(p.contact);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your full name").fill(p.name);
  const manager = await page.getByLabel(/Create a password/).isVisible();
  await page.getByLabel(manager ? /Create a password/ : "Create a 4-digit PIN").fill(p.pin);
  await page.getByLabel(manager ? "Confirm password" : "Confirm PIN").fill(p.pin);
  await page.getByLabel(/I agree to the staff terms/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account ready")).toBeVisible();
  const u = await db().user.findFirstOrThrow({ where: { email: p.contact.toLowerCase() } });
  return u.employeeNo!;
}

/** Owner invites, the employee joins: returns employee ID and PIN for counter sign-in. */
export async function createStaff(browser: Browser, owner: Page, role: "Pharmacist" | "Cashier" | "Accountant", name: string, branch?: string) {
  const contact = `${role.toLowerCase()}.${uid().toLowerCase()}@e2e-pharmacy.in`;
  const invite = await addEmployee(owner, { name, contact, role, branch });
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  const pin = "4826";
  const employeeNo = await joinWithInvite(page, { code: state().tenantCode, invite, contact, name, pin });
  await ctx.close();
  return { employeeNo, pin, contact, name };
}

// ───────────── Catalogue ─────────────

export type MedRow = {
  name: string; generic?: string; strength?: string; form?: string; manufacturer?: string; mrp: number; gst?: number; schedule?: string;
  batch?: string; expiry?: string; qty?: number; cost?: number; barcode?: string; reorder?: number;
};

const HEAD = ["Brand name", "Generic / salt", "Strength", "Form", "Manufacturer", "Pack", "MRP", "GST %", "Schedule", "HSN", "Barcode", "Reorder level", "Rack", "Batch", "Expiry", "Opening qty", "Cost per pack (excl. GST)"];

export function medicinesCsv(rows: MedRow[]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const line = (r: MedRow) => [r.name, r.generic ?? "Paracetamol", r.strength ?? "500 mg", r.form ?? "Tablet", r.manufacturer ?? "E2E Labs", "10 tabs", r.mrp.toFixed(2), String(r.gst ?? 12), r.schedule ?? "", "3004", r.barcode ?? "", String(r.reorder ?? 5), "", r.batch ?? "", r.expiry ?? "", r.qty != null ? String(r.qty) : "", r.cost != null ? r.cost.toFixed(2) : ""].map(esc).join(",");
  return [HEAD.join(","), ...rows.map(line)].join("\n") + "\n";
}

async function chooseImportFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Choose file").setInputFiles(file);
  await expect(dlg.getByText(/columns found/)).toBeVisible();
  return dlg;
}

/** Imports medicines (with opening stock) through Inventory → Import, at the branch currently selected. */
export async function importMedicines(page: Page, rows: MedRow[]) {
  await page.goto("/app/inventory");
  await page.getByRole("button", { name: "Import", exact: true }).first().click();
  const dlg = await chooseImportFile(page, { name: "medicines.csv", mimeType: "text/csv", buffer: Buffer.from(medicinesCsv(rows)) });
  await dlg.getByRole("button", { name: /^Import \d+ rows?$/ }).click();
  await expect(dlg.getByText("Import finished")).toBeVisible();
  await dlg.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export { chooseImportFile };

/** Selects a branch in the header (owner sees every branch). */
export async function switchBranch(page: Page, name: string) {
  const sel = page.getByLabel("Branch", { exact: true });
  await sel.selectOption({ label: name });
  await expect(sel.locator("option:checked")).toHaveText(name);
  await page.waitForLoadState("networkidle").catch(() => {});
}

// ───────────── POS ─────────────

export async function addToCart(page: Page, search: string, name = search) {
  const box = page.getByLabel("Search medicine");
  await box.fill(search);
  const hit = page.getByRole("button", { name: new RegExp(escapeRe(name)) }).first();
  await hit.click();
  await expect(page.getByLabel(`Batch for ${name}`)).toBeVisible();
}

/** Completes the sale on the POS screen and returns the invoice number shown. */
export async function completeSale(page: Page) {
  await page.getByRole("button", { name: /^Complete sale/ }).click();
  await expect(page.getByText("Sale committed")).toBeVisible();
  const no = (await page.getByRole("dialog").locator(".font-mono").first().innerText()).trim();
  return no;
}

export async function newSale(page: Page) {
  await page.getByRole("button", { name: "New sale" }).click();
  await expect(page.getByText("Sale committed")).toHaveCount(0);
}

/** Owner sells `qty` of a medicine for cash at the current branch; returns the invoice number. */
export async function quickSale(page: Page, name: string, qty = 1) {
  await page.goto("/app/pos");
  await addToCart(page, name);
  if (qty > 1) await page.getByLabel("Quantity").first().fill(String(qty));
  return completeSale(page);
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const rowOf = (scope: Page | Locator, text: string | RegExp) => scope.locator("tr").filter({ hasText: text });

export function outFile(info: TestInfo, name: string, data: string | Buffer) {
  const p = info.outputPath(name);
  writeFileSync(p, data);
  return p;
}
