import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkVideoPass, signVideoPass, VIDEO_PASS_COOKIE, videoSlugOf } from "./hrms-video-pass";
import { proxy } from "@/proxy";
import { DEFAULT_PERMS } from "@/staff/hrms/constants";
import { videosFor } from "@/staff/hrms/video-catalog";

const SECRET = "test-only-secret-0123456789abcdef0123";
const hour = 3_600_000;

describe("HRMS video pass", () => {
  it("covers only the listed videos, until it expires", async () => {
    const t = await signVideoPass(SECRET, ["leave", "payroll"], Date.now() + hour);
    expect(await checkVideoPass(SECRET, t, "leave")).toBe(true);
    expect(await checkVideoPass(SECRET, t, "payroll")).toBe(true);
    expect(await checkVideoPass(SECRET, t, "super-admin")).toBe(false);
    expect(await checkVideoPass(SECRET, t, "leave", Date.now() + 2 * hour)).toBe(false); // expired
  });

  it("refuses a forged, edited or foreign pass", async () => {
    const t = await signVideoPass(SECRET, ["leave"], Date.now() + hour);
    const [exp, , sig] = t.split(".");
    expect(await checkVideoPass(SECRET, `${exp}.leave~super-admin.${sig}`, "super-admin")).toBe(false); // added a video
    expect(await checkVideoPass(SECRET, `${Number(exp) + hour}.leave.${sig}`, "leave")).toBe(false); // extended
    expect(await checkVideoPass("another-secret-0123456789abcdef", t, "leave")).toBe(false);
    expect(await checkVideoPass(SECRET, undefined, "leave")).toBe(false);
    expect(await checkVideoPass(SECRET, "junk", "leave")).toBe(false);
    expect(await checkVideoPass("", t, "leave")).toBe(false);
  });

  it("reads the video from a file path and nothing else", () => {
    expect(videoSlugOf("/hrms-videos/files/payroll.mp4")).toBe("payroll");
    expect(videoSlugOf("/hrms-videos/thumbs/payroll.jpg")).toBe("payroll");
    expect(videoSlugOf("/hrms-videos/files/../secret.mp4")).toBeNull();
    expect(videoSlugOf("/hrms-videos/other/payroll.mp4")).toBeNull();
  });

  it("lists videos by role: admin-only and module videos stay with the people who have them", () => {
    const slugs = (role: Parameters<typeof videosFor>[0]) => videosFor(role, DEFAULT_PERMS).map((v) => v.slug);
    expect(slugs("admin")).toHaveLength(20);
    expect(slugs("employee")).toContain("leave");
    expect(slugs("employee")).not.toContain("payroll");
    expect(slugs("employee")).not.toContain("super-admin");
    expect(slugs("hr")).not.toContain("roles-permissions");
  });
});

describe("proxy guards /hrms-videos", () => {
  const prev = process.env.SESSION_SECRET;
  beforeEach(() => { process.env.SESSION_SECRET = SECRET; });
  afterEach(() => { process.env.SESSION_SECRET = prev; });
  const get = (path: string, cookie?: string) => proxy(new NextRequest(`https://medoro.in${path}`, { headers: cookie ? { cookie: `${VIDEO_PASS_COOKIE}=${cookie}` } : {} }));

  it("returns 404 without a pass, or with one that doesn't cover the video", async () => {
    expect((await get("/hrms-videos/files/leave.mp4")).status).toBe(404);
    const t = await signVideoPass(SECRET, ["leave"], Date.now() + hour);
    expect((await get("/hrms-videos/files/payroll.mp4", t)).status).toBe(404);
    expect((await get("/hrms-videos/index.html", t)).status).toBe(404);
  });

  it("lets the file through with a valid pass, privately cached", async () => {
    const t = await signVideoPass(SECRET, ["leave"], Date.now() + hour);
    const r = await get("/hrms-videos/files/leave.mp4", t);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-middleware-next")).toBe("1");
    expect(r.headers.get("cache-control")).toBe("private, max-age=3600");
    expect((await get("/hrms-videos/thumbs/leave.jpg", t)).status).toBe(200);
  });

  it("leaves other paths alone", async () => {
    expect((await get("/videos/files/part-01-introduction-to-medoro.mp4")).status).toBe(200);
  });
});
