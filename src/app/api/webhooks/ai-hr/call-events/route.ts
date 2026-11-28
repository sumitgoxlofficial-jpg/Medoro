import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { sipEnabled, verifySignature } from "@/staff/hrms/ai-hr/telephony";

export const dynamic = "force-dynamic";

// Call events from the optional SIP/PSTN provider (Mode B). Off (404) unless AI_HR_SIP_ENABLED=1 and
// AI_HR_WEBHOOK_SECRET are set. Every delivery must be signed (X-Medoro-Signature: t=…,v1=HMAC-SHA256("t.body")) and is
// processed once: a repeated event id answers 200 without doing anything again.
const event = z.object({
  id: z.string().min(8).max(100),
  type: z.enum(["call.ringing", "call.answered", "call.no_answer", "call.failed", "call.completed"]),
  callId: z.string().uuid(),
  providerId: z.string().max(100).default(""),
  detail: z.string().max(300).default(""),
});

export async function POST(req: Request) {
  if (!sipEnabled()) return new Response("Not found", { status: 404 });
  const body = await req.text();
  if (body.length > 20_000) return new Response("Too large", { status: 413 });
  if (!verifySignature(req.headers.get("x-medoro-signature"), body, process.env.AI_HR_WEBHOOK_SECRET!)) return new Response("Bad signature", { status: 401 });
  let e: z.infer<typeof event>;
  try { e = event.parse(JSON.parse(body)); } catch { return new Response("Bad event", { status: 400 }); }
  try {
    await db.aiHrWebhookEvent.create({ data: { id: e.id, kind: e.type, callId: e.callId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return Response.json({ ok: true, duplicate: true });
    throw err;
  }
  const call = await db.aiHrCall.findUnique({ where: { id: e.callId } });
  if (!call || call.channel !== "sip") { log.warn("ai-hr webhook for unknown or non-SIP call", { callId: e.callId }); return Response.json({ ok: true, ignored: true }); }
  const outcome = e.type === "call.answered" ? "answered" : e.type === "call.no_answer" ? "no_answer" : e.type === "call.failed" ? "failed" : e.type === "call.completed" ? "completed" : "ringing";
  await db.aiHrCallAttempt.create({ data: { callId: call.id, n: call.attempts, outcome, detail: e.detail.slice(0, 300) } });
  if (e.type === "call.answered") await db.aiHrCall.update({ where: { id: call.id }, data: { status: "in_progress", startedAt: call.startedAt ?? new Date(), providerId: e.providerId || call.providerId } });
  if (e.type === "call.failed" && call.status !== "completed") await db.aiHrCall.update({ where: { id: call.id }, data: { status: call.attempts >= call.maxAttempts ? "failed" : "notified" } });
  return Response.json({ ok: true });
}
