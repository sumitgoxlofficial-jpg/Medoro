import { beginLinkedin, careersPath, linkedinLogin } from "@/server/applicant";

export const dynamic = "force-dynamic";

/** /api/careers/linkedin/start?next=/careers/<slug> → LinkedIn's consent screen, for job seekers. */
export async function GET(req: Request) {
  const url = new URL(req.url), next = careersPath(url.searchParams.get("next"));
  const li = linkedinLogin();
  if (!li) return Response.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}signin=off`, url.origin), 302);
  return Response.redirect(await beginLinkedin(next), 302);
}
