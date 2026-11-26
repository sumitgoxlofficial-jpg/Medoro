import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import type { Me } from "@/staff/hrms/auth";
import { DEFAULT_PERMS, type HrRoleId } from "@/staff/hrms/constants";
import { HR_VIDEOS, videosFor } from "@/staff/hrms/video-catalog";
import { videoLinks } from "@/staff/hrms/video-links";
import { contentSecurityPolicy } from "@/server/security-headers";
import { HRMS_VIDEO_FUNCTION } from "@/lib/hrms-video-origin";
import { resetDb } from "./helpers";

const me = (role: HrRoleId) => ({ id: "x", role, perms: DEFAULT_PERMS }) as unknown as Me;
type Call = { url: string; key: string | null; body: { action: string; paths: string[]; expiresIn: number } };
function fakeStorage(status = 200) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, key: new Headers(init.headers).get("x-hrv-key"), body });
    if (status !== 200) return new Response("{}", { status });
    return Response.json({ urls: Object.fromEntries(body.paths.map((p: string) => [p, `https://store.example/${p}?token=t`])) });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

beforeAll(async () => { await resetDb(); });

describe("HRMS training videos", () => {
  it("lists videos by role: module and super-admin videos stay with the people who have them", () => {
    const slugs = (r: HrRoleId) => videosFor(r, DEFAULT_PERMS).map((v) => v.slug);
    expect(slugs("admin")).toHaveLength(HR_VIDEOS.length);
    expect(slugs("employee")).toEqual(expect.arrayContaining(["leave", "attendance", "employee-dashboard"]));
    for (const s of ["payroll", "finance", "super-admin", "roles-permissions", "hr-dashboard"]) expect(slugs("employee")).not.toContain(s);
    expect(slugs("hr")).not.toContain("roles-permissions");
  });

  it("gives no links until the shared secret exists", async () => {
    const s = fakeStorage();
    expect(await videoLinks(me("employee"), s.fetcher)).toBeNull();
    expect(s.calls).toHaveLength(0);
  });

  it("asks storage only for that person's videos, with the secret, and returns a link per video", async () => {
    await db.hrSetting.create({ data: { key: "videoSecret", value: "s".repeat(64) } });
    const s = fakeStorage();
    const links = await videoLinks(me("employee"), s.fetcher);
    const mine = videosFor("employee", DEFAULT_PERMS).map((v) => v.slug);
    expect(Object.keys(links!).sort()).toEqual([...mine].sort());
    expect(links!.leave).toEqual({ video: "https://store.example/files/leave.mp4?token=t", thumb: "https://store.example/thumbs/leave.jpg?token=t" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ url: HRMS_VIDEO_FUNCTION, key: "s".repeat(64), body: { action: "sign", expiresIn: 4 * 3600 } });
    expect(s.calls[0].body.paths).not.toContain("files/payroll.mp4");
    expect(s.calls[0].body.paths).not.toContain("files/super-admin.mp4");
  });

  it("reports storage trouble as no links instead of failing the page", async () => {
    expect(await videoLinks(me("admin"), fakeStorage(401).fetcher)).toBeNull();
    const down = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    expect(await videoLinks(me("admin"), down)).toBeNull();
  });

  it("lets HRMS pages, and only them, play from the video storage", () => {
    const origin = new URL(HRMS_VIDEO_FUNCTION).origin;
    const hr = contentSecurityPolicy({ nonce: "n", https: true, path: "/staff/hrms/hrvideos" });
    expect(hr).toMatch(new RegExp(`media-src [^;]*${origin.replace(/\./g, "\\.")}`));
    expect(hr).toMatch(new RegExp(`img-src [^;]*${origin.replace(/\./g, "\\.")}`));
    expect(contentSecurityPolicy({ nonce: "n", https: true, path: "/app/pos" })).not.toContain(origin);
  });
});
