import { test, expect } from "@playwright/test";
import { fakeDrive } from "./fake-drive";
import { OWNER_STATE, importMedicines, monthsAhead, uid } from "./helpers";

// DriveDB phase 2: the device saves the pharmacy to (a fake) Google Drive, encrypted; a wiped device restores it
// with the recovery code.
test("set up Drive storage, then restore everything on a fresh device with the recovery code", async ({ browser }) => {
  const drive = fakeDrive();
  const ctxA = await browser.newContext({ storageState: OWNER_STATE });
  await drive.attach(ctxA);
  const page = await ctxA.newPage();
  const name = `Rst ${uid()}`;
  await importMedicines(page, [{ name, mrp: 50, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 20, cost: 30 }]);

  await page.goto("/app/lab");
  await expect(page.getByRole("button", { name: /Turn (on|off) Drive mode/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Turn on Drive mode" }).isVisible()) {
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Turn on Drive mode" }).click();
    await expect(page.getByRole("button", { name: "Turn off Drive mode" })).toBeVisible();
  }
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();
  const bill = async () => {
    await page.getByLabel("Search medicine").fill(name);
    await page.getByRole("button", { name }).click();
    await page.getByRole("button", { name: /Complete bill/ }).click();
    await expect(page.getByText(/saved on this device/).last()).toBeVisible();
  };
  await bill();

  // Set up: the recovery code is shown once.
  await page.getByRole("button", { name: "Set up Drive storage" }).click();
  const code = (await page.getByTestId("recovery-code").textContent())!.trim();
  expect(code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  await page.getByLabel(/saved the recovery code/).check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Last full copy")).toBeVisible();
  expect([...drive.files.values()].map((f) => f.name).sort()).toEqual(["encryption-meta.json", "manifest.json", "pharmacy.db.enc"]);
  for (const f of drive.files.values()) expect(f.bytes.includes(Buffer.from(code.replace(/-/g, "")))).toBe(false);

  // A bill after the full copy goes up as a change log within ~10 s.
  await bill();
  await expect.poll(() => [...drive.files.values()].some((f) => f.name.startsWith("log-")), { timeout: 30_000 }).toBe(true);
  await ctxA.close();

  // A different, empty device (new browser profile): restore with the recovery code.
  const ctxB = await browser.newContext({ storageState: OWNER_STATE });
  await drive.attach(ctxB);
  const pageB = await ctxB.newPage();
  await pageB.goto("/app/device-pos");
  await expect(pageB.getByText("Or restore from Google Drive")).toBeVisible();
  await pageB.getByLabel("Drive recovery code").fill(code.replace(/^..../, "0000"));
  await pageB.getByRole("button", { name: "Restore from Google Drive" }).click();
  await expect(pageB.getByText(/doesn’t open this pharmacy/)).toBeVisible();
  await pageB.getByLabel("Drive recovery code").fill(code.toLowerCase());
  await pageB.getByRole("button", { name: "Restore from Google Drive" }).click();
  await expect(pageB.getByText(/Restored from Google Drive/)).toBeVisible();
  await expect(pageB.getByText(/-000001 · Walk-in/)).toBeVisible();
  await expect(pageB.getByText(/-000002 · Walk-in/)).toBeVisible();
  // This device is approved now and saves to Drive without the code.
  await expect(pageB.getByText("Last full copy")).toBeVisible();

  await pageB.goto("/app/lab");
  await pageB.getByRole("button", { name: "Turn off Drive mode" }).click();
  await expect(pageB.getByRole("button", { name: "Turn on Drive mode" })).toBeVisible();
  await ctxB.close();
});
