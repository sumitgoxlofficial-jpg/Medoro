import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));
const { CHUNK, MULTIPART_MAX, uploadToDrive } = await import("./gdrive");

type Call = { url: string; init: RequestInit };
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(status === 308 ? null : JSON.stringify(body), { status, headers });

describe("uploadToDrive", () => {
  it("uses one multipart request for small files", async () => {
    const calls: Call[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return res(200, { id: "small" }); });
    expect(await uploadToDrive("tok", "folder", "a.mdrbak", Buffer.alloc(1024), f as unknown as typeof fetch)).toBe("small");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("uploadType=multipart");
  });

  it("uploads large files in 256 KiB-aligned chunks and resumes from the Range Drive reports", async () => {
    const size = Math.max(MULTIPART_MAX, 3 * CHUNK) + 1000;
    const calls: Call[] = [];
    let put = 0;
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("uploadType=resumable")) return res(200, {}, { location: "https://upload.example/session" });
      put++;
      // Second PUT: Drive only kept part of the chunk, so the next one must restart from there.
      if (put === 1) return res(308, null, { range: `bytes=0-${CHUNK - 1}` });
      if (put === 2) return res(308, null, { range: `bytes=0-${CHUNK + 262144 - 1}` });
      const [, , end] = /bytes (\d+)-(\d+)\//.exec((init.headers as Record<string, string>)["Content-Range"])!;
      return Number(end) === size - 1 ? res(201, { id: "big" }) : res(308, null, { range: `bytes=0-${end}` });
    });
    expect(await uploadToDrive("tok", "folder", "b.mdrbak", Buffer.alloc(size), f as unknown as typeof fetch)).toBe("big");
    const ranges = calls.slice(1).map((c) => (c.init.headers as Record<string, string>)["Content-Range"]);
    expect(ranges[0]).toBe(`bytes 0-${CHUNK - 1}/${size}`);
    expect(ranges[1]).toBe(`bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`);
    expect(ranges[2]).toBe(`bytes ${CHUNK + 262144}-${Math.min(2 * CHUNK + 262144, size) - 1}/${size}`);
    expect(CHUNK % (256 * 1024)).toBe(0);
    expect(ranges.at(-1)).toMatch(new RegExp(`-${size - 1}/${size}$`));
  });

  it("throws a clear error when Drive refuses the upload", async () => {
    const f = vi.fn(async (url: string) => url.includes("resumable") ? res(200, {}, { location: "https://upload.example/s" }) : res(403, { error: { message: "Storage quota exceeded" } }));
    await expect(uploadToDrive("tok", "folder", "c", Buffer.alloc(MULTIPART_MAX + 1), f as unknown as typeof fetch)).rejects.toThrow(/403 \(Storage quota exceeded\)/);
  });
});
