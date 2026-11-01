/** Shared look and types for the Drive mode device screens. */
import type { CounterConfig } from "@/drivedb/seed";
import type { ChatMsg, ToolCall, ToolSpec } from "@/domain/ai/llm";

export const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";
export const input = "border border-line rounded-lg px-3 h-9 text-sm w-full bg-white";
export const label = "flex flex-col gap-1 text-[13px] text-muted";
export type Cfg = CounterConfig;
export type PayLinkInput = { customerId: string; saleId?: string | null; customerName: string; phone?: string | null; amountPaise: number; label?: string };
/** Who is billing on this device: the signed-in user online, or the device's saved user offline. */
export type Who = {
  userId: string; userName: string; owner: boolean; canCredit: boolean; discCap: number;
  /** When the pharmacy takes online payments (signed in, Razorpay connected): makes a payment link through Medoro. */
  payLink?: (i: PayLinkInput) => Promise<{ ok: true; data: { url: string } } | { ok: false; error: string }>;
  /** Signed in with an AI model set up: one step of the model conversation through Medoro's gateway. */
  ai?: { remote: boolean; remoteNames: boolean; step: AiStep } | null;
};
export type AiStep = (i: { messages: ChatMsg[]; tools: ToolSpec[] }) => Promise<{ ok: true; data: { content: string; calls: ToolCall[] } } | { ok: false; error: string }>;
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Rupees typed by a person ("32.50") to paise. */
export const toPaise = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, "")) * 100) || 0;
