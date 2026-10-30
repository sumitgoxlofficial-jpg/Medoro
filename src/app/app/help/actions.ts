"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { openTicket, replyTicket, type ticketSchema } from "@/domain/system/licence";
import type { z } from "zod";

export async function openTicketAction(input: z.input<typeof ticketSchema>) {
  const r = await run((c) => openTicket(c, input));
  revalidatePath("/app", "layout");
  return r.ok ? { ...r, message: r.data.sent ? `Sent to Medoro support${r.data.code ? ` as ${r.data.code}` : ""}. Replies appear here.` : "Saved. It goes to Medoro with the next check-in (Medoro can’t be reached right now)." } : r;
}

export async function replyTicketAction(code: string, text: string) {
  const r = await run((c) => replyTicket(c, code, text));
  revalidatePath("/app", "layout");
  return r.ok ? { ...r, message: r.data.sent ? "Reply sent." : "Saved. It goes to Medoro with the next check-in." } : r;
}
