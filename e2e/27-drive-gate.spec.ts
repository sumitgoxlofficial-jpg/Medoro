import { test, expect } from "@playwright/test";
import { db, resetFakeDrive } from "./helpers";

// DriveDB phase 8: a pharmacy that keeps its data in Drive can't bill on a new counter until Drive storage is set up
// (Google Drive itself is "connected" on the test server's fake Drive, so the gate starts at step 2).
test("a Drive pharmacy sets up Drive storage before its first bill", async ({ page }) => {
  const tenant = await db().tenant.findFirstOrThrow({ where: { users: { some: { email: { not: null } } } }, orderBy: { createdAt: "asc" } });
  const before = tenant.settings as Record<string, unknown>;
  try {
    await page.goto("/app/lab");
    await resetFakeDrive(page);
    await db().tenant.update({ where: { id: tenant.id }, data: { settings: { ...before, driveMode: true, driveOnly: true } } });

    // Opening Medoro takes a Drive pharmacy to its counter, which asks for Drive storage first.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/device-pos/);
    await expect(page.getByTestId("drive-gate")).toContainText("Step 2 of 2: set up Drive storage");
    await expect(page.getByRole("button", { name: "Start my pharmacy on this device" })).toHaveCount(0);

    await page.getByRole("button", { name: "Set up Drive storage" }).click();
    await expect(page.getByTestId("recovery-code")).toBeVisible();
    await page.getByLabel(/saved the recovery code/).check();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Start my pharmacy on this device" })).toBeVisible();
  } finally {
    await db().tenant.update({ where: { id: tenant.id }, data: { settings: { ...before, driveMode: false } as object } });
  }
});
