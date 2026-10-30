export const MAIL_REPORTS = [
  ["sales", "Daily sales summary"],
  ["gst", "GST summary"],
  ["low-stock", "Low stock"],
  ["expiring", "Expiring stock"],
  ["dues", "Customer & supplier dues"],
] as const;
export type MailReportId = (typeof MAIL_REPORTS)[number][0];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type ReportMailSettings = { enabled: boolean; frequency: "daily" | "weekly"; weekday: number; time: string; recipients: string[]; reports: MailReportId[] };
export type ReportMailLast = { at: string; ok: boolean; detail: string };
