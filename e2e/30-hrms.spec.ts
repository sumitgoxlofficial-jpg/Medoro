import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { verhoeffDigit } from "../src/lib/aadhaar";
import { db, uid } from "./helpers";

/**
 * Spec 30 · Medoro HRMS (/staff/hrms). A super admin made with scripts/create-super-admin.mjs signs in with a one-time
 * password, creates an employee, and the employee goes through first sign-in (including Aadhaar and PAN), check-in and a half-day leave that the
 * admin approves. Then payroll shows a preview, and a last working day is recorded and cancelled.
 */
const tag = uid().toLowerCase();
const ADMIN = { email: `hr-admin-${tag}@medoro.in`, otp: `One-Time-${tag}-Pass`, password: `Admin-${tag}-Password-26` };
const EMP = { name: `Riya ${tag.replace(/\d/g, "x")}`, personal: `riya.${tag}@example.com`, phone: "98" + String(Date.now()).slice(-8), password: `Riya-${tag}-Password-26` };

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, id: string, password: string) {
  await page.goto("/staff/employee");
  await page.locator("input[autocomplete=username]").fill(id);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function setPassword(page: Page, password: string) {
  await expect(page.getByText("Set your own password")).toBeVisible();
  await page.locator("input[type=password]").nth(0).fill(password);
  await page.locator("input[type=password]").nth(1).fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
}
/** The Aadhaar and PAN step for an employee: numbers with consent, then a card for each. `withPan` when the PAN isn't saved yet. */
async function completeKyc(p: Page, withPan: boolean) {
  await expect(p.getByText("Verify your identity")).toBeVisible();
  const body = "23412341234";
  await p.getByPlaceholder("1234 5678 9012").fill(body + verhoeffDigit(body));
  if (withPan) await p.getByPlaceholder("ABCDE1234F").fill("ABCPS1234K");
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Save numbers" }).click();
  await expect(p.getByText(/Saved: XXXX XXXX \d{4}/)).toBeVisible();
  await expect(p.getByRole("link", { name: "Verify with DigiLocker" })).toHaveCount(0); // not set up on this server
  const pdf = { name: "card.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") };
  await p.getByLabel("Aadhaar card file").setInputFiles(pdf);
  await p.locator("section section").filter({ hasText: "2. Aadhaar proof" }).getByRole("button", { name: "Upload" }).click();
  await expect(p.getByText("Waiting for HR").first()).toBeVisible();
  await p.getByLabel("PAN card file").setInputFiles(pdf);
  await p.locator("section section").filter({ hasText: "3. PAN card" }).getByRole("button", { name: "Upload" }).click();
}
/** The first weekday on or after `from` (YYYY-MM-DD), so a leave date is never a weekly off. */
function weekday(from: Date) {
  const d = new Date(from);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test("HRMS: admin creates an employee; first sign-in, check-in, half-day leave and approval; payroll preview; exit", async ({ page, browser }) => {
  test.setTimeout(180_000);
  execFileSync("node", [path.join(__dirname, "..", "scripts", "create-super-admin.mjs"), ADMIN.email, ADMIN.otp, "Hema Admin", "9811000001"], { stdio: "pipe" });

  // The super admin signs in with the one-time password and must set their own.
  await signIn(page, ADMIN.email, ADMIN.otp);
  await setPassword(page, ADMIN.password);
  // The super admin is not asked to verify their identity: they go straight in.
  await expect(page.getByText("Verify your identity")).toHaveCount(0);
  await expect(page.getByText("Employee database")).toBeVisible();

  // New employee: the ID, official email and temporary password are generated.
  await page.goto("/staff/hrms/hrnewemp");
  await page.getByLabel("Full name").fill(EMP.name);
  await page.getByLabel("Personal email").fill(EMP.personal);
  await page.getByLabel("Mobile").fill(EMP.phone);
  await page.getByLabel("Department").selectOption("Engineering");
  await page.getByLabel("Designation").fill("Software Engineer");
  await page.getByLabel("Date of joining").fill("2026-01-05");
  await page.getByLabel("Annual CTC").fill("600000");
  await page.getByRole("button", { name: /Create employee/ }).click();
  await expect(page.getByText(`${EMP.name} is ready`)).toBeVisible();
  const made = await page.locator("body").innerText();
  const empNo = made.match(/Employee ID: (MS-\d+)/)![1], temp = made.match(/Temporary password: (\S+)/)![1];

  // Payroll for this month is a preview (it opens on the last working day), and nobody is docked for days before today.
  await page.goto("/staff/hrms/payroll");
  const row = page.getByRole("row").filter({ hasText: empNo });
  await expect(row).toBeVisible();
  const paid = (await row.getByRole("cell").nth(1).innerText()).trim().split("/");
  expect(paid[0]).toBe(paid[1]); // every working day paid: the profile was made today

  // The employee's first sign-in: password, details, joining documents.
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const emp = await ctx.newPage();
  await signIn(emp, empNo, temp);
  await setPassword(emp, EMP.password);
  await expect(emp.getByText("Your details")).toBeVisible();
  await emp.getByLabel("Date of birth").fill("1997-04-12");
  await emp.getByLabel("Gender").selectOption({ label: "Female" });
  await emp.getByLabel("Address").fill("12 MG Road, Pune 411001");
  await emp.getByLabel("Emergency contact name").fill("Anil Sharma");
  await emp.getByLabel("Emergency contact mobile").fill("9898989898");
  await emp.getByLabel("Account holder").fill(EMP.name);
  await emp.getByLabel("Account number").fill("123456789012");
  await emp.getByLabel("IFSC").fill("HDFC0001234");
  await emp.getByLabel("PAN").fill("ABCPS1234K");
  await emp.getByRole("button", { name: "Save and continue" }).click();
  // Aadhaar and PAN: the numbers with consent, then a card for each (DigiLocker isn't set up here, so HR checks the Aadhaar card).
  await completeKyc(emp, false);
  await expect(emp.getByRole("button", { name: "Accept and enter the HRMS" })).toBeVisible();
  await expect(emp.getByRole("checkbox")).toHaveCount(3);
  for (const box of await emp.getByRole("checkbox").all()) await box.check();
  await emp.getByRole("button", { name: "Accept and enter the HRMS" }).click();
  await expect(emp.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();

  // Check in (not on a weekly off or holiday, when the button isn't offered).
  await emp.goto("/staff/hrms/attendance");
  const checkIn = emp.getByRole("button", { name: "Check in" });
  if (await checkIn.count()) {
    await checkIn.first().click();
    await expect(emp.getByRole("button", { name: "Check out" })).toBeVisible();
  }

  // Half a day of casual leave on a weekday next month.
  const day = weekday(new Date(Date.now() + 35 * 86_400_000));
  await emp.goto("/staff/hrms/leave");
  await emp.getByRole("button", { name: "+ Apply leave" }).click();
  await emp.getByLabel("Half day").check();
  await emp.getByLabel("From").fill(day);
  await emp.getByRole("button", { name: "Send request" }).click();
  await expect(emp.getByRole("row").filter({ hasText: "Casual Leave" })).toContainText("pending");
  const leave = await db().hrLeave.findFirstOrThrow({ where: { fromDay: new Date(day + "T00:00:00Z"), half: true }, orderBy: { createdAt: "desc" } });
  expect(leave.status).toBe("pending");

  // The admin approves it under Leave Management.
  await page.goto("/staff/hrms/hrleave");
  const req = page.locator("div.rounded-xl").filter({ hasText: EMP.name }).filter({ hasText: "half a day" }).last();
  await req.getByRole("button", { name: "Approve" }).click();
  await expect.poll(async () => (await db().hrLeave.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe("approved");
  await emp.reload();
  await expect(emp.getByRole("row").filter({ hasText: "Casual Leave" })).toContainText("approved");

  // HR checks both cards against the numbers: the directory shows the employee as verified.
  await page.goto("/staff/hrms/hremployees");
  await page.getByRole("row").filter({ hasText: empNo }).getByRole("button", { name: "Documents" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("Submitted: check the cards")).toBeVisible();
  await dlg.getByRole("button", { name: "Show full numbers to compare with the cards" }).click();
  await expect(dlg.getByText(/2341 2341 234\d/)).toBeVisible();
  const mark = dlg.getByRole("button", { name: "Mark verified" });
  await expect(mark).toHaveCount(2);
  await mark.first().click();
  await expect(mark).toHaveCount(1); // the list refreshed: one card is verified
  await mark.first().click();
  await expect(mark).toHaveCount(0);
  await expect.poll(async () => (await db().hrProfile.findFirstOrThrow({ where: { staff: { empNo } } })).kycVerifiedAt).not.toBeNull();
  await dlg.getByRole("button", { name: "Close" }).click();

  // Record a last working day two weeks ahead: the person stays active; then cancel the exit.
  await page.goto("/staff/hrms/hremployees");
  const person = page.getByRole("row").filter({ hasText: empNo });
  await person.getByRole("button", { name: "Record exit" }).click();
  await page.getByLabel("Last working day").fill(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Record last working day" }).click();
  await expect(person.getByRole("button", { name: /Leaving .* cancel/ })).toBeVisible();
  const staff = await db().staffUser.findUniqueOrThrow({ where: { empNo }, include: { hr: true } });
  expect(staff.status).toBe("active");
  expect(staff.hr?.exitDate).not.toBeNull();
  page.once("dialog", (d) => void d.accept());
  await person.getByRole("button", { name: /Leaving .* cancel/ }).click();
  await expect(person.getByRole("button", { name: "Record exit" })).toBeVisible();
  await ctx.close();
});
