import { describe, expect, it } from "vitest";
import { BRAND, BRAND_FAQ, brandProfiles } from "./brand";
import { searchSite } from "./site-search";
import { brandGraph, SITE_URL } from "@/lib/seo";
import { PRODUCTS } from "@/staff/constants";

describe("brand entity", () => {
  it("publishes only real https profile URLs as sameAs", () => {
    expect(brandProfiles({})).toEqual([]);
    expect(brandProfiles({ BRAND_LINKEDIN_URL: " https://www.linkedin.com/company/medoro ", BRAND_X_URL: "x.com/medoro", BRAND_G2_URL: "" }))
      .toEqual([{ platform: "LinkedIn", url: "https://www.linkedin.com/company/medoro" }]);
  });

  it("links Organization, WebSite and SoftwareApplication in one graph", () => {
    const g = brandGraph()["@graph"];
    const [org, site, app] = ["Organization", "WebSite", "SoftwareApplication"].map((t) => g.find((x) => x["@type"] === t)!);
    expect(org.name).toBe("Medoro");
    expect(org.alternateName).toEqual(["Medoro Pharmacy Software", "Medoro Billing SaaS", "Medoro ERP", "Medoro.in"]);
    expect(org.logo).toMatchObject({ url: `${SITE_URL}/logo.png` });
    expect(org).not.toHaveProperty("sameAs"); // nothing configured in the test environment
    expect(site.publisher).toEqual({ "@id": org["@id"] });
    expect(site.potentialAction).toMatchObject({ "@type": "SearchAction", target: { urlTemplate: `${SITE_URL}/search?q={search_term_string}` } });
    expect(app.name).toBe(BRAND.productName);
    expect(app.offers).toMatchObject({ priceCurrency: "INR", lowPrice: "999", offerCount: 3 });
  });

  it("quotes the plan prices in the pricing answer", () => {
    const answer = BRAND_FAQ.find(([q]) => q.includes("pricing"))![1];
    for (const id of ["starter", "pro", "multi"]) expect(answer).toContain(`₹${PRODUCTS.find((p) => p.id === id)!.m.toLocaleString("en-IN")} a month`);
  });

  it("finds pages through the site search behind the SearchAction", () => {
    expect(searchSite("medical billing saas")[0]?.path).toBe("/medical-billing-saas");
    expect(searchSite("Medoro stock management").map((h) => h.path)).toContain("/medical-store-stock-management-software");
    expect(searchSite("marg").some((h) => h.path.startsWith("/compare/"))).toBe(true);
    expect(searchSite("  ")).toEqual([]);
    expect(searchSite("zzzz no such thing")).toEqual([]);
  });
});
