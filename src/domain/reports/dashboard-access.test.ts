import { describe, expect, it } from "vitest";
import { dashboardFor } from "./dashboard-access";
import type { DashboardData } from "./dashboard";

const data = {
  range: "today", catalogueSize: 1,
  kpi: { sales: 1000, bills: 2, salesPrev: 900, margin: 22, margin7: 20, purchases: 500, grnCount: 1, expenses: 70, expenseCount: 1, receivable: 300, onCredit: 2, payable: 400, dueWeek: 100 },
  history: [], pay: { cash: 1000, upi: 0, card: 0, credit: 0 }, lowStock: [], expiring: [], insights: [], branchPerf: [],
  backup: { last: null, driveConnected: false },
  activity: [{ id: "1", when: "", who: "Owner", action: "Signed in", detail: null }],
} as DashboardData;

describe("dashboardFor", () => {
  it("strips finance, dues and activity for a cashier", () => {
    const d = dashboardFor(data, ["sale"]);
    expect(d.kpi).toMatchObject({ sales: 1000, bills: 2, margin: null, margin7: null, purchases: 0, expenses: 0, payable: 0, dueWeek: 0, receivable: 0, onCredit: 0 });
    expect(d.activity).toEqual([]);
  });

  it("keeps receivables but not finance for payments-only roles", () => {
    const d = dashboardFor(data, ["payments"]);
    expect(d.kpi).toMatchObject({ receivable: 300, onCredit: 2, margin: null, payable: 0 });
  });

  it("keeps everything for reports", () => {
    expect(dashboardFor(data, ["reports"])).toEqual(data);
  });
});
