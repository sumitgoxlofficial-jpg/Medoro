/**
 * Where the HRMS training videos live: a private Supabase Storage bucket ("hrms-videos") in the production project,
 * reached through its "hrms-videos" Edge Function, which hands medoro.in short-lived signed links. HRMS_VIDEO_FUNCTION_URL
 * overrides it (e.g. for another install). No secret here: the function and medoro.in share one kept in HrSetting.
 */
export const HRMS_VIDEO_FUNCTION = process.env.HRMS_VIDEO_FUNCTION_URL || "https://dckgdlraaoxlnvdwluax.supabase.co/functions/v1/hrms-videos";

/** The storage origin the signed links point at, for the HRMS pages' media-src and img-src. */
export function hrmsVideoOrigin(): string {
  try { const u = new URL(HRMS_VIDEO_FUNCTION); return u.protocol === "https:" ? u.origin : ""; } catch { return ""; }
}
