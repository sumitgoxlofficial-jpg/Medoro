import { test, expect, type Page } from "@playwright/test";
import { OWNER_STATE, addToCart, completeSale, importMedicines, uid } from "./helpers";

/** Spec 12 · live sync: a sale on one device updates the dashboard on another within seconds, without a reload. */
test("a sale in one browser updates the dashboard in another", async ({ page, browser }) => {
  const med = `Live Vicks ${uid()}`;
  await importMedicines(page, [{ name: med, generic: "Menthol", strength: "25 g", form: "Ointment", mrp: 95, gst: 18, batch: `LV${uid()}`, expiry: "10/2031", qty: 10, cost: 60 }]);

  const watcher = await browser.newContext({ storageState: OWNER_STATE });
  const dash = await watcher.newPage();
  await dash.goto("/app");
  await expect(dash.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
  const bills = async (p: Page) => Number((await p.getByText(/\d+ bills?$/).first().innerText()).match(/(\d+) bills?$/)![1]);
  const before = await bills(dash);
  await dash.evaluate(() => { (window as unknown as { __kept: number }).__kept = 1; });

  await page.goto("/app/pos");
  await addToCart(page, med);
  await completeSale(page);

  await expect.poll(() => bills(dash), { timeout: 10_000, intervals: [250, 500, 1000] }).toBe(before + 1);
  expect(await dash.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1); // refreshed in place, not reloaded
  await watcher.close();
});
