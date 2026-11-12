import { redirect } from "next/navigation";
import { log } from "@/server/log";
import { requireMe } from "@/staff/hrms/auth";
import { HOME_OF, SCREENS } from "@/staff/hrms/constants";
import { loaders, resolveScreen, shell } from "@/staff/hrms/screens";
import { Frame } from "../_ui/frame";

export const dynamic = "force-dynamic";
// Syncing a large Google Sheet from Leads runs as an action of this page, so give it room.
export const maxDuration = 60;

export default async function Page({ params, searchParams }: { params: Promise<{ s?: string[] }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const t0 = Date.now();
  const me = await requireMe();
  const tMe = Date.now() - t0;
  const [{ s }, q] = await Promise.all([params, searchParams]);
  const asked = s?.[0];
  const screen = resolveScreen(me, asked);
  // Unknown or not-allowed screens go to the person's own dashboard instead of showing an empty page.
  if (asked !== screen && asked !== undefined && !(asked === HOME_OF[me.role])) redirect(`/staff/hrms/${HOME_OF[me.role]}`);
  if (asked === undefined) redirect(`/staff/hrms/${HOME_OF[me.role]}`);
  const [sh, data] = await Promise.all([shell(me), loaders[screen](me, q)]);
  const total = Date.now() - t0;
  // A slow page leaves a line in the Vercel runtime logs: which screen, and how long sign-in check vs data took.
  if (total > 1500) log.warn("hrms slow page", { screen, totalMs: total, signInMs: tMe, dataMs: total - tMe });
  const def = SCREENS.find((x) => x.id === screen)!;
  return <Frame sh={sh} screen={screen} title={def.title} sub={def.sub} data={JSON.parse(JSON.stringify(data))} gate={me.mustChangePassword ? "password" : !me.profileDone ? "profile" : !me.docsAccepted && me.role !== "admin" ? "docs" : null} />;
}
