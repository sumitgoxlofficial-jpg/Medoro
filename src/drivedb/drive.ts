/**
 * The pharmacy's DriveDB folder in Google Drive (Medoro/<pharmacy>/drivedb), as a small file store.
 * The device talks to Google directly with a short-lived token from Medoro, so pharmacy data never passes
 * through Medoro's server. A memory version backs the tests.
 */
export type DriveFile = { id: string; name: string };

export interface DriveStore {
  /** Files whose name starts with `prefix`, any order. */
  list(prefix: string): Promise<DriveFile[]>;
  find(name: string): Promise<DriveFile | null>;
  read(id: string): Promise<Uint8Array>;
  /** Creates a file, or replaces the contents of `id`. Returns the file id. */
  write(name: string, bytes: Uint8Array, id?: string): Promise<string>;
  remove(id: string): Promise<void>;
}

export class DriveAuthError extends Error {}

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const MULTIPART_MAX = 5 * 1024 * 1024;
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const ab = (b: Uint8Array) => new Uint8Array(b) as Uint8Array<ArrayBuffer>;

export function googleStore(access: () => { token: string; folderId: string }, f: typeof fetch = fetch.bind(globalThis)): DriveStore {
  const call = async (url: string, init: RequestInit = {}) => {
    const { token } = access();
    const r = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    if (r.status === 401 || r.status === 403) throw new DriveAuthError(`Google Drive refused access (${r.status}). Reconnect Google Drive or reload the page.`);
    if (!r.ok && !(init.method === "DELETE" && r.status === 404)) throw new Error(`Google Drive error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  const query = async (q: string) => {
    const out: DriveFile[] = [];
    let page: string | undefined;
    do {
      const p = new URLSearchParams({ q, fields: "nextPageToken,files(id,name)", pageSize: "1000", spaces: "drive", ...(page ? { pageToken: page } : {}) });
      const j = (await (await call(`${API}?${p}`)).json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(j.files ?? []));
      page = j.nextPageToken;
    } while (page);
    return out;
  };
  const inFolder = () => `'${esc(access().folderId)}' in parents and trashed = false`;
  return {
    list: async (prefix) => (await query(`${inFolder()} and name contains '${esc(prefix)}'`)).filter((x) => x.name.startsWith(prefix)),
    find: async (name) => (await query(`${inFolder()} and name = '${esc(name)}'`))[0] ?? null,
    read: async (id) => new Uint8Array(await (await call(`${API}/${encodeURIComponent(id)}?alt=media`)).arrayBuffer()),
    async write(name, bytes, id) {
      const method = id ? "PATCH" : "POST";
      const base = id ? `${UPLOAD}/${encodeURIComponent(id)}` : UPLOAD;
      const meta = JSON.stringify(id ? {} : { name, parents: [access().folderId], mimeType: "application/octet-stream" });
      if (bytes.length <= MULTIPART_MAX) {
        const boundary = "medoro" + Math.random().toString(36).slice(2);
        const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
        const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
        const body = new Uint8Array(head.length + bytes.length + tail.length);
        body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
        const r = await call(`${base}?uploadType=multipart&fields=id`, { method, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
        return ((await r.json()) as { id: string }).id;
      }
      const start = await call(`${base}?uploadType=resumable&fields=id`, {
        method, headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(bytes.length) }, body: meta,
      });
      const loc = start.headers.get("Location");
      if (!loc) throw new Error("Google Drive didn’t return an upload address.");
      const r = await call(loc, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: ab(bytes) });
      return ((await r.json()) as { id: string }).id;
    },
    remove: async (id) => { await call(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" }); },
  };
}

/** In-memory store for tests. */
export function memoryStore(): DriveStore & { files: Map<string, DriveFile & { bytes: Uint8Array }> } {
  const files = new Map<string, DriveFile & { bytes: Uint8Array }>();
  let n = 0;
  return {
    files,
    list: async (prefix) => [...files.values()].filter((x) => x.name.startsWith(prefix)).map(({ id, name }) => ({ id, name })),
    find: async (name) => { const x = [...files.values()].find((v) => v.name === name); return x ? { id: x.id, name: x.name } : null; },
    read: async (id) => { const x = files.get(id); if (!x) throw new Error("not found"); return new Uint8Array(x.bytes); },
    write: async (name, bytes, id) => { const fid = id ?? `f${++n}`; files.set(fid, { id: fid, name: id ? files.get(id)!.name : name, bytes: new Uint8Array(bytes) }); return fid; },
    remove: async (id) => { files.delete(id); },
  };
}
