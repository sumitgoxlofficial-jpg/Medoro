// Shared by the HRMS server code and its screens (no server imports here).

export const HR_ROLES = ["employee", "hr", "admin", "finance", "sales"] as const;
export type HrRoleId = (typeof HR_ROLES)[number];
export const HR_ROLE_LABEL: Record<HrRoleId, string> = { employee: "Employee", hr: "HR Admin", admin: "Super Admin", finance: "Finance", sales: "Sales" };

/** Parts of the HRMS a role can be given in Roles & Permissions. The super admin always has all of them. */
export const MODULES = [
  { id: "employees", label: "Employees" }, { id: "attendance", label: "Attendance & leave" }, { id: "payroll", label: "Payroll" },
  { id: "recruitment", label: "Recruitment" }, { id: "tasks", label: "Tasks & projects" }, { id: "leads", label: "Leads" },
  { id: "reports", label: "Reports" }, { id: "finance", label: "Accounts" },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];
export type Perms = Record<Exclude<HrRoleId, "admin">, ModuleId[]>;
export const DEFAULT_PERMS: Perms = {
  hr: ["employees", "attendance", "payroll", "recruitment", "tasks", "leads", "reports"],
  finance: ["payroll", "reports", "finance"], sales: [], employee: [],
};

export type IconId = "home" | "clock" | "plane" | "rupee" | "target" | "box" | "help" | "users" | "cal" | "briefcase" | "shield" | "file" | "sliders" | "sparkle";
export type ScreenDef = { id: string; label: string; icon: IconId; title: string; sub: string; group?: string; roles?: HrRoleId[]; module?: ModuleId; hidden?: boolean };

/** Every screen. A screen opens for the listed roles, or for anyone holding its module. */
export const SCREENS: ScreenDef[] = [
  // Role dashboards
  { id: "home", label: "Home", icon: "home", title: "Home", sub: "", group: "WORK", roles: ["employee"] },
  { id: "slhome", label: "Dashboard", icon: "home", title: "Sales", sub: "", group: "WORK", roles: ["sales"] },
  { id: "hrhome", label: "Dashboard", icon: "home", title: "HR", sub: "", group: "WORK", roles: ["hr"] },
  { id: "sahome", label: "Dashboard", icon: "home", title: "Super Admin", sub: "", group: "WORK", roles: ["admin"] },
  { id: "finhome", label: "Dashboard", icon: "home", title: "Accounts", sub: "", group: "WORK", roles: ["finance"] },
  // Sales
  { id: "slboard", label: "Lead Tracker", icon: "box", title: "Lead Tracker", sub: "Move each pharmacy from first call to won", group: "WORK", roles: ["sales"] },
  { id: "slleads", label: "My Leads", icon: "users", title: "My Leads", sub: "Pharmacies assigned to you by HR", group: "WORK", roles: ["sales"] },
  // Everyone
  { id: "myprojects", label: "My Projects", icon: "box", title: "My Projects", sub: "Projects you are part of", group: "WORK", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "mytasks", label: "My Tasks", icon: "target", title: "My Tasks", sub: "Tasks assigned to you by your lead", group: "WORK", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "calendar", label: "Calendar", icon: "cal", title: "Calendar", sub: "Holidays, meetings and who is out", group: "WORK", roles: ["employee", "sales", "hr", "admin", "finance"] },
  // Team (module screens)
  { id: "perf", label: "Performance", icon: "target", title: "Performance", sub: "Live progress, weekly and monthly reports · Employee of the Month", group: "TEAM", module: "reports" },
  { id: "assigntasks", label: "Assign Tasks", icon: "target", title: "Assign Tasks", sub: "Assign and track tasks across the team", group: "TEAM", module: "tasks" },
  { id: "assignprojects", label: "Projects", icon: "box", title: "Projects", sub: "Assign and track project allocations", group: "TEAM", module: "tasks" },
  { id: "hrleads", label: "Leads", icon: "target", title: "Leads", sub: "Upload pharmacy leads and assign them to the sales team", group: "TEAM", module: "leads" },
  { id: "hremployees", label: "Employees", icon: "users", title: "Employees", sub: "Directory", group: "PEOPLE", module: "employees" },
  { id: "hrnewemp", label: "New Employee", icon: "users", title: "New employee", sub: "Official email, employee ID, password and joining documents are generated for you", group: "PEOPLE", module: "employees" },
  { id: "departments", label: "Departments", icon: "box", title: "Departments", sub: "Org structure and heads", group: "PEOPLE", module: "employees" },
  { id: "recruit", label: "Recruitment", icon: "briefcase", title: "Recruitment (ATS)", sub: "Openings, pipeline and offers", group: "PEOPLE", module: "recruitment" },
  { id: "hrattendance", label: "Team Attendance", icon: "clock", title: "Team Attendance", sub: "Today", group: "PEOPLE", module: "attendance" },
  { id: "hrleave", label: "Leave Management", icon: "plane", title: "Leave Management", sub: "Approvals and team calendar", group: "PEOPLE", module: "attendance" },
  { id: "credentials", label: "Credentials", icon: "shield", title: "Credentials", sub: "One-time passwords and login status for every employee", group: "PEOPLE", module: "employees" },
  { id: "onboarding", label: "Onboarding", icon: "box", title: "Onboarding", sub: "Joining checklists and welcome kits", group: "PEOPLE", module: "employees" },
  { id: "payroll", label: "Payroll", icon: "rupee", title: "Payroll", sub: "India compliance", group: "PEOPLE", module: "payroll" },
  { id: "reports", label: "Reports", icon: "file", title: "Reports", sub: "Headcount, attendance, leave and payroll", group: "PEOPLE", module: "reports" },
  { id: "allyusage", label: "Ally Usage", icon: "sparkle", title: "Ally Usage", sub: "How much the team uses the assistant", group: "PEOPLE", module: "reports" },
  // Accounts
  { id: "fin_contacts", label: "Contacts", icon: "users", title: "Contacts", sub: "Customers and vendors", group: "ACCOUNTS", module: "finance" },
  { id: "fin_sales", label: "Sales & Invoices", icon: "rupee", title: "Sales & Invoices", sub: "Invoices, quotes and receivables", group: "ACCOUNTS", module: "finance" },
  { id: "fin_purchases", label: "Purchases & Expenses", icon: "box", title: "Purchases & Expenses", sub: "Bills, expenses and payables", group: "ACCOUNTS", module: "finance" },
  { id: "fin_accounting", label: "Accounting", icon: "file", title: "Accounting", sub: "Ledgers, journals and chart of accounts", group: "ACCOUNTS", module: "finance" },
  { id: "fin_salescrm", label: "Sales CRM & Leads", icon: "target", title: "Sales CRM & Leads", sub: "Pipeline and deal tracking", group: "ACCOUNTS", module: "finance" },
  { id: "fin_mktgcrm", label: "Marketing CRM", icon: "sparkle", title: "Marketing CRM", sub: "Campaigns and audience", group: "ACCOUNTS", module: "finance" },
  { id: "fin_products", label: "Products & Inventory", icon: "box", title: "Products & Inventory", sub: "Stock, SKUs and valuation", group: "ACCOUNTS", module: "finance" },
  { id: "fin_reports", label: "Reports", icon: "file", title: "Reports", sub: "Statements from the registers", group: "ACCOUNTS", module: "finance" },
  { id: "fin_gst", label: "GST Reports", icon: "file", title: "GST Reports", sub: "Output and input tax from invoices and bills", group: "ACCOUNTS", module: "finance" },
  { id: "fin_workflows", label: "Workflows & Automations", icon: "sliders", title: "Workflows & Automations", sub: "Rules that run your books", group: "ACCOUNTS", module: "finance" },
  { id: "fin_banking", label: "Banking & Payments", icon: "rupee", title: "Banking & Payments", sub: "Accounts and payouts", group: "ACCOUNTS", module: "finance" },
  // Super admin
  { id: "saapprovals", label: "Approvals", icon: "plane", title: "Approvals", sub: "Final sign-off on reimbursement claims", group: "ADMIN", roles: ["admin"] },
  { id: "saperms", label: "Roles & Permissions", icon: "shield", title: "Roles & Permissions", sub: "Configurable access per role", group: "ADMIN", roles: ["admin"] },
  { id: "auditlogs", label: "Audit Logs", icon: "file", title: "Audit Logs", sub: "System and user activity", group: "ADMIN", roles: ["admin"] },
  { id: "settings", label: "Settings", icon: "sliders", title: "System Settings", sub: "Workforce policy, leave policy and company details", group: "ADMIN", roles: ["admin"] },
  // Me
  { id: "attendance", label: "Attendance", icon: "clock", title: "Attendance", sub: "My attendance", group: "ME", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "leave", label: "Leave & Approvals", icon: "plane", title: "Leave", sub: "Balances, requests and reimbursement claims", group: "ME", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "payslips", label: "Payslips", icon: "rupee", title: "Payslips", sub: "Salary history", group: "ME", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "assets", label: "Assets", icon: "briefcase", title: "Assets", sub: "Devices and equipment assigned to you", group: "ME", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "jobs", label: "Work at Medoro", icon: "briefcase", title: "Work at Medoro", sub: "Open roles · refer someone you know", group: "COMPANY", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "support", label: "Support", icon: "help", title: "Support", sub: "HR helpdesk", group: "COMPANY", roles: ["employee", "sales", "hr", "admin", "finance"] },
  { id: "profile", label: "My profile", icon: "users", title: "My profile", sub: "Personal, bank and emergency details", hidden: true, roles: ["employee", "sales", "hr", "admin", "finance"] },
];
export const HOME_OF: Record<HrRoleId, string> = { employee: "home", sales: "slhome", hr: "hrhome", admin: "sahome", finance: "finhome" };

export const hasModule = (role: HrRoleId, perms: Perms, m: ModuleId) => role === "admin" || perms[role].includes(m);
export const canOpen = (role: HrRoleId, perms: Perms, s: ScreenDef) => !!s.roles?.includes(role) || (!!s.module && hasModule(role, perms, s.module));
export const screensFor = (role: HrRoleId, perms: Perms) => SCREENS.filter((s) => canOpen(role, perms, s));

export const LEAVE_TYPES = [
  { id: "casual", label: "Casual Leave", short: "Casual" }, { id: "sick", label: "Sick Leave", short: "Sick" },
  { id: "privilege", label: "Privilege Leave", short: "Privilege" }, { id: "comp", label: "Comp Off", short: "Comp off" },
] as const;
export type LeaveTypeId = (typeof LEAVE_TYPES)[number]["id"];
export const LEAVE_IDS = LEAVE_TYPES.map((l) => l.id) as [LeaveTypeId, ...LeaveTypeId[]];
export const leaveLabel = (id: string) => LEAVE_TYPES.find((l) => l.id === id)?.label ?? id;

export const CLAIM_TYPES = ["AI tool subscription", "Medical bill", "Internet reimbursement", "Travel", "Other"] as const;
export const CLAIM_STATUS: Record<string, string> = { pending_hr: "Pending HR", pending_admin: "Pending Admin", approved: "Approved", rejected: "Rejected" };
export const BREAKS = ["Tea / coffee", "Lunch", "Personal", "Meeting away from desk"] as const;
export const PRIORITIES = ["High", "Medium", "Low"] as const;
export const BOARD_COLS = [
  { id: "backlog", label: "Backlog" }, { id: "todo", label: "To Do" }, { id: "progress", label: "In Progress" }, { id: "review", label: "Review" }, { id: "done", label: "Done" },
] as const;
export type ColId = (typeof BOARD_COLS)[number]["id"];
export const COL_IDS = BOARD_COLS.map((c) => c.id) as [ColId, ...ColId[]];
export const PROJECT_STATUS = ["Planning", "In progress", "On hold", "Done"] as const;
export const ASSET_KINDS = ["Laptop", "Monitor", "Phone", "Access card", "Keyboard & mouse", "Headset", "Other"] as const;
export const EMP_TYPES = ["Full-time", "Part-time", "Contract", "Internship"] as const;
export const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship"] as const;
export const CAND_STAGES = [{ id: "applied", label: "Applied" }, { id: "interview", label: "Interview" }, { id: "offer", label: "Offer" }, { id: "hired", label: "Hired" }] as const;
export const TICKET_TOPICS = ["Payroll", "Leave", "Attendance", "Documents", "IT & access", "Other"] as const;
export const ONBOARD_STEPS = ["Documents", "Laptop", "Access card", "Buddy assigned", "Training plan"] as const;
export const DEFAULT_DEPTS = ["Leadership", "HR", "Finance", "Sales", "Engineering", "Product", "Customer Care", "Operations"];

export type Settings = {
  company: { name: string; address: string; gstin: string; state: string; phone: string; email: string; bank: string };
  checkin: boolean; // employees check in and out; missed working days count as loss of pay
  lateAfter: string; // HH:MM, India time
  leave: Record<LeaveTypeId, number>; // days a year
  ptax: number; // professional tax a month, rupees
  payDay: number;
};
export const DEFAULT_SETTINGS: Settings = {
  company: { name: "Medoro", address: "", gstin: "", state: "", phone: "", email: "", bank: "" },
  checkin: true, lateAfter: "10:00", leave: { casual: 12, sick: 12, privilege: 15, comp: 0 }, ptax: 200, payDay: 1,
};

// ── Finance registers. Each is a simple table: the columns below, the status choices, and which column holds money.
export type Register = { id: string; label: string; list: string; act: string; cols: string[]; status: string[]; money?: number; prefix?: string };
const reg = (id: string, label: string, list: string, act: string, cols: string[], status: string[], money?: number, prefix?: string): Register => ({ id, label, list, act, cols, status, money, prefix });
export const REGISTERS: Record<string, Register[]> = {
  fin_contacts: [reg("contacts", "Contacts", "Customers & vendors", "New contact", ["Name", "Type", "Phone", "GSTIN", "Status"], ["Active", "Inactive"])],
  fin_sales: [
    reg("invoices", "Invoices", "Invoices", "New invoice", ["Invoice #", "Client", "Amount", "Status"], ["Draft", "Sent", "Paid", "Overdue"], 2, "INV"),
    reg("quotes", "Quotations", "Quotations & estimates", "New quote", ["Quote #", "Client", "Amount", "Status"], ["Draft", "Sent", "Accepted", "Expired"], 2, "QT"),
    reg("receipts", "Payment Receipts", "Payment receipts", "Record payment", ["Receipt #", "Client", "Amount", "Mode"], ["NEFT", "UPI", "Cheque", "Cash"], 2, "RCPT"),
    reg("orders", "Sales Orders", "Sales orders", "New order", ["Order #", "Client", "Amount", "Status"], ["Open", "Processing", "Fulfilled", "Cancelled"], 2, "SO"),
    reg("credit", "Credit Notes", "Credit notes", "New credit note", ["Note #", "Client", "Amount", "Status"], ["Open", "Applied"], 2, "CN"),
    reg("proforma", "Proforma", "Proforma invoices", "New proforma", ["Proforma #", "Client", "Amount", "Status"], ["Pending", "Converted", "Cancelled"], 2, "PI"),
    reg("challans", "Delivery Challans", "Delivery challans", "New challan", ["Challan #", "Client", "Items", "Status"], ["In transit", "Delivered", "Returned"], undefined, "DC"),
  ],
  fin_purchases: [
    reg("expenses", "Bills & Expenses", "Purchases & expenses", "New expense", ["Bill #", "Vendor", "Amount", "GST", "Status"], ["Due", "Paid"], 2, "BILL"),
    reg("pos", "Purchase Orders", "Purchase orders", "New purchase order", ["PO #", "Vendor", "Amount", "Status"], ["Open", "Received", "Cancelled"], 2, "PO"),
    reg("debit", "Debit Notes", "Debit notes", "New debit note", ["Note #", "Vendor", "Amount", "Status"], ["Open", "Applied"], 2, "DN"),
    reg("vendors", "Vendors", "Vendors & suppliers", "New vendor", ["Vendor", "Category", "Payable", "Status"], ["Active", "On hold"], 2),
    reg("vleads", "Vendor Leads", "Vendor leads", "New vendor lead", ["Vendor", "Category", "Est. value", "Status"], ["New", "Contacted", "Shortlisted"], 2),
  ],
  fin_accounting: [
    reg("accounts", "Chart of Accounts", "Chart of accounts", "New account", ["Account", "Type", "Opening balance", "Status"], ["Active", "Closed"], 2),
    reg("journals", "Journal Entries", "Journal entries", "Journal entry", ["Entry #", "Debit account", "Credit account", "Amount", "Narration"], [], 3, "JV"),
  ],
  fin_salescrm: [reg("deals", "Deals", "Open deals", "New deal", ["Deal", "Contact", "Value", "Stage"], ["Discovery", "Qualified", "Proposal", "Negotiation", "Won", "Lost"], 2)],
  fin_mktgcrm: [reg("campaigns", "Campaigns", "Campaigns", "New campaign", ["Campaign", "Channel", "Reach", "Status"], ["Scheduled", "Running", "Paused", "Done"])],
  fin_products: [reg("products", "Items", "Products & stock", "New product", ["Product", "SKU", "Stock", "Unit price", "Status"], ["In stock", "Low stock", "Out of stock"], 3)],
  fin_banking: [
    reg("bank", "Bank Accounts", "Bank accounts", "Add account", ["Account", "Bank", "Balance", "Status"], ["Reconciled", "Pending"], 2),
    reg("payments", "Payments Made", "Payments made", "Record payment", ["Ref #", "Paid to", "Amount", "Mode"], ["NEFT", "UPI", "Cheque", "Cash"], 2, "PAY"),
  ],
};
export const ALL_REGISTERS = Object.values(REGISTERS).flat();
export const registerOf = (id: string) => ALL_REGISTERS.find((r) => r.id === id);

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11" → "November 2026" */
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
