/**
 * The pass that lets a signed-in staff member's browser load the HRMS training videos (public/hrms-videos). The HRMS
 * issues it (staff/hrms/videos/pass) for the videos that person's role may watch; the proxy checks it before any file in
 * /hrms-videos is served, so the files are never reachable without signing in. It is an HMAC over its expiry and the
 * allowed video slugs, keyed from SESSION_SECRET, so the proxy checks it without a database read. Web Crypto only, so it
 * runs wherever the proxy runs.
 */
export const VIDEO_PASS_COOKIE = "medoro_hrv";
export const VIDEO_PASS_PATH = "/hrms-videos";
export const VIDEO_PASS_HOURS = 4;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function mac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode("hrms-videos:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

const SLUG = /^[a-z0-9-]{1,60}$/;

/** A pass for these video slugs, valid until `expires` (ms since epoch). */
export async function signVideoPass(secret: string, slugs: string[], expires: number) {
  const list = slugs.filter((s) => SLUG.test(s)).join("~");
  const body = `${Math.floor(expires)}.${list}`;
  return `${body}.${await mac(secret, body)}`;
}

/** Whether `token` is a valid, unexpired pass that includes `slug`. Constant-time compare of the signature. */
export async function checkVideoPass(secret: string, token: string | undefined, slug: string, now = Date.now()) {
  if (!secret || !token || !SLUG.test(slug)) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const [exp, list = ""] = body.split(".");
  if (!/^\d+$/.test(exp ?? "") || Number(exp) <= now) return false;
  const want = await mac(secret, body);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let k = 0; k < want.length; k++) diff |= want.charCodeAt(k) ^ sig.charCodeAt(k);
  return diff === 0 && list.split("~").includes(slug);
}

/** The video slug a /hrms-videos path asks for ("/hrms-videos/files/payroll.mp4" → "payroll"), or null. */
export function videoSlugOf(pathname: string): string | null {
  const m = /^\/hrms-videos\/(?:files|thumbs)\/([a-z0-9-]{1,60})\.(?:mp4|jpg)$/.exec(pathname);
  return m ? m[1] : null;
}
