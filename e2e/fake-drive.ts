import type { BrowserContext, Route } from "@playwright/test";

/**
 * A tiny in-memory stand-in for the Google Drive API, enough for DriveDB: list/find by name, download,
 * multipart and resumable upload (create and replace), delete. Shared across browser contexts, so a
 * "new device" (fresh context) sees what the first one saved.
 */
export function fakeDrive() {
  const files = new Map<string, { name: string; bytes: Buffer }>();
  let n = 0, sessions = 0;
  const pendingUploads = new Map<string, { name: string; id?: string }>();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "Location" };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

  function parseMultipart(body: Buffer, type: string) {
    const boundary = /boundary=([^;]+)/.exec(type)![1];
    const parts = body.toString("latin1").split(`--${boundary}`).slice(1, -1);
    const meta = JSON.parse(parts[0].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""));
    const raw = parts[1].slice(parts[1].indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
    return { meta, bytes: Buffer.from(raw, "latin1") };
  }

  async function handle(route: Route) {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const upload = url.pathname.startsWith("/upload/drive/v3/files");
    const id = url.pathname.replace(/^\/(upload\/)?drive\/v3\/files\/?/, "") || undefined;
    if (url.pathname.startsWith("/e2e-session/")) {
      const s = pendingUploads.get(url.pathname)!;
      const fid = s.id ?? `f${++n}`;
      files.set(fid, { name: s.id ? files.get(s.id)!.name : s.name, bytes: req.postDataBuffer() ?? Buffer.alloc(0) });
      return json(route, { id: fid });
    }
    if (upload) {
      if (url.searchParams.get("uploadType") === "resumable") {
        const meta = JSON.parse(req.postData() || "{}");
        const path = `/e2e-session/${++sessions}`;
        pendingUploads.set(path, { name: meta.name, id });
        return route.fulfill({ status: 200, headers: { ...cors, Location: `https://www.googleapis.com${path}` }, body: "" });
      }
      const { meta, bytes } = parseMultipart(req.postDataBuffer()!, req.headers()["content-type"]);
      const fid = id ?? `f${++n}`;
      files.set(fid, { name: id ? files.get(id)!.name : meta.name, bytes });
      return json(route, { id: fid });
    }
    if (method === "DELETE" && id) { files.delete(id); return route.fulfill({ status: 204, headers: cors }); }
    if (method === "GET" && id) {
      const f = files.get(id);
      return f ? route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/octet-stream" }, body: f.bytes }) : json(route, { error: "not found" }, 404);
    }
    if (method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const exact = /name = '([^']*)'/.exec(q)?.[1], contains = /name contains '([^']*)'/.exec(q)?.[1];
      const list = [...files.entries()].filter(([, f]) => (exact === undefined || f.name === exact) && (contains === undefined || f.name.includes(contains)));
      return json(route, { files: list.map(([fid, f]) => ({ id: fid, name: f.name })) });
    }
    return json(route, { error: "unsupported" }, 400);
  }

  return {
    files,
    attach: (context: BrowserContext) => context.route("https://www.googleapis.com/**", handle),
  };
}
