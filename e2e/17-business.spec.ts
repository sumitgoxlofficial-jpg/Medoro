import { test, expect } from "@playwright/test";
import { anonContext, db, tenant, uid } from "./helpers";

/** Spec 17 · business: Plan page, trial banner and read-only lifecycle, Help inbox, website /start lead form. */
test.describe("business", () => {
  test("Plan page and Help inbox render for an unlicensed install", async ({ page }) => {
    await page.goto("/app/plan");
    await expect(page.getByRole("heading", { name: "Subscription" })).toBeVisible();
    await expect(page.getByText("Current plan")).toBeVisible();
    await expect(page.getByText(/isn’t connected to Medoro’s licence server/)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /trial|Subscription expired/ })).toHaveCount(0); // never limited

    await page.locator("aside nav").getByRole("link", { name: "Help" }).click();
    await expect(page).toHaveURL(/\/app\/help$/);
    await expect(page.getByText("Support inbox")).toBeVisible();
    await expect(page.getByText(/tickets can’t be sent from here/)).toBeVisible();
  });

  test("trial ending shows a banner; after grace the app turns read-only but exports still work", async ({ page }) => {
    const t = await tenant();
    const before = await db().subscriptionMeta.findUniqueOrThrow({ where: { tenantId: t.id } });
    // A signed licence document is what moves an install from "unlicensed" into the trial/paid lifecycle.
    const set = (renewsAt: Date) => db().subscriptionMeta.update({ where: { tenantId: t.id }, data: { status: "trial", renewsAt, graceDays: 7, signedDoc: before.signedDoc ?? "{}" } });
    try {
      await set(new Date(Date.now() + 2 * 86400_000));
      await page.goto("/app");
      const banner = page.getByRole("status").filter({ hasText: "Free trial ends in 2 days. Renew from Plan to keep billing." });
      await expect(banner).toBeVisible();
      await expect(banner.getByRole("link", { name: "Renew" })).toHaveAttribute("href", "/app/plan");

      await set(new Date(Date.now() - 3 * 86400_000));
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: /Free trial has ended\. \d+ days? left before Medoro becomes read-only/ })).toBeVisible();

      await set(new Date(Date.now() - 30 * 86400_000));
      await page.goto("/app/inventory");
      await expect(page.getByRole("status").filter({ hasText: "Subscription expired — renew." })).toBeVisible();
      await page.getByRole("button", { name: "Add medicine" }).first().click();
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Brand name *").fill(`Locked ${uid()}`);
      await dlg.getByLabel("Generic / salt *").fill("Paracetamol");
      await dlg.getByLabel("Strength *").fill("500 mg");
      await dlg.getByLabel("Manufacturer *").fill("E2E Labs");
      await dlg.getByLabel("MRP per pack ₹ *").fill("20");
      await dlg.getByRole("button", { name: "Save medicine" }).click();
      await expect(dlg.getByText(/^Subscription expired — renew from Plan\./)).toBeVisible();
      // Full exports are rate-limited per user (3 an hour); earlier specs already downloaded with this owner.
      await db().rateLimit.deleteMany({ where: { key: { startsWith: "fullExport:" } } });
      expect((await page.request.get("/api/export")).status()).toBe(200);
    } finally {
      await db().subscriptionMeta.update({ where: { tenantId: t.id }, data: { status: before.status, renewsAt: before.renewsAt, graceDays: before.graceDays, signedDoc: before.signedDoc } });
    }
    await page.goto("/app");
    await expect(page.getByRole("status").filter({ hasText: /Free trial|Subscription expired/ })).toHaveCount(0);
  });

  test("website /start form creates a lead for the sales team", async ({ browser }) => {
    const ctx = await anonContext(browser);
    const page = await ctx.newPage();
    const phone = `97${Date.now().toString().slice(-8)}`, pharmacy = `Om Medical ${uid()}`;
    await page.goto("/");
    await page.goto("/start");
    await expect(page.getByRole("heading", { name: "Start your Medoro trial" })).toBeVisible();
    await expect(page.getByText("This server isn’t set up yet.")).toHaveCount(0); // a pharmacy exists already
    await page.getByLabel("Your name").fill("Ravi Deshpande");
    await page.getByLabel("Pharmacy name").fill(pharmacy);
    await page.getByLabel("Mobile (WhatsApp)").fill("12345");
    await page.getByLabel("City").fill("Nashik");
    await page.getByRole("button", { name: "Start free trial" }).click();
    await expect(page.getByText("Enter a valid 10-digit mobile number.")).toBeVisible();
    await page.getByLabel("Mobile (WhatsApp)").fill(phone);
    await page.getByRole("button", { name: "Start free trial" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Thanks, Ravi!" })).toBeVisible();
    const lead = await db().lead.findUniqueOrThrow({ where: { phone } });
    expect(lead.name).toBe(pharmacy);
    expect(lead.source).toBe("Website trial");
    expect(lead.stage).toBe("new");
    await ctx.close();
  });
});
