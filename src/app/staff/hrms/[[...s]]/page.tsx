import { redirect } from "next/navigation";
import { requireMe } from "@/staff/hrms/auth";
import { HOME_OF, SCREENS } from "@/staff/hrms/constants";
import { loaders, resolveScreen, shell } from "@/staff/hrms/screens";
import { Frame } from "../_ui/frame";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ s?: string[] }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireMe();
  const [{ s }, q] = await Promise.all([params, searchParams]);
  const asked = s?.[0];
  const screen = resolveScreen(me, asked);
  // Unknown or not-allowed screens go to the person's own dashboard instead of showing an empty page.
  if (asked !== screen && asked !== undefined && !(asked === HOME_OF[me.role])) redirect(`/staff/hrms/${HOME_OF[me.role]}`);
  if (asked === undefined) redirect(`/staff/hrms/${HOME_OF[me.role]}`);
  const [sh, data] = await Promise.all([shell(me), loaders[screen](me, q)]);
  const def = SCREENS.find((x) => x.id === screen)!;
  return <Frame sh={sh} screen={screen} title={def.title} sub={def.sub} data={JSON.parse(JSON.stringify(data))} gate={me.mustChangePassword ? "password" : !me.profileDone ? "profile" : !me.docsAccepted && me.role !== "admin" ? "docs" : null} />;
}
