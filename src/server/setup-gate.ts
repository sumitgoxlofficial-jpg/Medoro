import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * First-run setup creates the owner of this installation, so on a public server it must not be
 * open to whoever finds the URL first. When SETUP_TOKEN is set (and always on Vercel), the wizard
 * asks for it once; a short-lived cookie then carries a hash of it.
 */
const COOKIE = "medoro_setup";
const digest = (s: string) => createHash("sha256").update("medoro-setup:" + s).digest();

export function setupGate(): "open" | "token" | "disabled" {
  if (process.env.SETUP_TOKEN) return "token";
  return process.env.VERCEL ? "disabled" : "open";
}

export function tokenMatches(given: string) {
  const want = process.env.SETUP_TOKEN;
  if (!want || !given) return false;
  return timingSafeEqual(digest(given.trim()), digest(want));
}

export async function setupUnlocked() {
  const g = setupGate();
  if (g === "open") return true;
  if (g === "disabled") return false;
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && /^[0-9a-f]{64}$/.test(c) && timingSafeEqual(Buffer.from(c, "hex"), digest(process.env.SETUP_TOKEN!));
}

export async function unlockSetup(given: string) {
  if (!tokenMatches(given)) return false;
  (await cookies()).set(COOKIE, digest(given.trim()).toString("hex"), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 2 * 3600 });
  return true;
}
