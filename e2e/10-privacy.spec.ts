import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { anonContext, answerDialogs, db, expectToast, tenant, uid } from "./helpers";

/** Spec 10 · privacy: full export, customer erasure, read-only support access. */
test.describe("privacy & data", () => {
  test("full export downloads JSON of the pharmacy's data", async ({ page }) => {
    await page.goto("/app/privacy");
    await expect(page.getByText("Strict customer-controlled mode is on")).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export all pharmacy data (JSON)" }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^medoro-export-\d{4}-\d{2}-\d{2}\.json$/);
    const raw = readFileSync(await dl.path(), "utf8");
    const data = JSON.parse(raw);
    expect(typeof data).toBe("object");
    expect(raw).toContain((await tenant()).code);
    expect(raw).not.toMatch(/"passwordHash"\s*:\s*"\$argon/);
    expect(raw).not.toMatch(/"pinHash"\s*:\s*"\$argon/);
  });

  test("customer erasure removes name and phone", async ({ page }) => {
    const name = `Erase Me ${uid()}`;
    answerDialogs(page);
    await page.goto("/app/parties?tab=cus");
    await page.getByRole("button", { name: "Add customer" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name *").fill(name);
    await dlg.getByLabel("Mobile").fill(`98${Date.now().toString().slice(-8)}`);
    await dlg.getByRole("button", { name: "Save customer" }).click();
    await expectToast(page, "Customer added.");
    const c = await db().customer.findFirstOrThrow({ where: { name } });

    await page.goto("/app/privacy");
    await page.getByLabel("Customer to erase").selectOption(c.id);
    await page.getByRole("button", { name: "Erase personal data" }).click();
    await expectToast(page, "Personal details erased. Tax invoices are kept with an anonymised party.");
    const after = await db().customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.name).not.toContain("Erase Me");
    expect(after.phone).toBeNull();
    expect(after.erasedAt).not.toBeNull();
  });

  test("support access link: read-only session can look but not change or download", async ({ page, browser }) => {
    await page.goto("/app/privacy");
    await page.getByLabel("Reason or ticket number").fill("TK-1182 · printer cuts receipts");
    await page.getByRole("button", { name: /Give support access|Replace with a new link/ }).click();
    await expect(page.getByText("Send this link to Medoro support (it’s shown only once)")).toBeVisible();
    const link = (await page.locator("code").filter({ hasText: "/support/" }).innerText()).trim();
    expect(link).toMatch(/\/support\/[A-Za-z0-9_-]+$/);

    const sctx = await anonContext(browser);
    const sp = await sctx.newPage();
    await sp.goto(new URL(link).pathname);
    await expect(sp.getByText("TK-1182 · printer cuts receipts", { exact: false })).toBeVisible();
    await sp.getByRole("button", { name: "Start read-only session" }).click();
    await expect(sp).toHaveURL(/\/app$/);
    await expect(sp.getByText("Medoro support · read-only")).toBeVisible();

    // Can look…
    await sp.goto("/app/inventory");
    await expect(sp.getByRole("heading", { name: "Inventory" })).toBeVisible();
    // …but can't change anything…
    await sp.goto("/app/parties?tab=cus");
    await sp.getByRole("button", { name: "Add customer" }).first().click();
    const dlg = sp.getByRole("dialog");
    await dlg.getByLabel("Name *").fill(`Support Was Here ${uid()}`);
    await dlg.getByRole("button", { name: "Save customer" }).click();
    await expect(dlg.getByText("Medoro support access is read-only. Ask the pharmacy owner to make this change.")).toBeVisible();
    expect(await db().customer.count({ where: { name: { startsWith: "Support Was Here" } } })).toBe(0);
    // …or download.
    for (const url of ["/api/export", "/api/reports/sales?period=month"]) {
      const r = await sp.request.get(url);
      expect(r.status(), url).toBe(403);
    }
    // The link works once.
    const again = await anonContext(browser);
    const ap = await again.newPage();
    await ap.goto(new URL(link).pathname);
    await expect(ap.getByText(/expired, was revoked or was already used/)).toBeVisible();
    await again.close();

    // The owner sees it and ends it; the support session is signed out.
    await page.reload();
    await expect(page.getByText("Support signed in")).toBeVisible();
    await page.getByRole("button", { name: "End access now" }).click();
    await expectToast(page, "Support access ended. Their session is signed out.");
    await sp.goto("/app");
    await expect(sp).toHaveURL(/\/signin/);
    await sctx.close();
  });
});
