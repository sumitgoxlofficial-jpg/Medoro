/** Shared look and types for the Drive mode device screens. */
import type { CounterConfig } from "@/drivedb/seed";
import type { ChatMsg, ToolCall, ToolSpec } from "@/domain/ai/llm";
import type { EinvDoc } from "@/domain/gst/einvoice";
import type { IrnReply } from "@/drivedb/einvoice";
import type { Lang, TFn } from "@/lib/tr";

export const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";
export const input = "border border-line rounded-lg px-3 h-9 text-sm w-full bg-white";
export const label = "flex flex-col gap-1 text-[13px] text-muted";
export type Cfg = CounterConfig;
export type PayLinkInput = { customerId: string; saleId?: string | null; customerName: string; phone?: string | null; amountPaise: number; label?: string };
/** Who is billing on this device: the signed-in user online, or the device's saved user offline. */
import type { billForSend } from "@/drivedb/share";
import type { SendResult } from "@/drivedb/campaigns";
export type CampaignBatch = { campaignId: string; first: boolean; message: string; recipients: { id: string; name: string; phone: string; consentAt: string }[] };
export type Who = {
  userId: string; userName: string; owner: boolean; canCredit: boolean; discCap: number;
  /** When the pharmacy takes online payments (signed in, Razorpay connected): makes a payment link through Medoro. */
  payLink?: (i: PayLinkInput) => Promise<{ ok: true; data: { url: string } } | { ok: false; error: string }>;
  /** Signed in with an AI model set up: one step of the model conversation through Medoro's gateway. */
  ai?: { remote: boolean; remoteNames: boolean; step: AiStep } | null;
  /** E-invoicing is set up on Medoro: get or cancel an IRN for a B2B bill through the gateway. */
  einvoice?: EinvActions | null;
  /** The pharmacy's WhatsApp is connected (signed in): send a bill's PDF through Medoro, which keeps nothing. */
  whatsapp?: {
    via: "phone" | "meta";
    send: (bill: ReturnType<typeof billForSend>) => Promise<{ ok: true; data: { sent: true; messageId: string | null } } | { ok: false; error: string }>;
    /** One batch of a store update (owner); Medoro answers each recipient's result. */
    campaign: (batch: CampaignBatch) => Promise<{ ok: true; data: { results: SendResult[] } } | { ok: false; error: string }>;
  } | null;
};
export type EinvActions = {
  irn: (doc: EinvDoc) => Promise<{ ok: true; data: IrnReply } | { ok: false; error: string }>;
  cancel: (i: { irn: string; reason: "1" | "2" | "3" | "4"; remark: string }) => Promise<{ ok: true; data: { reason: string } } | { ok: false; error: string }>;
};
export type AiStep = (i: { messages: ChatMsg[]; tools: ToolSpec[] }) => Promise<{ ok: true; data: { content: string; calls: ToolCall[] } } | { ok: false; error: string }>;
export const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  // A failed input check in the device database arrives as Zod's list of issues: show the first one's message.
  if (m.startsWith("[")) { try { const x = JSON.parse(m) as { message?: string }[]; if (x[0]?.message) return x[0].message; } catch { /* plain text */ } }
  return m;
};
/** A count with its unit, "3 strips"; Hindi adds no plural s ("3 स्ट्रिप"). Kept out of the Hindi lines: a "{n} {unit}s" line would match any text ending in s. */
export const unitsOf = (lang: Lang, t: TFn, n: number, unit: string) => (lang === "hi" ? `${n} ${t(unit)}` : `${n} ${unit}s`);
/** Rupees typed by a person ("32.50") to paise. */
export const toPaise = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, "")) * 100) || 0;
