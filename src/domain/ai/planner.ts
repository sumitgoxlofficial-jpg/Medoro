/**
 * Turns a question into a tool call. The rule-based planner always runs first for
 * refusals (clinical advice, record changes); a local LLM, when configured, plans the rest.
 * Pure functions here are unit-tested; the LLM call lives in llmPlan().
 */

export type Plan =
  | { kind: "tool"; tool: string; input: Record<string, unknown> }
  | { kind: "reply"; text: string; refusal?: boolean };

const MONTHS: [RegExp, number][] = [
  [/\b(jan|january|janvari)\b/, 0], [/\b(feb|february|farvari)\b/, 1], [/\b(mar|march)\b/, 2], [/\b(apr|april)\b/, 3],
  [/\b(may|mai)\b/, 4], [/\b(jun|june)\b/, 5], [/\b(jul|july)\b/, 6], [/\b(aug|august)\b/, 7], [/\b(sep|sept|september)\b/, 8],
  [/\b(oct|october)\b/, 9], [/\b(nov|november)\b/, 10], [/\b(dec|december|disambar)\b/, 11],
];

export const isHinglish = (text: string, lang: "en" | "hi") =>
  lang === "hi" || /[ऀ-ॿ]/.test(text) || /\b(aaj|kitni|kitna|kya|kaun|hai|batao|karo|dikhao|chahiye|hogi|dawai|mahine|bikri)\b/i.test(text);

export const HELP = {
  en: "I can answer questions about sales, stock, expiry, reorders, supplier dues, customer dues, cash in the drawer, seasonal demand and backups, and I can prepare draft purchase orders for your review. I don’t give clinical advice.",
  hi: "Main sale, stock, expiry, reorder, supplier aur customer dues, galla, seasonal demand aur backup ke baare mein bata sakta hoon, aur aapke review ke liye draft PO bana sakta hoon. Main clinical salah nahi deta.",
};

/** Rule-based intent matching (English + Hinglish). `today` is the IST month index, for "next month". */
export function rulePlan(text: string, lang: "en" | "hi", month: number): Plan {
  const l = text.toLowerCase();
  const hi = isHinglish(text, lang);
  if (/(dose|dosage|how much .*(take|give)|treat|bimari|ilaj|side.?effect|safe (for|in|during)|pregnan|interaction|substitute for|kitni goli)/.test(l))
    return { kind: "reply", refusal: true, text: hi ? "Main clinical salah nahi de sakta. Kripya pharmacist ya doctor se poochhein." : "I can’t give clinical advice. Please check with the pharmacist on duty or the prescriber." };
  if (/(refund|adjust|delete|void|cancel (the )?(bill|invoice|sale)|write.?off|edit (the )?(bill|invoice))/.test(l))
    return { kind: "reply", refusal: true, text: "Refunds, voids and stock adjustments need an invoice or batch reference and the right role. Open Returns & shift or Inventory to do it. I won’t change records from chat." };
  if (/(purchase order|draft po|\bpo\b|order bana|order taiyar)/.test(l)) return { kind: "tool", tool: "create_draft_purchase_order", input: {} };
  if (/(season|peak|advance|zyada bik|demand|winter|monsoon|summer|sardi|garmi|baarish|next month|agle mahine|sells? (more|most)|best.?sell)/.test(l) && !/(sales? (today|yesterday|this|last))/.test(l)) {
    const m = MONTHS.find(([r]) => r.test(l));
    return { kind: "tool", tool: "get_seasonal_forecast", input: { month: m ? m[1] : (month + 1) % 12 } };
  }
  if (/(reorder|low stock|kam stock|khatam|order karna|running out|out of stock)/.test(l)) return { kind: "tool", tool: "get_low_stock_report", input: {} };
  if (/(expir|expire|kharab hone)/.test(l)) {
    const d = l.match(/(\d{1,3})\s*(din|days?|d\b)/);
    return { kind: "tool", tool: "get_expiry_report", input: { days: d ? Math.min(365, Math.max(1, +d[1])) : 30 } };
  }
  if (/(reconcil|cash in|drawer|galla|shift)/.test(l)) return { kind: "tool", tool: "get_cash_reconciliation", input: {} };
  if (/(supplier|payable|payment due|dues to|owe)/.test(l) && !/(customer|udhaar|receivable)/.test(l)) return { kind: "tool", tool: "get_supplier_balances", input: {} };
  if (/(customer|udhaar|receivable|outstanding|credit due)/.test(l)) return { kind: "tool", tool: "get_customer_outstanding", input: {} };
  if (/(backup)/.test(l)) return { kind: "tool", tool: "get_backup_status", input: {} };
  if (/(sale|sales|bikri|becha|revenue|collection|kitna bika|bills?)\b/.test(l)) {
    const period = /(yesterday|kal)/.test(l) ? "yesterday" : /(week|hafte|7 days)/.test(l) ? "week" : /(month|mahina|mahine)/.test(l) ? "month" : "today";
    return { kind: "tool", tool: "get_sales_summary", input: { period } };
  }
  const q = l.match(/(?:stock of|stock for|price of|do we have|find|search|kitna stock|kitni stock)\s+(.{2,40}?)\??$/) ?? l.match(/^(.{2,40}?)\s+(?:stock|in stock|hai kya|kitna hai)\??$/);
  if (q) return { kind: "tool", tool: "search_medicines", input: { query: q[1].trim() } };
  return { kind: "reply", text: HELP[hi ? "hi" : "en"] };
}

type LlmTool = { name: string; description: string; params?: Record<string, unknown> };

/** Asks a local Ollama-compatible server to pick a tool. Returns null if unavailable or unsure. */
export async function llmPlan(text: string, tools: LlmTool[], opts = { url: process.env.LOCAL_LLM_URL, model: process.env.LOCAL_LLM_MODEL }): Promise<Plan | null> {
  if (!opts.url || !opts.model) return null;
  try {
    const res = await fetch(new URL("/api/chat", opts.url), {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: opts.model, stream: false, options: { temperature: 0 },
        messages: [
          { role: "system", content: "You help a pharmacy owner query their own data. Always answer by calling exactly one tool. Never give clinical or dosage advice. If no tool fits, reply in one short sentence." },
          { role: "user", content: text.slice(0, 500) },
        ],
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: { type: "object", properties: t.params ?? {} } } })),
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] } };
    const call = j.message?.tool_calls?.[0]?.function;
    if (call && tools.some((t) => t.name === call.name)) {
      const args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
      return { kind: "tool", tool: call.name, input: (args && typeof args === "object" ? args : {}) as Record<string, unknown> };
    }
    return null; // free-text answers from the model aren't grounded in data; fall back to rules
  } catch {
    return null;
  }
}
