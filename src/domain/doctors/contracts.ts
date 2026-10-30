import { z } from "zod";

const opt = (max: number) => z.string().trim().max(max).default("");

export const doctorSchema = z.object({
  name: z.string().trim().max(120).transform((s) => s.replace(/^dr\.?\s+/i, "").trim()).refine((s) => s.length >= 2, "Enter the doctor’s name."),
  qualification: opt(80),
  regNo: z.string().trim().max(40).regex(/^[A-Za-z0-9/.\- ]*$/, "Registration number: letters, digits, / . and - only.").default("").transform((s) => s.toUpperCase().replace(/\s+/g, " ")),
  clinic: opt(120),
  phone: z.string().default("").transform((s) => s.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "")).refine((p) => p === "" || /^\d{10,12}$/.test(p), "Enter a valid phone number."),
  address: opt(300),
});
export type DoctorInput = z.input<typeof doctorSchema>;

export const doctorLabel = (d: { name: string; qualification?: string | null; regNo?: string | null }) =>
  `Dr ${d.name}${d.qualification ? `, ${d.qualification}` : ""}${d.regNo ? ` · Reg ${d.regNo}` : ""}`;

const r2 = (p: number) => (p / 100).toFixed(2);

type Report = { fromDay: string; toDay: string; rows: { name: string; regNo: string | null; clinic: string | null; linked: boolean; bills: number; rxBills: number; gross: number; returns: number; net: number; last: string }[]; total: { bills: number; gross: number; returns: number; net: number } };

/** CSV rows for the sales-by-doctor report (amounts in rupees). */
export function doctorSalesCsv(rep: Report, branchName: string) {
  return [
    [`Sales by doctor · ${branchName} · ${rep.fromDay} to ${rep.toDay}`],
    ["Doctor", "Registration no.", "Clinic", "Linked to doctor master", "Bills", "Rx bills", "Gross ₹", "Returns ₹", "Net ₹", "Last bill"],
    ...rep.rows.map((r) => [r.name, r.regNo ?? "", r.clinic ?? "", r.linked ? "Yes" : "No (typed name)", r.bills, r.rxBills, r2(r.gross), r2(r.returns), r2(r.net), r.last.slice(0, 10)]),
    ["Total", "", "", "", rep.total.bills, "", r2(rep.total.gross), r2(rep.total.returns), r2(rep.total.net), ""],
  ];
}
