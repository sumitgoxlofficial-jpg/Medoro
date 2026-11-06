import { growthApi, query } from "@/staff/growth/api";
import { inbox, thread } from "@/staff/growth/comms";

export const dynamic = "force-dynamic";
/** ?id= returns one conversation's messages; otherwise the inbox (?channel=, ?unread=1). */
export const GET = (req: Request) => growthApi(req, "inbox.view", async (a) => { const q = query(req); return q.id ? thread(a, q.id) : { conversations: await inbox(a, { channel: q.channel, unread: q.unread === "1" }) }; });
