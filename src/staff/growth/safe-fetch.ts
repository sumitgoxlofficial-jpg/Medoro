import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-safe fetch for checking a lead's public website. Only http(s) on ports 80/443, every hop's host must resolve to
 * public addresses only, redirects are followed by hand (at most 3) and re-checked, 8 s timeout, 512 KB cap.
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

export async function checkUrl(raw: string, resolve: Resolver = defaultResolve): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrl("Not a valid web address."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrl("Only http and https addresses can be checked.");
  if (u.username || u.password) throw new UnsafeUrl("Addresses with a user name or password aren’t checked.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new UnsafeUrl("Only the standard web ports are checked.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new UnsafeUrl("That address points inside a private network.");
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => { throw new UnsafeUrl("The website’s domain doesn’t resolve."); });
  if (!addrs.length || addrs.some(isPrivateIp)) throw new UnsafeUrl("That address points inside a private network.");
  return u;
}

export async function safeFetchText(raw: string, opts: { fetchImpl?: typeof fetch; resolve?: Resolver; maxBytes?: number } = {}): Promise<{ url: string; status: number; text: string }> {
  const f = opts.fetchImpl ?? fetch;
  const max = opts.maxBytes ?? 512 * 1024;
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await checkUrl(url, opts.resolve);
    const res = await f(u.toString(), { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MedoroGrowthBot/1.0 (+https://medoro.in; website check)", Accept: "text/html,*/*;q=0.5" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, u).toString(); continue; }
    const reader = res.body?.getReader();
    let text = "";
    if (reader) {
      const dec = new TextDecoder();
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        text += dec.decode(value, { stream: true });
        if (n >= max) { await reader.cancel().catch(() => {}); break; }
      }
    }
    return { url: u.toString(), status: res.status, text };
  }
  throw new UnsafeUrl("Too many redirects.");
}
