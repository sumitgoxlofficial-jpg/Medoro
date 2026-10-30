/**
 * Turns a question into a tool call. The rule-based planner always runs first for refusals
 * (clinical advice, voids and deletions); a configured model plans the rest (see llm.ts).
 * Everything here is pure and unit-tested.
 */

export type Plan =
  | { kind: "tool"; tool: string; input: Record<string, unknown> }
  | { kind: "reply"; text: string; refusal?: boolean };

/** "hi" answers in Devanagari Hindi, "hinglish" in Roman Hindi, "en" in English. */
export type ReplyLang = "en" | "hinglish" | "hi";

const DEVA = /[\u0900-\u097F]/;
const DEVA_DIGITS = "०१२३४५६७८९";
export const normalise = (t: string) => t.replace(/[०-९]/g, (d) => String(DEVA_DIGITS.indexOf(d))).replace(/\s+/g, " ").trim();

const MONTHS: [RegExp, number][] = [
  [/\b(jan|january|janvari)\b|जनवरी/, 0], [/\b(feb|february|farvari)\b|फ़?फरवरी/, 1], [/\b(mar|march)\b|मार्च/, 2], [/\b(apr|april)\b|अप्रैल/, 3],
  [/\b(may|mai)\b|मई/, 4], [/\b(jun|june)\b|जून/, 5], [/\b(jul|july)\b|जुलाई/, 6], [/\b(aug|august)\b|अगस्त/, 7], [/\b(sep|sept|september)\b|सितंबर|सितम्बर/, 8],
  [/\b(oct|october)\b|अक्टूबर|अक्तूबर/, 9], [/\b(nov|november)\b|नवंबर|नवम्बर/, 10], [/\b(dec|december|disambar)\b|दिसंबर|दिसम्बर/, 11],
];

export const isHinglish = (text: string, lang: "en" | "hi") =>
  lang === "hi" || DEVA.test(text) || /\b(aaj|kitni|kitna|kya|kaun|hai|batao|karo|dikhao|chahiye|hogi|dawai|mahine|bikri|kharcha|wapas|kam)\b/i.test(text);

/** Devanagari questions, or the Hindi UI, get Hindi answers; Roman Hindi gets Hinglish. */
export const replyLang = (text: string, lang: "en" | "hi"): ReplyLang => (lang === "hi" || DEVA.test(text) ? "hi" : isHinglish(text, "en") ? "hinglish" : "en");

const say = (L: ReplyLang, en: string, hinglish: string, hi: string) => (L === "hi" ? hi : L === "hinglish" ? hinglish : en);

export const HELP: Record<ReplyLang, string> = {
  en: "I can answer questions about sales, stock, batches, expiry, reorders, supplier and customer dues, cash in the drawer, seasonal demand, reports and backups. After you confirm, I can save a draft purchase order, record an expense, adjust stock, refund an invoice or start a backup. I don’t give clinical advice.",
  hinglish: "Main sale, stock, batch, expiry, reorder, supplier aur customer dues, galla, seasonal demand, report aur backup ke baare mein bata sakta hoon. Aapke confirm karne par draft PO, kharcha, stock adjustment, refund ya backup bhi kar sakta hoon. Main clinical salah nahi deta.",
  hi: "मैं बिक्री, स्टॉक, बैच, एक्सपायरी, रीऑर्डर, सप्लायर और ग्राहक बकाया, गल्ला, मौसमी माँग, रिपोर्ट और बैकअप के बारे में बता सकता हूँ। आपकी पुष्टि के बाद ड्राफ्ट PO, खर्च, स्टॉक समायोजन, रिफंड या बैकअप भी कर सकता हूँ। मैं चिकित्सा सलाह नहीं देता।",
};

const CLINICAL = /(dose|dosage|how much .*(take|give)|treat|bimari|ilaj|side.?effect|safe (for|in|during)|pregnan|interaction|substitute for|kitni goli|खुराक|डोज़?|इलाज|बीमारी|साइड ?इफेक्ट|दुष्प्रभाव|गर्भ|कितनी गोली)/;
const BLOCKED = /(delete|\bvoid\b|cancel (the )?(bill|invoice|sale)|write.?off|edit (the )?(bill|invoice)|डिलीट|रद्द|मिटा)/;

export const REPORT_IDS = ["sales-register", "stock-valuation", "expiry-exposure", "low-stock", "supplier-dues", "customer-dues", "gst-summary", "day-book", "trial-balance", "stock-movements"] as const;
const REPORT_KEYS: [RegExp, (typeof REPORT_IDS)[number]][] = [
  [/(gst|\btax\b|जीएसटी)/, "gst-summary"], [/(trial balance|ट्रायल)/, "trial-balance"], [/(day ?book|voucher|rojnamcha|रोजनामचा|डे ?बुक)/, "day-book"],
  [/(movement|stock ledger|मूवमेंट)/, "stock-movements"], [/(valuation|stock value|inventory value|मूल्यांकन)/, "stock-valuation"], [/(expir|एक्सपायर)/, "expiry-exposure"],
  [/(low stock|reorder|kam stock|कम स्टॉक|रीऑर्डर)/, "low-stock"], [/(supplier|payable|सप्लायर)/, "supplier-dues"], [/(customer|udhaar|receivable|ग्राहक|उधार)/, "customer-dues"],
  [/(sale|bikri|register|बिक्री|सेल)/, "sales-register"],
];

export const EXPENSE_KEYS: [RegExp, string][] = [
  [/(\brent\b|kiraya|kiraye|किराया|किराए)/, "Rent"], [/(electric|bijli|light bill|बिजली)/, "Electricity"], [/(salar|tankhwah|tankha|vetan|वेतन|तनख्वाह)/, "Salaries"],
  [/(\btea\b|\bchai\b|snack|nashta|staff welfare|चाय|नाश्ता)/, "Staff welfare"], [/(deliver|courier|petrol|डिलीवरी|पेट्रोल)/, "Delivery expense"],
  [/(repair|maintenance|marammat|मरम्मत)/, "Repairs & maintenance"], [/(phone|mobile|internet|wi-?fi|recharge|फ़?फोन|इंटरनेट|रिचार्ज)/, "Telephone & internet"],
  [/(bank charge|bank fee)/, "Bank charges"], [/(print|stationery|paper|\broll\b|प्रिंट|स्टेशनरी)/, "Printing & stationery"],
];

const REASON = /(?:reason|because|due to|kyunki|kyonki|wajah|vajah|karan|कारण|क्योंकि|वजह)\s*(?:is|hai|है)?\s*[:\-–]?\s*(.+)$/i;
const reasonOf = (t: string) => t.match(REASON)?.[1]?.trim().replace(/[.?!।]+$/, "") ?? "";
const withoutReason = (t: string) => t.replace(REASON, " ");

/** Most recent past occurrence of a month, as YYYY-MM. */
const monthKey = (m: number, month: number, year: number) => `${m <= month ? year : year - 1}-${String(m + 1).padStart(2, "0")}`;

const STOP = /\b(show|list|all|any|batch|batches|batchwise|details?|info|of|for|ke|ka|ki|saare|sare|sab|dikhao|batao|kaun|kaunse|konse|se|hai|hain|kitne|what|which|are|is|the|me|mein|stock|expiry|qty|quantity|please|pls|with|their|its|do|we|have|wise|at|in)\b|[?।]|के|का|की|बैच|दिखाओ|बताओ|सारे|सभी|कौन|से|हैं|है|में|स्टॉक/g;

/** Branch named in the question ("at Second branch", "Second branch mein"), removed from the text. */
function branchOf(l: string): { branch?: string; rest: string } {
  const m = l.match(/\b(?:at|in|from)\s+(?:the\s+)?([a-z0-9][a-z0-9 ]{0,30}?)\s+branch\b/) ?? l.match(/\b([a-z0-9]+)\s+branch\s+(?:(?:mein|me|par|pe)\b|में)/) ?? l.match(/\bbranch\s*[:\-]?\s*([a-z0-9]+)/);
  return m ? { branch: m[1].trim(), rest: l.replace(m[0], " ") } : { rest: l };
}

/** Rule-based intent matching (English, Hinglish and Hindi). `month` is the IST month index, for "next month". */
export function rulePlan(raw: string, lang: "en" | "hi", month: number, year = new Date().getFullYear()): Plan {
  const text = normalise(raw);
  const l = text.toLowerCase();
  const L = replyLang(raw, lang);
  const ask = (en: string, hinglish: string, hi: string): Plan => ({ kind: "reply", text: say(L, en, hinglish, hi) });

  if (CLINICAL.test(l))
    return { kind: "reply", refusal: true, text: say(L, "I can’t give clinical advice. Please check with the pharmacist on duty or the prescriber.", "Main clinical salah nahi de sakta. Kripya pharmacist ya doctor se poochhein.", "मैं चिकित्सा सलाह नहीं दे सकता। कृपया ड्यूटी पर मौजूद फार्मासिस्ट या डॉक्टर से पूछें।") };
  if (BLOCKED.test(l))
    return { kind: "reply", refusal: true, text: say(L, "Voids, deletions and write-offs need the right screen and role. Open Returns & shift or Inventory to do it. I won’t make those changes from chat.", "Void, delete aur write-off chat se nahi hote. Returns & shift ya Inventory screen par karein.", "बिल रद्द करना, मिटाना या राइट-ऑफ़ चैट से नहीं होता। Returns & shift या Inventory स्क्रीन पर करें।") };

  // Reports as files
  if (/(\breport\b|\bcsv\b|\bexport\b|download|excel|रिपोर्ट|register|day ?book|trial balance)/.test(l)) {
    const id = REPORT_KEYS.find(([r]) => r.test(l))?.[1];
    if (!id) return ask("Which report? Sales register, stock valuation, expiry exposure, low stock, supplier dues, customer dues, GST summary, day book, trial balance or stock movements.", "Kaun si report? Sales register, stock valuation, expiry, low stock, supplier dues, customer dues, GST summary, day book, trial balance ya stock movements.", "कौन सी रिपोर्ट? बिक्री रजिस्टर, स्टॉक मूल्यांकन, एक्सपायरी, कम स्टॉक, सप्लायर बकाया, ग्राहक बकाया, GST सारांश, डे बुक, ट्रायल बैलेंस या स्टॉक मूवमेंट।");
    const m = MONTHS.find(([r]) => r.test(l));
    const period = /(last month|previous month|pichh?le mahine|पिछले महीने)/.test(l) ? "last" : /(financial year|\bfy\b|this year|is saal|इस साल|वित्त वर्ष)/.test(l) ? "fy" : m ? monthKey(m[1], month, year) : "month";
    const scope = /(all branches|every branch|sabhi branch|sab branch|saari branch|सभी शाखा|सब ब्रांच|सभी ब्रांच)/.test(l) ? "all" : "branch";
    return { kind: "tool", tool: "generate_report", input: { report: id, period, scope } };
  }

  // Expenses (write)
  if (/(expense|kharch|खर्च)/.test(l) || (/(\bpaid\b|pay kiya|bhara|diya|दिया|भरा|चुकाया)/.test(l) && EXPENSE_KEYS.some(([r]) => r.test(l)))) {
    const amt = l.match(/(?:₹|rs\.?|inr|rupees?)?\s*(\d[\d,]*(?:\.\d{1,2})?)/);
    const verb = /(record|add|log|enter|book|post|paid|daal|likh|jod|kiya|diya|bhara|दर्ज|लिखो|जोड़|दिया|भरा)/.test(l);
    if (amt || verb) {
      if (!amt) return ask("How much was the expense? For example: “Record expense ₹500 electricity cash”.", "Kharcha kitne ka tha? Jaise: “₹500 bijli ka kharcha cash”.", "खर्च कितने का था? जैसे: “₹500 बिजली का खर्च नकद”।");
      const account = EXPENSE_KEYS.find(([r]) => r.test(l))?.[1] ?? "Miscellaneous expense";
      const method = /(upi|gpay|google pay|phonepe|paytm|यूपीआई)/.test(l) ? "UPI" : account === "Bank charges" || /(\bbank\b|neft|imps|rtgs|cheque|\bchq\b|बैंक)/.test(l) ? "Bank" : "Cash";
      return { kind: "tool", tool: "create_draft_expense", input: { account, amount: Number(amt[1].replace(/,/g, "")), method, note: "Recorded via AI chat" } };
    }
  }

  // Backups: start one, or show status
  if (/(backup|बैकअप)/.test(l)) {
    const now = /(now|start|take|run|abhi|karo|kar do|\blo\b|le lo|chalao|शुरू|अभी|लो|करो|चलाओ)/.test(l) && !/(last|status|check|kab|when|history|कब|आखिरी|पिछला|स्थिति)/.test(l);
    return { kind: "tool", tool: now ? "request_backup" : "get_backup_status", input: {} };
  }

  // Refunds against an invoice (write)
  if (/(refund|\breturn\b|wapas|vapas|वापस|वापसी|रिफंड|लौटा)/.test(l)) {
    const inv = text.match(/(?:invoice|bill|\binv\b|बिल|इनवॉइस)\s*(?:no\.?|number|#|:)?\s*((?:[a-z0-9][a-z0-9/-]*)?\d)/i)?.[1] ?? text.match(/\b([a-z]{2,6}\/[a-z0-9/]*\d)\b/i)?.[1];
    if (!inv) return ask("Which invoice? For example: “Refund invoice INV/MAI/2627/000123, reason wrong medicine”.", "Kaun sa bill? Jaise: “Bill 123 ka refund karo, wajah galat dawai”.", "कौन सा बिल? जैसे: “बिल 123 का रिफंड करो, कारण गलत दवा”।");
    const body = withoutReason(l);
    const part = body.match(/(?:return|refund)\s+(\d+)\s+(?:units?\s+of\s+|x\s+)?([a-z][a-z0-9 .-]{1,40}?)\s+(?:from|against|of|in|on)\s+(?:the\s+)?(?:invoice|bill|inv)/);
    const refundMode = /(upi|gpay|phonepe|paytm)/.test(body) ? "UPI refund" : /(customer credit|\bcredit\b|udhaar|khata|उधार|खाता)/.test(body) ? "Adjust customer credit" : /(cash|nakad|नकद|कैश)/.test(body) ? "Cash" : undefined;
    const condition = /(sealed|unopened|\bseal\b|band pack|सील)/.test(l) ? "sealed" : /(damaged|opened|\bopen\b|khula|toota|toot|kharab|खुला|टूटा|खराब)/.test(l) ? "damaged" : undefined;
    return { kind: "tool", tool: "request_refund", input: { invoice: inv, ...(part ? { qty: Number(part[1]), medicine: part[2].trim() } : {}), ...(refundMode ? { refundMode } : {}), ...(condition ? { condition } : {}), reason: reasonOf(text) } };
  }

  // Stock adjustment (write)
  if (/(adjust|समायोजन|एडजस्ट)/.test(l) || (/(batch|बैच)/.test(l) && /(stock|स्टॉक)/.test(l) && /(kam karo|ghatao|badhao|jodo|घटाओ|बढ़ाओ|जोड़ो|कम करो|\badd\b|\bremove\b|\breduce\b|\bincrease\b)/.test(l))) {
    const reason = reasonOf(text);
    const body = withoutReason(l);
    const bm = body.match(/(?:batch|बैच)\s*(?:no\.?|number|#|:)?\s*([a-z0-9][a-z0-9/-]*)/);
    if (!bm) return ask("Which batch? For example: “Adjust Dolo 650 batch DL1 by -2, reason damaged strip”.", "Kaun sa batch? Jaise: “Dolo 650 batch DL1 ka stock 2 kam karo kyunki strip toot gayi”.", "कौन सा बैच? जैसे: “Dolo 650 बैच DL1 का स्टॉक 2 घटाओ क्योंकि पत्ता टूट गया”।");
    const after = body.slice(body.indexOf(bm[0]) + bm[0].length);
    const n = after.match(/([+-]?)\s*(\d+)/);
    const medicine = body.slice(0, body.indexOf(bm[0])).replace(/(please|pls|adjust(ment)?|stock|\bof\b|\bfor\b|\bthe\b|\bka\b|\bke\b|\bki\b|का|के|की|स्टॉक|समायोजन|एडजस्ट|करो)/g, " ").replace(/\s+/g, " ").trim();
    const neg = /(remove|minus|reduce|decrease|less|\bkam\b|ghata|nikal|damage|lost|missing|toot|kharab|घटा|कम|निकाल|टूट|खराब)/.test(after);
    const pos = /(\badd\b|plus|increase|more|extra|zyada|badha|jod|mila|found|बढ़ा|जोड़|मिल)/.test(after);
    if (!n || (!n[1] && neg === pos)) return ask("Add or remove how many units? For example: “by -2” or “add 5”.", "Kitne units badhane ya kam karne hain? Jaise: “2 kam karo” ya “5 badhao”.", "कितनी यूनिट बढ़ानी या घटानी हैं? जैसे: “2 घटाओ” या “5 बढ़ाओ”।");
    const delta = (n[1] === "-" || (!n[1] && neg) ? -1 : 1) * Number(n[2]);
    return { kind: "tool", tool: "request_stock_adjustment", input: { batchNo: text.match(/(?:batch|बैच)\s*(?:no\.?|number|#|:)?\s*([a-z0-9][a-z0-9/-]*)/i)?.[1] ?? bm[1], ...(medicine.length >= 2 ? { medicine } : {}), delta, reason } };
  }

  if (/(purchase order|draft po|\bpo\b|order bana|order taiyar|खरीद आदेश|परचेज ऑर्डर|ऑर्डर बना|पीओ)/.test(l)) return { kind: "tool", tool: "create_draft_purchase_order", input: {} };

  // Batches of a medicine
  if (/(batch|बैच)/.test(l)) {
    const { branch, rest } = branchOf(l);
    const query = rest.replace(STOP, " ").replace(/\s+/g, " ").trim();
    if (query.length < 2) return ask("Batches of which medicine? For example: “batches of Dolo 650”.", "Kis dawai ke batch? Jaise: “Dolo 650 ke batch dikhao”.", "किस दवा के बैच? जैसे: “Dolo 650 के बैच दिखाओ”।");
    return { kind: "tool", tool: "get_batch_inventory", input: { query: query.slice(0, 60), ...(branch ? { branch } : {}) } };
  }

  if (/(season|peak|advance|zyada bik|demand|winter|monsoon|summer|sardi|garmi|baarish|next month|agle mahine|sells? (more|most)|best.?sell|मौसम|सर्दी|गर्मी|बारिश|अगले महीने|ज़्?यादा बिक)/.test(l) && !/(sales? (today|yesterday|this|last))/.test(l)) {
    const m = MONTHS.find(([r]) => r.test(l));
    return { kind: "tool", tool: "get_seasonal_forecast", input: { month: m ? m[1] : (month + 1) % 12 } };
  }
  if (/(reorder|low stock|kam stock|khatam|order karna|running out|out of stock|कम स्टॉक|ख़?खत्म|रीऑर्डर)/.test(l)) return { kind: "tool", tool: "get_low_stock_report", input: {} };
  if (/(expir|expire|kharab hone|एक्सपायर|समाप्त)/.test(l)) {
    const d = l.match(/(\d{1,3})\s*(din|days?|d\b|दिन)/);
    return { kind: "tool", tool: "get_expiry_report", input: { days: d ? Math.min(365, Math.max(1, +d[1])) : 30 } };
  }
  if (/(reconcil|cash in|drawer|galla|shift|गल्ला|गल्ले|शिफ्ट|नकद)/.test(l)) return { kind: "tool", tool: "get_cash_reconciliation", input: {} };
  if (/(supplier|payable|payment due|dues to|owe|सप्लायर|आपूर्तिकर्ता)/.test(l) && !/(customer|udhaar|receivable|ग्राहक|उधार)/.test(l)) return { kind: "tool", tool: "get_supplier_balances", input: {} };
  if (/(customer|udhaar|receivable|outstanding|credit due|ग्राहक|उधार|बकाया)/.test(l)) return { kind: "tool", tool: "get_customer_outstanding", input: {} };
  if (/(\bsales?\b|bikri|becha|revenue|collection|kitna bika|\bbills?\b|बिक्री|सेल|बिका|बेचा)/.test(l)) {
    const period = /(yesterday|\bkal\b|कल)/.test(l) ? "yesterday" : /(week|hafte|7 days|हफ्ते|सप्ताह)/.test(l) ? "week" : /(month|mahina|mahine|महीने|महीना)/.test(l) ? "month" : "today";
    return { kind: "tool", tool: "get_sales_summary", input: { period } };
  }
  const q = l.match(/(?:stock of|stock for|price of|do we have|find|search|kitna stock|kitni stock)\s+(.{2,40}?)\??$/) ?? l.match(/^(.{2,40}?)\s+(?:stock|in stock|hai kya|kitna hai)\??$/) ?? l.match(/^(.{2,40}?)\s+(?:का|की|के)?\s*स्टॉक/);
  if (q) return { kind: "tool", tool: "search_medicines", input: { query: q[1].trim() } };
  return { kind: "reply", text: HELP[L] };
}
