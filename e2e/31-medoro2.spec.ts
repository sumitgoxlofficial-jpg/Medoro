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
    await page.getByTestId("supplier-intel-link").click();
    await expect(page).toHaveURL(/\/app\/intelligence\/suppliers/);
    await expect(page.getByRole("heading", { name: "Supplier intelligence" }).first()).toBeVisible();
    await expect(page.getByTestId("supplier-ranking")).toBeVisible();
    await expect(page.getByTestId("supplier-recommendations")).toContainText(/Not enough history yet|→/);
  });
});
