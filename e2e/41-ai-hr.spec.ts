import { execFileSync } from "node:child_process";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import { test, expect, type Page } from "@playwright/test";
import { db, uid } from "./helpers";

/**
 * Spec 41 · AI HR Assistant on the production build. The super admin switches it on, HR asks the assistant to follow up
 * with an employee, the employee has the conversation in the browser (typed), HR sees the structured outcome, opens the
 * transcript and decides the follow-up; the playground runs; the microphone is allowed on HRMS pages only.
 */
const tag = uid().toLowerCase();
const ADMIN = { email: `ai-admin-${tag}@medoro.in`, otp: `One-Time-${tag}-Pass`, password: `Admin-${tag}-Password-26` };
const EMP = { email: `neha.${tag}@medoro.in`, password: `Neha-${tag}-Password-26`, name: `Neha ${tag.replace(/\d/g, "x")}` };

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, id: string, password: string) {
  await page.goto("/staff/employee");
  await page.locator("input[autocomplete=username]").fill(id);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("AI HR Assistant: switch on, follow-up conversation in the browser, HR review, playground, microphone policy", async ({ page, browser }) => {
  test.setTimeout(180_000);
  execFileSync("node", [path.join(__dirname, "..", "scripts", "create-super-admin.mjs"), ADMIN.email, ADMIN.otp, "AI Admin", "9811000041"], { stdio: "pipe" });
  await signIn(page, ADMIN.email, ADMIN.otp);
  await expect(page.getByText("Set your own password")).toBeVisible();
  await page.locator("input[type=password]").nth(0).fill(ADMIN.password);
  await page.locator("input[type=password]").nth(1).fill(ADMIN.password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Employee database")).toBeVisible();

  // An employee who has finished first sign-in (that flow is covered by spec 30).
  const p = db();
  await p.staffUser.create({ data: { empNo: `MS-A${tag.slice(0, 3)}`, name: EMP.name, email: EMP.email, kind: "team", phone: "97" + String(Date.now()).slice(-8), role: "employee", status: "active", passwordHash: await hash(EMP.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }), hr: { create: { role: "employee", dept: "Ops", designation: "Executive", profileDone: true, docsAcceptedAt: new Date(), kycSubmittedAt: new Date(), joinDate: new Date("2026-01-05") } } } });

  // The microphone is allowed on HRMS pages (for voice answers) and nowhere else.
  const res = await page.request.get("/staff/hrms/aicall");
  expect(res.headers()["permissions-policy"]).toContain("microphone=(self)");
  expect((await page.request.get("/legal")).headers()["permissions-policy"]).toContain("microphone=()");

  // Settings: switch it on, voice on the employee's device (free).
  await page.goto("/staff/hrms/aihr?tab=settings");
  await page.getByLabel("Automatic AI conversations on").check();
  await expect(page.getByLabel("Voice")).toHaveValue("browser");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("AI HR Assistant settings saved.")).toBeVisible();

  // Overview counts from the database, then ask the assistant to follow up with the employee.
  await page.goto("/staff/hrms/aihr");
  await expect(page.getByText("Conversations (30 days)")).toBeVisible();
  const followUp = page.locator("section", { hasText: "Ask the assistant to follow up" });
  await followUp.getByLabel("Employee").selectOption({ label: `${EMP.name} (MS-A${tag.slice(0, 3)})` });
  await followUp.getByLabel("About").fill("Leave questions");
  await followUp.getByRole("button", { name: "Schedule follow-up" }).click();
  await expect(page.getByText("Follow-up conversation scheduled.")).toBeVisible();

  // The employee talks to the assistant (typed: the same path voice uses after recognition).
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const e = await ctx.newPage();
  await signIn(e, EMP.email, EMP.password);
  await e.waitForURL(/\/staff\/hrms/);
  await e.goto("/staff/hrms/aicall");
  await expect(e.getByText("AI conversations on")).toBeVisible();
  await e.getByRole("button", { name: "Talk now" }).click();
  await expect(e.getByText(/Main Medoro ki AI HR Assistant hoon|AI assistant from Medoro HR/).first()).toBeVisible();
  await e.getByPlaceholder("Type your answer (Hindi, English or Hinglish)").fill("Leave cancel kaise karte hain HRMS mein?");
  await e.getByRole("button", { name: "Send", exact: true }).click();
  await expect(e.getByText(/Source: Cancelling leave/)).toBeVisible();
  await expect(e.getByText("Conversation finished. Thank you.")).toBeVisible();
  await e.getByRole("button", { name: "Close" }).click();

  // The employee can switch AI conversations off and on again.
  const choice = e.locator("section", { hasText: "Your choice" });
  await choice.getByRole("button", { name: "Turn off" }).click();
  await expect(e.getByText("AI conversations off", { exact: true })).toBeVisible();
  await choice.getByRole("button", { name: "Turn on" }).click();
  await expect(e.getByText("AI conversations on", { exact: true })).toBeVisible();
  await ctx.close();

  // HR sees the outcome and the transcript (the opening is audited).
  await page.goto("/staff/hrms/aihr?tab=calls");
  const row = page.getByRole("row", { name: new RegExp(EMP.name) }).first();
  await expect(row.getByText("completed")).toBeVisible();
  await row.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText(/Leave cancel kaise karte hain/)).toBeVisible();
  await expect(page.getByText(/Nothing here changed attendance, leave or pay/)).toBeVisible();
  expect(await p.staffAudit.count({ where: { action: "HRMS · AI conversation transcript opened" } })).toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  // Knowledge: retrieval test answers with its source.
  await page.goto("/staff/hrms/aihr?tab=knowledge");
  await page.getByPlaceholder("Leave cancel kaise karte hain?").fill("payslip kahan milegi");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/Payslips and tax statement/).first()).toBeVisible();

  // Playground: nobody is contacted; the outcome is structured.
  await page.goto("/staff/hrms/aihr?tab=playground");
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByPlaceholder(/Haan, traffic mein hoon/).fill("traffic mein hoon, 20 minute mein pahunch jaunga");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/expected arrival .* note kar rahi hoon/)).toBeVisible();
  await expect(page.locator("pre")).toContainText('"employeeResponse": "coming"');
  await expect(page.locator("pre")).toContainText('"reasonCategory": "traffic"');

  // Scenario evaluation from the screen.
  await page.goto("/staff/hrms/aihr?tab=scenarios");
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByText(/Evaluation finished: 1000\/1000 passed/)).toBeVisible({ timeout: 60_000 });
});
