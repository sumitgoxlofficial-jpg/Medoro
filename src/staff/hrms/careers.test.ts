import { describe, expect, it } from "vitest";
import { slugify, sourceOf, applicationRef } from "./careers";
import { careersPath } from "@/server/applicant";

describe("careers", () => {
  it("makes readable job links", () => {
    expect(slugify("Customer Success Executive (Hindi)")).toBe("customer-success-executive-hindi");
    expect(slugify("  Sr. Developer — Next.js / React ")).toBe("sr-developer-nextjs-react");
    expect(slugify("!!!")).toBe("job");
  });

  it("records where an application came from", () => {
    expect(sourceOf("linkedin")).toBe("linkedin");
    expect(sourceOf("LinkedIn_jobs")).toBe("linkedin");
    expect(sourceOf("naukri")).toBe("naukri");
    expect(sourceOf("some-blog")).toBe("other");
    expect(sourceOf("", "linkedin")).toBe("linkedin");
    expect(sourceOf("", "google")).toBe("website");
    expect(sourceOf(null)).toBe("website");
    expect(sourceOf("hr")).toBe("other"); // the public page can't pretend HR added someone
  });

  it("only returns to careers pages after sign-in", () => {
    expect(careersPath("/careers/sales-executive?apply=sales-executive&src=linkedin")).toBe("/careers/sales-executive?apply=sales-executive&src=linkedin");
    expect(careersPath("/careers/applications")).toBe("/careers/applications");
    expect(careersPath("https://evil.example/careers")).toBe("/careers");
    expect(careersPath("//evil.example")).toBe("/careers");
    expect(careersPath("/app")).toBe("/careers");
    expect(careersPath(null)).toBe("/careers");
  });

  it("gives a short application reference", () => {
    expect(applicationRef("3f2a9c1e-0000-4000-8000-000000000000")).toBe("MED-3F2A9C1E");
  });
});
