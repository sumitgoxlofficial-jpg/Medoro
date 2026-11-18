import { test, expect } from "@playwright/test";
import { driveModeOn, importMedicines, monthsAhead, openTab, uid } from "./helpers";

// Drive mode: the statistical forecast is worked out on the counter. A brand-new counter has no history, so the screen must say
// so, show the estimate disclaimer and the accuracy section, and must not invent a number.
test("counter Insights: the statistical forecast card says it is an estimate and shows no forecast without history", async ({ page }) => {
  const name = `Fc ${uid()}`;
  await importMedicines(page, [{ name, mrp: 112, batch: `B${uid()}`, expiry: monthsAhead(24).slash, qty: 30, cost: 70 }]);
  await driveModeOn(page);
  await page.goto("/app/device-pos");
  await page.getByRole("button", { name: "Load catalogue onto this device" }).click();
  await expect(page.getByText(/Loaded \d+ medicines/)).toBeVisible();

  await openTab(page, "Insights");
  const card = page.getByTestId("device-forecast");
  await expect(card).toBeVisible();
  await expect(card.getByText("Statistical demand forecast")).toBeVisible();
  await expect(page.getByTestId("device-forecast-disclaimer")).toContainText("not facts and not machine learning");
  await expect(page.getByTestId("device-forecast-accuracy")).toContainText("No forecast has been made and then checked yet");
  await expect(card.getByText(/No medicine has enough history yet/)).toBeVisible();
  await expect(card.getByRole("table")).toHaveCount(0); // no table of invented numbers
});
