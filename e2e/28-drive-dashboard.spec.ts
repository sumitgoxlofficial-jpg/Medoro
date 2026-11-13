import { test, expect } from "@playwright/test";
import { db, openTab, resetFakeDrive } from "./helpers";

// A Drive pharmacy's Dashboard and every sidebar screen open the matching counter tab, on the counter's own data.
test("a Drive pharmacy's Dashboard and sidebar work from the counter's data", async ({ page }) => {
  const tenant = await db().tenant.findFirstOrThrow({ where: { users: { some: { email: { not: null } } } }, orderBy: { createdAt: "asc" } });
  const before = tenant.settings as Record<string, unknown>;
  try {
    await page.goto("/app/lab");
    await resetFakeDrive(page);
    await db().tenant.update({ where: { id: tenant.id }, data: { settings: { ...before, driveMode: true, driveOnly: true } } });

    await page.goto("/app");
    await page.getByRole("button", { name: "Set up Drive storage" }).click();
    await page.getByLabel(/saved the recovery code/).check();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Start my pharmacy on this device" }).click();

    // Dashboard (in the sidebar) opens the counter's dashboard.
    await page.locator("nav").getByRole("link", { name: "Billing (POS)" }).click();
    // Billing shows only the bill: no counter tab row (the sidebar is the way out).
    await expect(page).toHaveURL(/tab=bill/);
    await expect(page.getByLabel("Search medicine")).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await page.locator("nav").getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/app\/device-pos\?tab=dash/);
    const dash = page.getByTestId("device-dashboard");
    await expect(dash).toContainText("Sales today");
    await expect(dash).toContainText("Sales, last 14 days");
    await expect(dash).toContainText("Low stock");
    // Its own heading, like Medoro's dashboard: title, date and branch, period and Export.
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByText("Billing on this device")).toHaveCount(0);
    await expect(dash.getByRole("button", { name: "Export" })).toBeVisible();
    await dash.getByRole("button", { name: "7D" }).click();
    await expect(dash).toContainText(/Sales\b/);

    // The sidebar opens counter tabs (Cheques is one now).
    const nav = page.locator("nav");
    await nav.getByRole("link", { name: "Cheques" }).click();
    await expect(page).toHaveURL(/tab=cheques/);
    await expect(page.getByText("Cheques in hand (not cleared)")).toBeVisible();
    await nav.getByRole("link", { name: "Inventory" }).click();
    await expect(page).toHaveURL(/tab=stock/);
    await nav.getByRole("link", { name: "Purchases" }).click();
    await expect(page).toHaveURL(/tab=purchases/);
    // Switching tabs on the counter moves the sidebar highlight with it.
    await openTab(page, "Dashboard");
    await expect(page).toHaveURL(/tab=dash/);
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveClass(/font-semibold/);
  } finally {
    await db().tenant.update({ where: { id: tenant.id }, data: { settings: { ...before, driveMode: false, driveOnly: false } as object } });
  }
});
