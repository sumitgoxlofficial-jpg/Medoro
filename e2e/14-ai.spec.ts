import { test, expect } from "@playwright/test";
import { importMedicines, uid } from "./helpers";

/** Spec 14 · AI assistant drawer: Ctrl+J opens it; answers a stock question from local data; refuses clinical questions. */
test("Ctrl+J assistant answers a stock question and refuses a clinical one", async ({ page }) => {
  const med = `Ai Zyrtec ${uid()}`;
  await importMedicines(page, [{ name: med, generic: "Cetirizine", strength: "10 mg", mrp: 40, batch: `AZ${uid()}`, expiry: "09/2031", qty: 17, cost: 25 }]);

  await page.goto("/app");
  const drawer = page.getByRole("complementary", { name: "Medoro AI" });
  await expect(drawer).toBeHidden();
  await page.locator("body").click();
  await page.keyboard.press("Control+j");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Runs on your server, no AI model needed.")).toBeVisible();

  const ask = drawer.getByLabel("Ask Medoro AI");
  await expect(ask).toBeFocused();
  await ask.fill(`stock of ${med}`);
  await ask.press("Enter");
  const answer = drawer.locator("div.self-start.flex-col").filter({ hasText: "search_medicines" }).last();
  await expect(answer).toBeVisible();
  await expect(answer).toContainText(med);
  await expect(answer).toContainText("17");

  await ask.fill("What dose of paracetamol should I give my 5 year old?");
  await ask.press("Enter");
  await expect(drawer.getByText("I can’t give clinical advice. Please check with the pharmacist on duty or the prescriber.")).toBeVisible();

  await page.keyboard.press("Control+j");
  await expect(drawer).toBeHidden();
});
