import { requireGrowth } from "@/staff/growth/access";
import { inbox } from "@/staff/growth/comms";
import { InboxView } from "./view";

export default async function Inbox({ searchParams }: { searchParams: Promise<{ channel?: string; unread?: string }> }) {
  const a = await requireGrowth("inbox.view");
  const sp = await searchParams;
  const convs = await inbox(a, { channel: sp.channel || undefined, unread: sp.unread === "1" });
  return <InboxView convs={convs} channel={sp.channel ?? ""} unread={sp.unread === "1"} />;
}
