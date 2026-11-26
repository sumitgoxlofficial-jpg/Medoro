import "server-only";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { HRMS_VIDEO_FUNCTION } from "@/lib/hrms-video-origin";
import type { Me } from "./auth";
import { videosFor } from "./video-catalog";

/** How long a signed video link works. The screen asks for fresh links before they run out. */
export const VIDEO_LINK_HOURS = 4;

/** The shared secret for the "hrms-videos" Edge Function, made by Postgres and kept in HrSetting (never in code or env). */
async function videoSecret(): Promise<string> {
  const v = (await db.hrSetting.findUnique({ where: { key: "videoSecret" } }))?.value;
  return typeof v === "string" ? v : "";
}

/**
 * Signed links to the training videos (and their thumbnails) this person's role may watch, valid for a few hours.
 * The videos sit in a private bucket; without these links nobody can open them. Returns null when the videos aren't
 * set up on this server (no secret) or the storage can't be reached.
 */
export async function videoLinks(me: Me, fetcher: typeof fetch = fetch): Promise<Record<string, { video: string; thumb: string }> | null> {
  const slugs = videosFor(me.role, me.perms).map((v) => v.slug);
  if (!slugs.length) return {};
  const secret = await videoSecret();
  if (!secret) return null;
  const paths = slugs.flatMap((s) => [`files/${s}.mp4`, `thumbs/${s}.jpg`]);
  try {
    const r = await fetcher(HRMS_VIDEO_FUNCTION, {
      method: "POST", headers: { "content-type": "application/json", "x-hrv-key": secret },
      body: JSON.stringify({ action: "sign", paths, expiresIn: VIDEO_LINK_HOURS * 3600 }), signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (!r.ok) { log.warn("hrms video links refused", { status: r.status }); return null; }
    const urls = ((await r.json()) as { urls?: Record<string, string> }).urls ?? {};
    const out: Record<string, { video: string; thumb: string }> = {};
    for (const s of slugs) { const video = urls[`files/${s}.mp4`]; if (video) out[s] = { video, thumb: urls[`thumbs/${s}.jpg`] ?? "" }; }
    return out;
  } catch (e) {
    log.warn("hrms video links failed", { err: e });
    return null;
  }
}
