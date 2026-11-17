import { test, expect } from "@playwright/test";

/** Spec 31 · Medoro 2.0: Integration Health Centre and Supplier intelligence screens render real states and honest empties. */
test.describe("medoro 2.0 screens", () => {
  test("integration health shows explicit states and never Active for untested services", async ({ page }) => {
    await page.goto("/app/health");
    await expect(page.getByRole("heading", { name: "Integration health" }).first()).toBeVisible();
    await expect(page.getByTestId("health-list")).toBeVisible();
    // Fresh pharmacy: nothing external is configured, so none of these may show a working state.
    for (const k of ["gdrive", "whatsapp", "ocr", "ai"]) await expect(page.getByTestId(`health-state-${k}`)).toHaveText("Not configured");
    // The database check is a real round trip.
    await expect(page.getByTestId("health-state-database")).toHaveText("Active");
    // An explicit test of an unconfigured service refuses and stores a failure, it never passes.
    await page.getByTestId("health-run-ocr").click();
    await expect(page.getByTestId("health-state-ocr")).not.toHaveText("Active");
    await expect(page.getByTestId("health-state-ocr")).not.toHaveText("Tested");
    // No row anywhere is Active without a recent test timestamp.
    const rows = page.locator("[data-testid^='health-state-']");
    for (let i = 0; i < await rows.count(); i++) {
      const text = await rows.nth(i).innerText();
      if (text === "Active") await expect(page.locator("section").nth(i)).not.toContainText("Last test: never");
    }
  });

  test("health is in the System navigation", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("link", { name: /Integration health|Health/ }).first()).toBeVisible();
  });

  test("supplier intelligence explains an empty history instead of inventing a ranking", async ({ page }) => {
    await page.goto("/app/intelligence");
    await page.waitForLoadState("networkidle"); // let the page hydrate before clicking
    await page.getByTestId("supplier-intel-link").click();
    await expect(page).toHaveURL(/\/app\/intelligence\/suppliers/);
    await expect(page.getByRole("heading", { name: "Supplier intelligence" }).first()).toBeVisible();
    await expect(page.getByTestId("supplier-ranking")).toBeVisible();
    await expect(page.getByTestId("supplier-recommendations")).toContainText(/Not enough history yet|→/);
  });

  test("customer intelligence shows honest empties and never offers messaging", async ({ page }) => {
    await page.goto("/app/intelligence/customers");
    await expect(page.getByRole("heading", { name: "Customer intelligence" }).first()).toBeVisible();
    await expect(page.getByTestId("cust-totals")).toBeVisible();
    await expect(page.getByTestId("cust-segments")).toContainText("Lapsed");
    await expect(page.getByTestId("cust-refills")).toContainText("Nothing is sent from this screen");
    await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);
  });

  test("profit intelligence states its basis and reconciliation, and rejects a bad period", async ({ page }) => {
    await page.goto("/app/intelligence/profit");
    await expect(page.getByRole("heading", { name: "Profit intelligence" }).first()).toBeVisible();
    await expect(page.getByTestId("profit-basis")).toContainText("not MRP minus purchase price");
    await expect(page.getByTestId("profit-branches")).toContainText(/Reconciled|Differs by/);
    await expect(page.getByTestId("profit-leakage")).toContainText("Sold below landed cost");
    await page.goto("/app/intelligence/profit?from=2026-11-10&to=2026-11-01");
    await expect(page.getByText(/start date is after the end date/)).toBeVisible();
  });

  test("chain benchmarking states its definitions and the single-branch case", async ({ page }) => {
    await page.goto("/app/intelligence/benchmark");
    await expect(page.getByRole("heading", { name: "Chain benchmarking" }).first()).toBeVisible();
    await expect(page.getByTestId("bench-table")).toContainText("Stock turnover is cost of goods sold, annualised");
    await expect(page.getByTestId("bench-table")).toContainText("not recorded, so this is an approximation");
  });

  test("recall reports: notice by manufacturer, honest source wording, quarantine setting", async ({ page }) => {
    await page.goto("/app/recalls");
    await page.getByTestId("recall-reports-link").click();
    await expect(page.getByRole("heading", { name: "Recall reports" }).first()).toBeVisible();
    await expect(page.getByText(/no government feed is connected/i)).toBeVisible();
    await expect(page.getByTestId("auto-quarantine-toggle")).toBeVisible();
    await page.getByLabel("Manufacturer").fill("Acme Pharma");
    await page.getByLabel("Product", { exact: true }).fill("Testamol");
    await page.getByLabel("Batch numbers").fill("E2E-77");
    await page.getByLabel("Source").fill("CDSCO alert E2E");
    await page.getByLabel("Published on").fill(new Date().toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Record notice" }).click();
    await expect(page.getByText(/Recorded RC-/)).toBeVisible();
    await page.reload();
    await page.getByTestId("recall-list").getByRole("link", { name: /^RC-/ }).first().click();
    await expect(page.getByTestId("recall-notice")).toContainText("Medoro does not fetch notices from any government feed");
    await expect(page.getByTestId("recall-trace")).toContainText("Affected quantity");
    await expect(page.getByTestId("recall-audit")).toContainText("Recall notice recorded");
  });

  test("compliance centre: disclaimer, requirement gaps, add a licence, status changes", async ({ page }) => {
    await page.goto("/app/compliance");
    await expect(page.getByRole("heading", { name: "Compliance centre" }).first()).toBeVisible();
    await expect(page.getByTestId("compliance-disclaimer")).toContainText("does not tell you what the law requires");
    await expect(page.getByTestId("compliance-branches")).toContainText("Missing:");
    await page.getByText("Add a licence or registration").click();
    const f = page.getByTestId("item-form");
    await f.getByLabel("Title").fill("E2E retail licence");
    await f.getByLabel("Number").fill("E2E-RL-1");
    const soon = new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10);
    await f.getByLabel("Expires on").fill(soon);
    await f.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("compliance-items")).toContainText("E2E retail licence");
    await expect(page.getByTestId("compliance-items")).toContainText("Renewal due");
    await expect(page.getByTestId("compliance-retention")).toContainText("Medoro does not assume any");
  });
});
