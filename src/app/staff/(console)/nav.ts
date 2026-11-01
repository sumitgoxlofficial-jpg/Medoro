import type { StaffRoleId } from "@/staff/constants";

export type View = "overview" | "employees" | "commission" | "leads" | "sales" | "payouts" | "customers" | "tickets" | "coupons";
export const NAV: Record<StaffRoleId, [View, string][]> = {
  super_admin: [["overview", "Overview"], ["employees", "Employees"], ["commission", "Commission"], ["leads", "Sales pipeline"], ["sales", "All sales"], ["payouts", "Payouts"], ["customers", "Customers"], ["tickets", "Support tickets"], ["coupons", "Coupons"]],
  sales: [["leads", "Pipeline"], ["sales", "My sales & commission"], ["payouts", "Payouts"], ["customers", "My customers"]],
  care: [["tickets", "Support tickets"], ["customers", "Customers"]],
  partner: [["sales", "My referrals & earnings"], ["payouts", "Payouts"]],
};
export const ROLES_FOR: Record<View, StaffRoleId[]> = {
  overview: ["super_admin"], employees: ["super_admin"], commission: ["super_admin"], leads: ["super_admin", "sales"], sales: ["super_admin", "sales", "partner"],
  payouts: ["super_admin", "sales", "partner"], customers: ["super_admin", "sales", "care"], tickets: ["super_admin", "care"], coupons: ["super_admin"],
};
