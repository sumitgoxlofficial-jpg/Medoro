/**
 * Doctors on the device database (counter version of /app/doctors): the doctor master, and sales by referring
 * doctor. Bills keep the prescriber's name and registration no. as typed at the counter (`sale.prescriber`,
 * `sale.prescriberReg`); the report links a bill to a doctor by registration no., else by name when exactly one
 * doctor has it. Bills that match no doctor show under the typed name, marked unlinked (as on the web).
 */
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { doctorSchema, type DoctorInput } from "@/domain/doctors/contracts";
import { addDays, istMidnight } from "@/lib/dates";

export type Doctor = { id: string; name: string; qualification: string | null; regNo: string | null; clinic: string | null; phone: string | null; address: string | null; active: boolean };
type Raw = Omit<Doctor, "active"> & { active: number };

const out = (d: Raw): Doctor => ({ id: d.id, name: d.name, qualification: d.qualification, regNo: d.regNo, clinic: d.clinic, phone: d.phone, address: d.address, active: !!Number(d.active) });

/** Registration numbers compare in capitals with single spaces (as the web stores them). */
export const normReg = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
/** A typed prescriber name, for matching: no "Dr", no qualification after a comma, lower case. */
export const normName = (s: string | null | undefined) => (s ?? "").trim().replace(/^dr\.?\s*/i, "").split(/[,·]/)[0].trim().toLowerCase().replace(/\s+/g, " ");

/** The doctor master, active first then A–Z. `q` matches name, registration no., clinic or phone. */
export function listDoctors(db: DriveDB, opts: { q?: string; all?: boolean } = {}): Doctor[] {
  const q = opts.q?.trim().replace(/^dr\.?\s*/i, "");
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return db.engine.all<Raw>(
    `SELECT id, name, qualification, regNo, clinic, phone, address, active FROM doctor
      WHERE deletedAt IS NULL ${opts.all ? "" : "AND active = 1"}
        ${like ? "AND (name LIKE ? ESCAPE '\\' OR regNo LIKE ? ESCAPE '\\' OR clinic LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')" : ""}
      ORDER BY active DESC, name COLLATE NOCASE LIMIT 2000`, like ? [like, like, like, like] : []).map(out);
}

const fields = (i: ReturnType<typeof doctorSchema.parse>) => ({ name: i.name, qualification: i.qualification || null, regNo: i.regNo || null, clinic: i.clinic || null, phone: i.phone || null, address: i.address || null });

function checkDup(db: DriveDB, regNo: string, except?: string) {
  if (!regNo) return;
  const d = db.engine.all<{ id: string; name: string }>("SELECT id, name FROM doctor WHERE deletedAt IS NULL AND regNo = ? AND id IS NOT ?", [regNo, except ?? null])[0];
  if (d) throw new CounterError(`Registration ${regNo} is already on file for Dr ${d.name}.`);
}

/** Adds a doctor (anyone billing can, as on the web, so the counter can add one while billing). */
export function addDoctor(db: DriveDB, raw: DoctorInput): Doctor {
  const i = doctorSchema.parse(raw);
  return db.transaction(() => {
    checkDup(db, i.regNo);
    return out(db.from<Raw>("doctor").insert({ ...fields(i), active: true })[0]);
  });
}

/** Edits a doctor, or deactivates / reactivates one (past bills keep their prescriber). */
export function updateDoctor(db: DriveDB, id: string, raw: DoctorInput & { active?: boolean }): Doctor {
  const i = doctorSchema.parse(raw);
  return db.transaction(() => {
    if (!db.from("doctor").eq("id", id).count()) throw new CounterError("Doctor not found.");
    checkDup(db, i.regNo, id);
    db.from("doctor").eq("id", id).update({ ...fields(i), ...(raw.active === undefined ? {} : { active: raw.active }) });
    return out(db.from<Raw>("doctor").eq("id", id).first()!);
  });
}

export type DoctorSalesRow = { key: string; doctorId: string | null; name: string; regNo: string | null; clinic: string | null; linked: boolean; bills: number; rxBills: number; gross: number; returns: number; net: number; last: string };

/**
 * Sales referred by each doctor in a period (IST dates, inclusive) for one branch or all. Returns are credit notes
 * against those bills. Rx bills are bills with at least one scheduled medicine.
 */
export function doctorSales(db: DriveDB, fromDay: string, toDay: string, branchId: string | "all") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || fromDay > toDay) throw new CounterError("Choose a valid period.");
  const from = istMidnight(fromDay).toISOString(), to = istMidnight(addDays(toDay, 1)).toISOString();
  const sales = db.engine.all<{ id: string; prescriber: string | null; prescriberReg: string | null; total: number; at: string; rx: number; returns: number }>(
    `SELECT s.id, s.prescriber, s.prescriberReg, s.totalPaise AS total, s.at,
            EXISTS (SELECT 1 FROM saleItem i JOIN medicine m ON m.id = i.medicineId WHERE i.saleId = s.id AND m.schedule IS NOT NULL AND m.schedule <> '') AS rx,
            COALESCE((SELECT SUM(r.amountPaise) FROM salesReturn r WHERE r.saleId = s.id), 0) AS returns
       FROM sale s
      WHERE s.at >= ? AND s.at < ? ${branchId === "all" ? "" : "AND s.branchId = ?"}
        AND (COALESCE(TRIM(s.prescriber), '') <> '' OR COALESCE(TRIM(s.prescriberReg), '') <> '')`,
    branchId === "all" ? [from, to] : [from, to, branchId]);
  const doctors = listDoctors(db, { all: true });
  const byReg = new Map(doctors.filter((d) => d.regNo).map((d) => [normReg(d.regNo), d]));
  const byName = new Map<string, Doctor[]>();
  for (const d of doctors) byName.set(normName(d.name), [...(byName.get(normName(d.name)) ?? []), d]);

  const rows = new Map<string, DoctorSalesRow>();
  for (const s of sales) {
    const reg = normReg(s.prescriberReg), name = normName(s.prescriber);
    const named = name ? byName.get(name) ?? [] : [];
    // A registration no. on the bill decides; only a bill without one is linked by a name no other doctor shares.
    const d = reg ? byReg.get(reg) ?? null : named.length === 1 ? named[0] : null;
    const key = d ? d.id : reg ? "reg:" + reg : "txt:" + name;
    const typed = (s.prescriber ?? "").trim().replace(/^dr\.?\s*/i, "");
    const row = rows.get(key) ?? { key, doctorId: d?.id ?? null, name: d ? d.name : typed || reg, regNo: d ? d.regNo : reg || null, clinic: d?.clinic ?? null, linked: !!d, bills: 0, rxBills: 0, gross: 0, returns: 0, net: 0, last: "" };
    if (!d && !row.name && typed) row.name = typed;
    row.bills++; row.gross += Number(s.total); row.returns += Number(s.returns);
    if (Number(s.rx)) row.rxBills++;
    if (s.at > row.last) row.last = s.at;
    rows.set(key, row);
  }
  const list = [...rows.values()].map((r) => ({ ...r, net: r.gross - r.returns })).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  const total = list.reduce((a, r) => ({ bills: a.bills + r.bills, gross: a.gross + r.gross, returns: a.returns + r.returns, net: a.net + r.net }), { bills: 0, gross: 0, returns: 0, net: 0 });
  return { fromDay, toDay, branchId, rows: list, total };
}
