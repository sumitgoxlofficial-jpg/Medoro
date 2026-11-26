import { describe, expect, it } from "vitest";
import { TOUR_VIDEOS } from "./tour-videos";
import { YOUTUBE_IDS, youtubeId } from "./tour-youtube";

describe("tour YouTube IDs", () => {
  it("are keyed by real part slugs", () => {
    const parts = new Set(TOUR_VIDEOS.filter((v) => v.kind === "part").map((v) => v.slug));
    for (const slug of Object.keys(YOUTUBE_IDS)) expect(parts.has(slug), slug).toBe(true);
  });
  it("are plain 11-character IDs, not links", () => {
    for (const [slug, id] of Object.entries(YOUTUBE_IDS)) expect(id, slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });
  it("ignores a part with no ID", () => {
    expect(youtubeId("no-such-part")).toBeUndefined();
  });
});
