import { finishLinkedin, linkedinLogin, setApplicant } from "@/server/applicant";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const li = linkedinLogin();
  const origin = li ? new URL(li.redirect).origin : url.origin;
  const r = await finishLinkedin(url);
  if (!r.ok) return Response.redirect(new URL(`${r.next}${r.next.includes("?") ? "&" : "?"}signin=${r.why}`, origin), 302);
  await setApplicant({ email: r.email, name: r.name, via: "linkedin" });
  return Response.redirect(new URL(r.next, origin), 302);
}
