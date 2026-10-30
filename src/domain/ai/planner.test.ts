import { describe, expect, it } from "vitest";
import { isHinglish, replyLang, rulePlan } from "./planner";

const tool = (t: string, lang: "en" | "hi" = "en") => { const p = rulePlan(t, lang, 9, 2026); return p.kind === "tool" ? [p.tool, p.input] : ["reply", p.text]; };

describe("rule planner", () => {
  it("routes the drawer's suggestions to the right tools", () => {
    expect(tool("Aaj ki total sale kitni hai?")).toEqual(["get_sales_summary", { period: "today" }]);
    expect(tool("Sales yesterday")).toEqual(["get_sales_summary", { period: "yesterday" }]);
    expect(tool("Next month kya zyada bikega?")).toEqual(["get_seasonal_forecast", { month: 10 }]);
    expect(tool("What sells more in December?")).toEqual(["get_seasonal_forecast", { month: 11 }]);
    expect(tool("Expiring in next 30 days")).toEqual(["get_expiry_report", { days: 30 }]);
    expect(tool("kaun si dawai 90 din mein expire hogi")).toEqual(["get_expiry_report", { days: 90 }]);
    expect(tool("What should I reorder?")[0]).toBe("get_low_stock_report");
    expect(tool("Supplier payments due this week")[0]).toBe("get_supplier_balances");
    expect(tool("Which customers have udhaar?")[0]).toBe("get_customer_outstanding");
    expect(tool("Check last backup")[0]).toBe("get_backup_status");
    expect(tool("Prepare cash reconciliation")[0]).toBe("get_cash_reconciliation");
    expect(tool("Prepare a purchase order for review")[0]).toBe("create_draft_purchase_order");
    expect(tool("stock of dolo 650")).toEqual(["search_medicines", { query: "dolo 650" }]);
  });

  it("routes Devanagari questions, including Devanagari digits", () => {
    expect(tool("आज की बिक्री कितनी है?")).toEqual(["get_sales_summary", { period: "today" }]);
    expect(tool("अगले महीने क्या ज़्यादा बिकेगा?")).toEqual(["get_seasonal_forecast", { month: 10 }]);
    expect(tool("३० दिन में कौन सी दवा एक्सपायर होगी?")).toEqual(["get_expiry_report", { days: 30 }]);
    expect(tool("क्या रीऑर्डर करना है?")[0]).toBe("get_low_stock_report");
    expect(tool("सप्लायर बकाया दिखाओ")[0]).toBe("get_supplier_balances");
    expect(tool("पिछले महीने की GST रिपोर्ट")).toEqual(["generate_report", { report: "gst-summary", period: "last", scope: "branch" }]);
  });

  it("batch inventory, in English and Hinglish, with a branch", () => {
    expect(tool("Show batches of Dolo 650")).toEqual(["get_batch_inventory", { query: "dolo 650" }]);
    expect(tool("dolo ke batch dikhao")).toEqual(["get_batch_inventory", { query: "dolo" }]);
    expect(tool("batches of crocin at Second branch")).toEqual(["get_batch_inventory", { query: "crocin", branch: "second" }]);
    expect(tool("Second branch mein azithral ke batch")).toEqual(["get_batch_inventory", { query: "azithral", branch: "second" }]);
    expect(tool("show batches")[0]).toBe("reply");
  });

  it("reports: id, period and scope", () => {
    expect(tool("GST report last month")).toEqual(["generate_report", { report: "gst-summary", period: "last", scope: "branch" }]);
    expect(tool("sales register for all branches csv")).toEqual(["generate_report", { report: "sales-register", period: "month", scope: "all" }]);
    expect(tool("stock valuation report for August")).toEqual(["generate_report", { report: "stock-valuation", period: "2026-08", scope: "branch" }]);
    expect(tool("day book December")).toEqual(["generate_report", { report: "day-book", period: "2025-12", scope: "branch" }]);
    expect(tool("supplier dues report bhejo")[1]).toMatchObject({ report: "supplier-dues" });
    expect(tool("trial balance this financial year")[1]).toMatchObject({ report: "trial-balance", period: "fy" });
    expect(tool("send me a report")[0]).toBe("reply");
  });

  it("write intents: expense, backup, stock adjustment and refund", () => {
    expect(tool("Record expense ₹1,250 electricity by UPI")).toEqual(["create_draft_expense", { account: "Electricity", amount: 1250, method: "UPI", note: "Recorded via AI chat" }]);
    expect(tool("500 ka chai ka kharcha likho")).toEqual(["create_draft_expense", { account: "Staff welfare", amount: 500, method: "Cash", note: "Recorded via AI chat" }]);
    expect(tool("record an expense")[0]).toBe("reply");
    expect(tool("Take a backup now")[0]).toBe("request_backup");
    expect(tool("backup le lo")[0]).toBe("request_backup");
    expect(tool("When was the last backup?")[0]).toBe("get_backup_status");
    expect(tool("Adjust Dolo 650 batch DL1 by -2 reason damaged strip")).toEqual(["request_stock_adjustment", { batchNo: "DL1", medicine: "dolo 650", delta: -2, reason: "damaged strip" }]);
    expect(tool("dolo batch DL1 ka stock 3 kam karo kyunki toot gaya")).toEqual(["request_stock_adjustment", { batchNo: "DL1", medicine: "dolo", delta: -3, reason: "toot gaya" }]);
    expect(tool("adjust batch X9 add 5 because found in store")).toEqual(["request_stock_adjustment", { batchNo: "X9", delta: 5, reason: "found in store" }]);
    expect(tool("adjust batch X9 5 reason recount")[0]).toBe("reply");
    expect(tool("Refund invoice INV/MAI/2627/000123, sealed, reason wrong medicine")).toEqual(["request_refund", { invoice: "INV/MAI/2627/000123", condition: "sealed", reason: "wrong medicine" }]);
    expect(tool("Refund invoice MAI2627-000123, reason wrong medicine")).toEqual(["request_refund", { invoice: "MAI2627-000123", reason: "wrong medicine" }]);
    expect(tool("return 2 dolo 650 from invoice 17 by upi reason not needed")).toEqual(["request_refund", { invoice: "17", qty: 2, medicine: "dolo 650", refundMode: "UPI refund", reason: "not needed" }]);
    expect(tool("bill 42 ka refund karo")).toEqual(["request_refund", { invoice: "42", reason: "" }]);
    expect(tool("refund kar do")[0]).toBe("reply");
  });

  it("refuses clinical advice and voids, in the user's language", () => {
    const en = rulePlan("What is the dose of paracetamol for a child?", "en", 9);
    expect(en).toMatchObject({ kind: "reply", refusal: true });
    expect((en as { text: string }).text).toMatch(/clinical advice/);
    const hi = rulePlan("Is dawai ka side effect kya hai?", "en", 9);
    expect((hi as { text: string }).text).toMatch(/clinical salah/);
    const deva = rulePlan("बच्चे को कितनी खुराक दें?", "en", 9);
    expect(deva).toMatchObject({ kind: "reply", refusal: true });
    expect((deva as { text: string }).text).toMatch(/चिकित्सा सलाह/);
    expect(rulePlan("Void invoice 4809", "en", 9)).toMatchObject({ kind: "reply", refusal: true });
    expect(rulePlan("delete batch DL1", "en", 9)).toMatchObject({ kind: "reply", refusal: true });
  });

  it("falls back to help text, in Hindi when asked in Devanagari or with the Hindi UI", () => {
    expect(tool("hello")[0]).toBe("reply");
    expect(tool("नमस्ते")[1]).toMatch(/मैं बिक्री/);
    expect(tool("hello", "hi")[1]).toMatch(/मैं बिक्री/);
    expect(isHinglish("kya haal hai", "en")).toBe(true);
    expect(isHinglish("hello", "hi")).toBe(true);
    expect(isHinglish("hello", "en")).toBe(false);
    expect(replyLang("आज की बिक्री", "en")).toBe("hi");
    expect(replyLang("aaj ki sale", "en")).toBe("hinglish");
    expect(replyLang("sales today", "hi")).toBe("hi");
    expect(replyLang("sales today", "en")).toBe("en");
  });
});
