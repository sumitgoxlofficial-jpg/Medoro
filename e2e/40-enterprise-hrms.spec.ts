import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { db, uid } from "./helpers";

/**
 * Spec 40 · Enterprise HRMS screens on the production build: a super admin opens every new screen, makes a shift, a KPI,
 * a course and a survey, enrols a company PC for an employee, and the agent API is exercised over real HTTP
 * (enrol → status rules → events → revoke).
 */
const tag = uid().toLowerCase();
const ADMIN = { email: `ent-admin-${tag}@medoro.in`, otp: `One-Time-${tag}-Pass`, password: `Admin-${tag}-Password-26` };

test.use({ storageState: { cookies: [], origins: [] } });

async function signInAdmin(page: Page) {
  execFileSync("node", [path.join(__dirname, "..", "scripts", "create-super-admin.mjs"), ADMIN.email, ADMIN.otp, "Enterprise Admin", "9811000040"], { stdio: "pipe" });
  await page.goto("/staff/employee");
  await page.locator("input[autocomplete=username]").fill(ADMIN.email);
  await page.locator("input[type=password]").fill(ADMIN.otp);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Set your own password")).toBeVisible();
  // The forced password step is enforced on the server too: no other screen's data is in the page.
  expect(await page.locator("body").innerText()).not.toContain("Employee database");
  await page.locator("input[type=password]").nth(0).fill(ADMIN.password);
  await page.locator("input[type=password]").nth(1).fill(ADMIN.password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Employee database")).toBeVisible();
}

test("Enterprise HRMS: new screens, shift, KPI, course, survey, and the agent API over HTTP", async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInAdmin(page);

  // An employee to work with (created directly: the HRMS flows for this are covered by spec 30).
  const p = db();
  const empNo = `MS-E${tag.slice(0, 3)}`;
  const emp = await p.staffUser.create({ data: { empNo, name: `Esha ${tag}`, email: `esha.${tag}@medoro.in`, kind: "team", phone: "98" + String(Date.now()).slice(-8), role: "employee", status: "active", hr: { create: { role: "employee", dept: "Ops", designation: "Executive", profileDone: true, docsAcceptedAt: new Date(), kycSubmittedAt: new Date(), joinDate: new Date("2026-01-05") } } } });

  for (const [screen, heading] of [["orgchart", "Organisation chart"], ["approvals", "Waiting for you"], ["workforce", "Enrol a company PC"], ["kpis", "KPI definitions"], ["hrshifts", "Shifts"], ["learning", "Courses"], ["engage", "All surveys"], ["mgmt", "Headcount, joins and exits"]] as const) {
    await page.goto(`/staff/hrms/${screen}`);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }

  // A shift.
  await page.goto("/staff/hrms/hrshifts");
  await page.getByRole("button", { name: "New shift" }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Early ${tag}`);
  await page.getByRole("button", { name: "Save shift" }).click();
  await expect(page.getByRole("cell", { name: `Early ${tag}` })).toBeVisible();

  // A KPI, computed.
  await page.goto("/staff/hrms/kpis");
  await page.getByRole("button", { name: "New KPI" }).click();
  await page.getByLabel("Name", { exact: true }).fill(`On time ${tag}`);
  await page.getByLabel("Department (empty = any)").fill("Ops");
  await page.getByRole("button", { name: "Save KPI" }).click();
  await expect(page.getByText(`On time ${tag}`)).toBeVisible();
  await page.getByRole("button", { name: "Compute now" }).click();
  await expect(page.getByRole("status").filter({ hasText: /results computed/ })).toBeVisible();

  // A course, published to its audience.
  await page.goto("/staff/hrms/learning");
  await page.getByRole("button", { name: "New course" }).click();
  await page.getByLabel("Title", { exact: true }).fill(`Safety ${tag}`);
  await page.getByLabel("Lesson 1 title").fill("Fire exits");
  await page.getByLabel("Text", { exact: true }).fill("Know where the nearest fire exit is on every floor.");
  await page.getByRole("button", { name: "Save course" }).click();
  await page.getByRole("row", { name: new RegExp(`Safety ${tag}`) }).getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Published\. \d+ people enrolled/ })).toBeVisible();

  // A survey.
  await page.goto("/staff/hrms/engage");
  await page.getByRole("button", { name: "New survey" }).click();
  await page.getByLabel("Title", { exact: true }).fill(`Pulse ${tag}`);
  await page.getByLabel("Closes on").fill("2099-12-31");
  await page.getByRole("button", { name: "Send survey" }).click();
  await expect(page.getByText(`Pulse ${tag}`)).toBeVisible();

  // Enrol a company PC for the employee and read the one-time code.
  await page.goto("/staff/hrms/workforce");
  await page.getByLabel("Employee").selectOption(emp.id);
  await page.getByRole("button", { name: "Create code" }).click();
  const code = (await page.getByText(/Code for/).innerText()).match(/\d{4}-\d{4}-\d{4}/)![0];

  // The agent API over HTTP, as the Windows agent calls it.
  const enrol = await request.post("/api/agent/enrol", { data: { code, name: "E2E-PC", agentVersion: "1.0.0" } });
  expect(enrol.status()).toBe(200);
  const { token } = await enrol.json();
  const auth = { authorization: `Bearer ${token}` };
  const status = async () => (await (await request.get("/api/agent/status", { headers: auth })).json()).reason;
  expect(await status()).toBe("tracking-off");
  const s = await p.hrSetting.findUnique({ where: { key: "settings" } });
  const settings = { ...((s?.value as object) ?? {}), agentTracking: true };
  await p.hrSetting.upsert({ where: { key: "settings" }, update: { value: settings }, create: { key: "settings", value: settings } });
  await expect.poll(status, { timeout: 15_000 }).toBe("policy"); // settings are cached for a few seconds per server
  await p.hrMonitorAck.create({ data: { staffId: emp.id, version: 1 } });
  expect(await status()).toBe("not-checked-in");
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  await p.hrAttendance.create({ data: { staffId: emp.id, day: new Date(day + "T00:00:00Z"), inAt: new Date(Date.now() - 3600_000), status: "present" } });
  expect(await status()).toBe("ok");
  const span = { clientId: `e2e${tag}span01`, kind: "active", app: "EXCEL", startedAt: new Date(Date.now() - 600_000).toISOString(), endedAt: new Date(Date.now() - 300_000).toISOString() };
  const up = await request.post("/api/agent/events", { headers: auth, data: { events: [span] } });
  expect(await up.json()).toMatchObject({ accepted: 1, outside: 0 });
  expect((await request.post("/api/agent/events", { headers: auth, data: { events: [{ ...span, clientId: `e2e${tag}span02`, title: "secret.xlsx" }] } })).status()).toBe(400);

  // The employee's activity is visible to HR, and the PC can be removed from the HRMS.
  await page.goto("/staff/hrms/workforce");
  await page.getByRole("row", { name: /E2E-PC/ }).getByRole("button", { name: "Remove" }).click({ trial: true });
  const dev = await p.hrDevice.findFirstOrThrow({ where: { staffId: emp.id } });
  await p.hrDevice.update({ where: { id: dev.id }, data: { revokedAt: new Date() } });
  expect((await request.get("/api/agent/status", { headers: auth })).status()).toBe(401);
  await p.hrSetting.upsert({ where: { key: "settings" }, update: { value: { ...settings, agentTracking: false } }, create: { key: "settings", value: { ...settings, agentTracking: false } } });
});
