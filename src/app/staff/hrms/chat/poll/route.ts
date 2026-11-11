import { getMe } from "@/staff/hrms/auth";
import { chatList, chatMessages, unreadTotal } from "@/staff/hrms/chat";

export const dynamic = "force-dynamic";

/**
 * The chat screen asks this every couple of seconds: the conversation list with unread counts and, for the open
 * conversation, anything newer than `after`. Only the signed-in person's own conversations can be read.
 */
export async function GET(req: Request) {
  const me = await getMe();
  if (!me) return Response.json({ error: "signed-out" }, { status: 401, headers: { "cache-control": "no-store" } });
  const u = new URL(req.url), chatId = u.searchParams.get("chat") ?? "", after = u.searchParams.get("after");
  const afterN = after === null || after === "" ? null : Number(after);
  const visible = u.searchParams.get("open") === "1";
  try {
    const [chats, unread, thread] = await Promise.all([
      chatList(me), unreadTotal(me.id),
      chatId ? chatMessages(me, chatId, afterN !== null && Number.isInteger(afterN) && afterN >= 0 ? afterN : null, visible) : null,
    ]);
    return Response.json({ chats, unread, thread }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
