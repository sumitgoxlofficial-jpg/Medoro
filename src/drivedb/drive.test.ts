import { describe, expect, it } from "vitest";
import { googleStore, DriveAuthError } from "./drive";

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string>; bytes?: Uint8Array }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body };
    calls.push(c);
    const r = handler(c);
    const body = r.bytes ?? (r.json !== undefined ? JSON.stringify(r.json) : r.text ?? "");
    return new Response(body as BodyInit, { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const access = () => ({ token: "tok", folderId: "folder'1" });

describe("Google Drive store", () => {
  it("lists every page, inside the folder, escaping names, and filters by prefix", async () => {
    const { f, calls } = fakeFetch((c) => {
      const p = new URL(c.url).searchParams;
      return p.get("pageToken") ? { json: { files: [{ id: "2", name: "log-b" }, { id: "3", name: "xlog-c" }] } } : { json: { files: [{ id: "1", name: "log-a" }], nextPageToken: "n" } };
    });
    const s = googleStore(access, f);
    expect((await s.list("log-")).map((x) => x.id)).toEqual(["1", "2"]);
    const q = new URL(calls[0].url).searchParams.get("q")!;
    expect(q).toContain("'folder\\'1' in parents");
    expect(q).toContain("trashed = false");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
  });

  it("uploads small files as multipart and replaces by id with PATCH", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: "new" } }));
    const s = googleStore(access, f);
    expect(await s.write("manifest.json", new Uint8Array([1, 2, 3]))).toBe("new");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("uploadType=multipart");
    const body = new TextDecoder("latin1").decode(calls[0].body as Uint8Array);
    expect(body).toContain('"name":"manifest.json"');
    expect(body).toContain('"parents":["folder\'1"]');
    await s.write("manifest.json", new Uint8Array([4]), "abc");
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].url).toContain("/files/abc?uploadType=multipart");
    expect(new TextDecoder("latin1").decode(calls[1].body as Uint8Array)).not.toContain("parents");
  });

  it("uploads large files through a resumable session", async () => {
    const { f, calls } = fakeFetch((c) => (c.url.includes("uploadType=resumable") ? { headers: { Location: "https://upload.example/session" } } : { json: { id: "big" } }));
    const s = googleStore(access, f);
    const big = new Uint8Array(6 * 1024 * 1024);
    expect(await s.write("pharmacy.db.enc", big)).toBe("big");
    expect(calls[0].headers["X-Upload-Content-Length"]).toBe(String(big.length));
    expect(calls[1]).toMatchObject({ url: "https://upload.example/session", method: "PUT" });
  });

  it("reads bytes, ignores deleting a missing file, and reports refused access clearly", async () => {
    const { f } = fakeFetch((c) => (c.method === "DELETE" ? { status: 404 } : c.url.includes("denied") ? { status: 401 } : { bytes: new Uint8Array([9, 8]) }));
    const s = googleStore(access, f);
    expect(await s.read("x")).toEqual(new Uint8Array([9, 8]));
    await expect(s.remove("gone")).resolves.toBeUndefined();
    await expect(s.read("denied")).rejects.toThrow(DriveAuthError);
  });
});
