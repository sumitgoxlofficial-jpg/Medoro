import { hasModule, type HrRoleId, type ModuleId, type Perms } from "./constants";

/**
 * The HRMS training videos (Hinglish voice and subtitles), recorded on Medoro's own HRMS with fictional "(Demo)" staff
 * and real people blurred. Files live in public/hrms-videos and are served only with a staff video pass (see
 * lib/hrms-video-pass.ts). A video showing a module's screens is listed only for people who have that module;
 * "admin" videos only for the super admin; "all" for everyone. `roles` also lists roles that see a video whatever their
 * modules (the Sales role reaches its own screens by role, not through the leads module).
 */
export type HrVideo = { slug: string; title: string; about: string; seconds: number; access: "all" | "admin" | ModuleId; group: "start" | "me" | "team" | "admin"; roles?: HrRoleId[] };

export const HR_VIDEOS: HrVideo[] = [
  { slug: "complete-hrms-tour", title: "Complete HRMS product tour", about: "Poora Medoro HRMS ek video mein: har role ka dashboard aur main kaam.", seconds: 682, access: "employees", group: "start" },
  { slug: "complete-employee-lifecycle", title: "Complete employee lifecycle", about: "Job opening se hiring, onboarding, kaam, payroll aur exit tak.", seconds: 1172, access: "employees", group: "start" },
  { slug: "offer-letter-to-onboarding", title: "Offer letter to onboarding", about: "Naye employee ka safar: offer letter, pehla login, KYC aur letters accept karna.", seconds: 463, access: "all", group: "start" },
  { slug: "employee-dashboard", title: "Employee dashboard", about: "Selfie check-in, home dashboard, tasks aur apni details.", seconds: 317, access: "all", group: "me" },
  { slug: "attendance", title: "Attendance", about: "Check-in, check-out, idle time aur attendance correction.", seconds: 200, access: "all", group: "me" },
  { slug: "leave", title: "Leave", about: "Leave types, balance, apply karna aur approval.", seconds: 173, access: "all", group: "me" },
  { slug: "performance", title: "Performance", about: "Performance score, leaderboard aur recognition.", seconds: 131, access: "all", group: "me" },
  { slug: "tasks-projects", title: "Tasks and projects", about: "Project banana, task assign karna aur board par kaam.", seconds: 154, access: "all", group: "me" },
  { slug: "documents-policies", title: "Documents", about: "My profile, ID card, KYC documents aur letters.", seconds: 147, access: "all", group: "me" },
  { slug: "notifications", title: "Notifications and chat", about: "Notification bell, announcements aur Team Chat.", seconds: 123, access: "all", group: "me" },
  { slug: "sales-executive", title: "Sales executive dashboard", about: "Target, leads, follow-ups aur incentive.", seconds: 249, access: "leads", group: "team", roles: ["sales"] },
  { slug: "sales-manager", title: "Sales manager and lead distribution", about: "Team leaderboard, leads assign karna aur sales terms.", seconds: 160, access: "leads", group: "team", roles: ["sales"] },
  { slug: "hr-dashboard", title: "HR dashboard", about: "HR ka din: approvals, employees aur onboarding.", seconds: 241, access: "employees", group: "team" },
  { slug: "recruitment", title: "Recruitment", about: "Job openings, candidates, interview aur offer.", seconds: 177, access: "recruitment", group: "team" },
  { slug: "employee-exit", title: "Employee exit", about: "Record exit, last working day aur final settlement.", seconds: 142, access: "employees", group: "team" },
  { slug: "payroll", title: "Payroll", about: "Payroll run, deductions, payslips aur bank file.", seconds: 246, access: "payroll", group: "team" },
  { slug: "finance", title: "Finance dashboard", about: "Payroll cost, reimbursements aur claims.", seconds: 154, access: "finance", group: "team" },
  { slug: "super-admin", title: "Super admin dashboard", about: "Poori company ka dashboard aur admin menu.", seconds: 201, access: "admin", group: "admin" },
  { slug: "roles-permissions", title: "Roles and permissions", about: "Kaun kya dekh aur kar sakta hai: permission matrix.", seconds: 163, access: "admin", group: "admin" },
  { slug: "dashboard-comparison", title: "Dashboards compared", about: "Har department ka dashboard ek saath.", seconds: 176, access: "admin", group: "admin" },
];

export const HR_VIDEO_GROUPS = [
  { id: "start", label: "Start here" }, { id: "me", label: "Your daily work" }, { id: "team", label: "For your role" }, { id: "admin", label: "Super admin" },
] as const;

/** The videos this role may watch. */
export function videosFor(role: HrRoleId, perms: Perms): HrVideo[] {
  return HR_VIDEOS.filter((v) => v.access === "all" || !!v.roles?.includes(role) || (v.access === "admin" ? role === "admin" : hasModule(role, perms, v.access)));
}
