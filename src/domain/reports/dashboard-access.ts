import type { DashboardData } from "./dashboard";

export const dashboardAccess = (perms: readonly string[]) => {
  const fin = perms.includes("reports");
  return { fin, pay: fin || perms.includes("payments"), activity: fin || perms.includes("users") };
};

/** Removes the figures a role may not see before the dashboard is sent to the browser. */
export function dashboardFor(data: DashboardData, perms: readonly string[]): DashboardData {
  const a = dashboardAccess(perms);
  const k = data.kpi;
  return {
    ...data,
    kpi: {
      ...k,
      margin: a.fin ? k.margin : null, margin7: a.fin ? k.margin7 : null,
      purchases: a.fin ? k.purchases : 0, grnCount: a.fin ? k.grnCount : 0,
      expenses: a.fin ? k.expenses : 0, expenseCount: a.fin ? k.expenseCount : 0,
      payable: a.fin ? k.payable : 0, dueWeek: a.fin ? k.dueWeek : 0,
      receivable: a.pay ? k.receivable : 0, onCredit: a.pay ? k.onCredit : 0,
    },
    activity: a.activity ? data.activity : [],
  };
}
