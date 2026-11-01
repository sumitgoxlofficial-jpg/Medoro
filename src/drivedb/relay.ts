/**
 * The pharmacy's DriveDB folder reached through Medoro's relay (/api/drivedb) with the signed-in session.
 * Files are addressed by name (the name doubles as the id). Big files go in 3 MB pieces.
 */
import type { DriveStore } from "./drive";

export const PIECE = 3 * 1024 * 1024;
export class RelayRefusedError extends Error {}

export function relayStore(device: string, base = "/api/drivedb", f: typeof fetch = fetch.bind(globalThis)): DriveStore {
  const call = async (op: string, params: Record<string, string | number> = {}, body?: Uint8Array) => {
    const q = new URLSearchParams({ op, device, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const r = await f(`${base}?${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" }, body: body ? (new Uint8Array(body) as Uint8Array<ArrayBuffer>) : undefined });
    if (!r.ok) {
      const msg = ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Relay error ${r.status}`;
      throw r.status === 403 || r.status === 401 ? new RelayRefusedError(msg) : new Error(msg);
    }
    return r;
  };
  const list = async (prefix: string) => ((await (await call("list", { prefix })).json()) as { files: { name: string }[] }).files.map((x) => ({ id: x.name, name: x.name }));
  return {
    list,
    find: async (name) => (await list(name)).find((x) => x.name === name) ?? null,
    async read(name) {
      const parts: Uint8Array[] = [];
      let offset = 0, size = Infinity;
      while (offset < size) {
        const r = await call("read", { name, offset, length: PIECE });
        if (r.headers.get("Content-Type")?.includes("json")) throw new Error(`${name} isn’t in Drive.`);
        size = Number(r.headers.get("X-Size") ?? 0);
        const b = new Uint8Array(await r.arrayBuffer());
        if (!b.length) break;
        parts.push(b); offset += b.length;
      }
      const out = new Uint8Array(offset);
      let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
      return out;
    },
    async write(name, bytes) {
      if (bytes.length <= PIECE) { await call("write", { name }, bytes); return name; }
      const { token } = (await (await call("start", { name, size: bytes.length })).json()) as { token: string };
      for (let offset = 0; offset < bytes.length; offset += PIECE) await call("chunk", { token, offset }, bytes.subarray(offset, offset + PIECE));
      return name;
    },
    remove: async (name) => { await call("remove", { name }); },
  };
}

/** Online payments waiting for this device (sealed so only it can open them), and acknowledging recorded ones. */
export function relayInbox(device: string, base = "/api/drivedb", f: typeof fetch = fetch.bind(globalThis)) {
  const call = async (op: string, extra: Record<string, string> = {}) => {
    const r = await f(`${base}?${new URLSearchParams({ op, device, ...extra })}`, { method: "POST", credentials: "same-origin" });
    const j = (await r.json().catch(() => ({}))) as { payments?: { paymentId: string; sealed: string }[]; error?: string };
    if (!r.ok) throw r.status === 403 || r.status === 401 ? new RelayRefusedError(j.error ?? `Relay error ${r.status}`) : new Error(j.error ?? `Relay error ${r.status}`);
    return j;
  };
  return {
    list: async () => (await call("inbox")).payments ?? [],
    ack: async (ids: string[]) => { if (ids.length) await call("inbox-ack", { ids: ids.join(",") }); },
  };
}

/** Tells Medoro whether this device's last sync worked (for the owner's alerts). Never throws. */
export async function reportHealth(device: string, error: string | null, base = "/api/drivedb", f: typeof fetch = fetch.bind(globalThis)) {
  const q = new URLSearchParams({ op: "health", device, ok: error ? "0" : "1", ...(error ? { error: error.slice(0, 300) } : {}) });
  await f(`${base}?${q}`, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
}

/** Registers this device with the relay (its public key). Returns approved / pending / removed. */
export async function registerDevice(device: string, name: string, publicJwk: JsonWebKey, base = "/api/drivedb", f: typeof fetch = fetch.bind(globalThis)) {
  const r = await f(`${base}?op=register&device=${encodeURIComponent(device)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: device, name, publicKey: { kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e, alg: publicJwk.alg } }) });
  const j = (await r.json().catch(() => ({}))) as { status?: string; role?: string; error?: string };
  if (!r.ok) throw new RelayRefusedError(j.error ?? `Relay error ${r.status}`);
  return { status: j.status as "approved" | "pending" | "removed", role: j.role as "owner" | "staff" };
}
