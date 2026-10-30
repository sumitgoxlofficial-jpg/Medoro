import { test, expect, type Page } from "@playwright/test";

/** Spec 15 · marketing site, legal pages and app navigation: everything renders and no internal link is broken. */
const internal = async (page: Page, scope = "body") =>
  (await page.locator(`${scope} a[href]`).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href)))
    .filter((h) => h.startsWith(new URL(page.url()).origin))
    .map((h) => { const u = new URL(h); return u.pathname + u.search; });

test.describe("site", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("marketing and legal pages render; their internal links work", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page).toHaveTitle(/Medoro/);
    await expect(page.getByRole("heading").first()).toBeVisible();
    const fromHome = await internal(page);
    await page.goto("/legal");
    await expect(page.getByRole("heading").first()).toBeVisible();
    for (const id of ["terms", "privacy", "grievance"]) await expect(page.locator(`#${id}`)).toBeAttached();
    const fromLegal = await internal(page);
    const links = [...new Set([...fromHome, ...fromLegal])];
    expect(links).toEqual(expect.arrayContaining(["/legal", "/signin"]));
    for (const l of links) {
      const r = await page.request.get(l);
      expect(r.status(), l).toBeLessThan(400);
    }
    expect(errors).toEqual([]);
  });

  test("unknown pages are a proper 404", async ({ page }) => {
    const r = await page.goto("/no-such-page-here");
    expect(r?.status()).toBe(404);
  });
});

test("every app screen in the owner's navigation loads, and its links work", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app");
  const nav = await internal(page, "aside nav");
  expect(nav.length).toBeGreaterThan(12);
  const seen = new Set<string>(nav);
  for (const href of nav) {
    const r = await page.goto(href);
    expect(r?.status(), href).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 }), href).toBeVisible();
    for (const l of await internal(page, "main")) seen.add(l);
  }
  for (const l of seen) {
    if (l.startsWith("/api/integrations/google/")) continue; // leaves for Google sign-in when configured
    const r = await page.request.get(l, { maxRedirects: 5 });
    expect(r.status(), l).toBeLessThan(400);
  }
  expect(errors).toEqual([]);
});
