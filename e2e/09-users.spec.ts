import { test, expect } from "@playwright/test";
import { addEmployee, createStaff, db, expectToast, uid } from "./helpers";

/** Spec 9 · users & roles: invite, role change needing a credential, permission toggle, View as, audit chain. */
test.describe("users & roles", () => {
  test("invite shows a code and can be revoked", async ({ page }) => {
    const contact = `pharm.${uid().toLowerCase()}@e2e-pharmacy.in`;
    const code = await addEmployee(page, { name: "Nikhil Rao", contact, role: "Pharmacist", branch: "Kothrud" });
    await page.getByRole("button", { name: "Dismiss" }).click();
    const inv = page.locator("div").filter({ hasText: code }).filter({ has: page.getByRole("button", { name: "Revoke" }) }).last();
    await expect(inv).toContainText("Pharmacist · Kothrud");
    await inv.getByRole("button", { name: "Revoke" }).click();
    await expectToast(page, "Invite revoked.");
    await expect(page.getByText(code)).toHaveCount(0);
  });

  test("moving a cashier to Manager needs a password", async ({ page, browser }) => {
    const name = `Role Change ${uid()}`;
    const cashier = await createStaff(browser, page, "Cashier", name);
    await page.goto("/app/users");
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Role").selectOption("Manager");
    await expect(dlg.getByLabel("New password (min 10 characters)")).toBeVisible();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expectToast(page, `Set a password for ${name}: managers sign in with email and password.`);
    await dlg.getByLabel("New password (min 10 characters)").fill("Manager-pass-77");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Saved. Their open sessions were signed out.");
    const u = await db().user.findFirstOrThrow({ where: { employeeNo: cashier.employeeNo }, include: { role: true } });
    expect(u.role.name).toBe("Manager");
    expect(u.mfaRequired).toBe(true);
  });

  test("permission toggle is enforced; View as narrows the menu", async ({ page }) => {
    await page.goto("/app/users?tab=roles");
    const cell = page.getByRole("button", { name: "Cashier Discount above 5%" });
    await expect(cell).toHaveAttribute("aria-pressed", "false");
    await cell.click();
    await expectToast(page, "Granted: Cashier · Discount above 5%");
    await expect(cell).toHaveAttribute("aria-pressed", "true");
    await cell.click();
    await expectToast(page, "Revoked: Cashier · Discount above 5%");
    await expect(cell).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Owner Manage users & roles" })).toBeDisabled();

    // View as Cashier: only what a cashier may use
    const nav = page.locator("aside nav");
    await expect(nav.getByRole("link", { name: "Users & branches" })).toBeVisible();
    await page.getByLabel("View as role").selectOption("Cashier");
    await expectToast(page, "Now viewing as Cashier. Menus and actions follow that role.");
    await expect(nav.getByRole("link", { name: "Users & branches" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Accounting & reports" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Purchases" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Billing (POS)" })).toBeVisible();
    await page.goto("/app/accounts");
    await expect(page).toHaveURL(/\/app$/); // server enforces the narrowed role too

    await page.getByLabel("View as role").selectOption("Owner");
    await expectToast(page, "Back to your own role.");
    await expect(nav.getByRole("link", { name: "Users & branches" })).toBeVisible();
  });

  test("audit trail chain verifies", async ({ page }) => {
    await page.goto("/app/users?tab=audit");
    await page.getByRole("button", { name: "Verify chain" }).click();
    await expect(page.getByText(/^Chain verified · \d+ events intact$/)).toBeVisible();
  });
});
