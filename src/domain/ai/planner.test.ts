import { describe, expect, it } from "vitest";
import { isHinglish, rulePlan } from "./planner";

const tool = (t: string, lang: "en" | "hi" = "en") => { const p = rulePlan(t, lang, 9); return p.kind === "tool" ? [p.tool, p.input] : ["reply", p.text]; };

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

  it("refuses clinical advice and record changes, in the user's language", () => {
    const en = rulePlan("What is the dose of paracetamol for a child?", "en", 9);
    expect(en).toMatchObject({ kind: "reply", refusal: true });
    expect((en as { text: string }).text).toMatch(/clinical advice/);
    const hi = rulePlan("Is dawai ka side effect kya hai?", "en", 9);
    expect((hi as { text: string }).text).toMatch(/clinical salah/);
    expect(rulePlan("Void invoice 4809", "en", 9)).toMatchObject({ kind: "reply", refusal: true });
  });

  it("falls back to help text", () => {
    expect(tool("hello")[0]).toBe("reply");
    expect(isHinglish("kya haal hai", "en")).toBe(true);
    expect(isHinglish("hello", "hi")).toBe(true);
    expect(isHinglish("hello", "en")).toBe(false);
  });
});
