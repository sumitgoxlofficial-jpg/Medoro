import { test, expect } from "@playwright/test";
import { answerDialogs, expectToast, rowOf, uid } from "./helpers";

/** Spec 8 · accounting & reports: P&L and day book, expense with reversal, every CSV report. */
test.describe("accounting", () => {
  test("P&L and day book; post an expense and reverse it", async ({ page }) => {
    const note = `Diwali lights ${uid()}`;
    answerDialogs(page, "Entered twice by mistake");
    await page.goto("/app/accounts");
    await expect(page.getByText("Profit & loss", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Net profit before tax")).toBeVisible();
    await expect(page.getByText("GST summary", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Day book", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Record expense" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Category").selectOption({ index: 0 });
    await dlg.getByLabel("Amount ₹").fill("250");
    await dlg.getByLabel("Paid by").selectOption("UPI");
    await dlg.getByLabel("Note").fill(note);
    await dlg.getByRole("button", { name: "Post voucher" }).click();
    await expectToast(page, /posted\.$/);

    const row = rowOf(page, note).first();
    await expect(row).toContainText("₹250.00");
    await row.getByRole("button", { name: "Reverse" }).click();
    await expectToast(page, /reversed by .*\. Original kept for audit\./);
    await expect(rowOf(page, note).getByText("Reversed")).toBeVisible();
    await expect(page.getByText("Reversal", { exact: true }).first()).toBeVisible();
  });

  test("every CSV report downloads with a header row", async ({ page }) => {
    await page.goto("/app/accounts");
    const links = page.getByRole("link", { name: "CSV" });
    const n = await links.count();
    expect(n).toBeGreaterThan(5);
    for (const period of ["month", "fy"]) {
      for (let i = 0; i < n; i++) {
        const href = (await links.nth(i).getAttribute("href"))!.replace(/period=[a-z]+/, `period=${period}`);
        const res = await page.request.get(href);
        expect(res.status(), href).toBe(200);
        expect(res.headers()["content-type"], href).toContain("text/csv");
        expect(res.headers()["content-disposition"], href).toMatch(/attachment; filename=".+\.csv"/);
        const head = (await res.text()).replace(/^\uFEFF/, "").split(/\r?\n/)[0];
        expect(head.split(",").length, `${href}: ${head}`).toBeGreaterThan(1);
      }
    }
    // A real download through the browser, too.
    const [dl] = await Promise.all([page.waitForEvent("download"), links.first().click()]);
    expect(dl.suggestedFilename()).toMatch(/\.csv$/);
  });
});
