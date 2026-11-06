import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/**
 * SSRF-safe fetch for checking a lead's public website. Only http(s) on ports 80/443, every hop's host must resolve to
 * public addresses only, redirects are followed by hand (at most 3) and re-checked, 8 s timeout, 512 KB cap.
 * The connection is pinned to the address that was checked (no second DNS lookup), so DNS rebinding can't redirect it.
 */
export class UnsafeUrl extends Error {}

export function isPrivateIp(ip: string): boolean {
  const v = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const h = v.toLowerCase();
  return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("ff") || h.startsWith("64:ff9b") || h.startsWith("2001:db8");
}

type Resolver = (host: string) => Promise<string[]>;
const defaultResolve: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

async function inspect(raw: string, resolve: Resolver): Promise<{ u: URL; addrs: string[] }> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrl("Not a valid web address."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrl("Only http and https addresses can be checked.");
  if (u.username || u.password) throw new UnsafeUrl("Addresses with a user name or password aren’t checked.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new UnsafeUrl("Only the standard web ports are checked.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new UnsafeUrl("That address points inside a private network.");
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => { throw new UnsafeUrl("The website’s domain doesn’t resolve."); });
  if (!addrs.length || addrs.some(isPrivateIp)) throw new UnsafeUrl("That address points inside a private network.");
  return { u, addrs };
}

export async function checkUrl(raw: string, resolve: Resolver = defaultResolve): Promise<URL> {
  return (await inspect(raw, resolve)).u;
}

/** The checked URL and one of the addresses that passed the check: the only address the request may connect to. */
export async function vetUrl(raw: string, resolve: Resolver = defaultResolve): Promise<{ url: URL; address: string }> {
  const { u, addrs } = await inspect(raw, resolve);
  return { url: u, address: addrs[0] };
}

type Fetched = { status: number; location: string | null; text: string };

/** GET over node:http(s) with DNS pinned to `address`; TLS still verifies the certificate for the hostname. */
export function pinnedGet(url: URL, address: string, max: number): Promise<Fetched> {
  return new Promise((resolveP, reject) => {
    const family = isIP(address);
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: { "User-Agent": "MedoroGrowthBot/1.0 (+https://medoro.in; website check)", Accept: "text/html,*/*;q=0.5" },
      timeout: 8000,
      lookup: (_h, opts, cb) => { if ((opts as { all?: boolean })?.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]); else cb(null, address, family); },
    }, (res) => {
      let n = 0;
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => { n += c.length; if (n <= max) chunks.push(c); else res.destroy(); });
      const done = () => resolveP({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null, text: Buffer.concat(chunks).toString("utf8") });
      res.on("end", done); res.on("close", done); res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetchText(raw: string, opts: { fetchImpl?: typeof fetch; resolve?: Resolver; maxBytes?: number } = {}): Promise<{ url: string; status: number; text: string }> {
  const max = opts.maxBytes ?? 512 * 1024;
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const { url: u, address } = await vetUrl(url, opts.resolve);
    // Tests pass fetchImpl to stub the network; production always uses the pinned connection.
    const r: Fetched = opts.fetchImpl ? await viaFetch(opts.fetchImpl, u, max) : await pinnedGet(u, address, max);
    if (r.status >= 300 && r.status < 400 && r.location) { url = new URL(r.location, u).toString(); continue; }
    return { url: u.toString(), status: r.status, text: r.text };
  }
  throw new UnsafeUrl("Too many redirects.");
}

async function viaFetch(f: typeof fetch, u: URL, max: number): Promise<Fetched> {
  const res = await f(u.toString(), { redirect: "manual", signal: AbortSignal.timeout(8000) });
  const text = (await res.text()).slice(0, max);
  return { status: res.status, location: res.headers.get("location"), text };
}
