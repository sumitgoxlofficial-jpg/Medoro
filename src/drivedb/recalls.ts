/**
 * Recall notices on the device database (counter version of /app/recalls). The pharmacy records only notices from
 * verified sources (CDSCO, state drug controller, manufacturer); Medoro never makes one up. Each notice names a
 * medicine and batch numbers, matched against batches in every branch this counter knows (other branches' batches
 * arrive by sync). Blocking stock uses the same batch status as the Stock screen (ops.setBatchStatus), plus a
 * zero-quantity stock movement so the block is on record against the notice.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { setBatchStatus } from "./ops";
import { daysTo, todayISO } from "@/lib/dates";

export const RECALL_STATUS = ["open", "investigating", "supplier_return", "resolved"] as const;
export type RecallStatus = (typeof RECALL_STATUS)[number];

export const recallInput = z.object({
  medicineId: z.string().min(1, "Choose the medicine from your catalogue."),
  batches: z.string().trim().min(1, "Enter the affected batch numbers."),
  source: z.string().trim().min(3, "Enter where the notice came from.").max(200),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the publication date."),
  reason: z.string().trim().max(200).default(""),
  series: z.string().min(1), userId: z.string().min(1),
});

type Row = { id: string; ref: string; source: string; publishedAt: string; product: string; medicineId: string | null; batchNos: string; reason: string; status: RecallStatus; createdAt: string };

/** Batch numbers from a notice: capitals, split on commas, spaces or semicolons, each once. */
export const batchNos = (s: string) => [...new Set(s.toUpperCase().split(/[\s,;]+/).filter(Boolean))];

/** Records a verified notice. Numbered per counter (series-RCn). */
export function addRecall(db: DriveDB, input: z.input<typeof recallInput>) {
  const i = recallInput.parse(input);
  const nos = batchNos(i.batches);
  if (!nos.length) throw new CounterError("Enter the affected batch numbers.");
  if (nos.some((n) => n.length > 40) || nos.length > 100) throw new CounterError("Check the batch numbers: up to 100, each up to 40 characters.");
  if (daysTo(i.publishedAt) > 0) throw new CounterError("Publication date can’t be in the future.");
  return db.transaction(() => {
    const m = db.engine.all<{ id: string; name: string; strength: string }>("SELECT id, name, strength FROM medicine WHERE id = ? AND deletedAt IS NULL", [i.medicineId])[0];
    if (!m) throw new CounterError("Medicine not found.");
    const ref = `${i.series}-RC${db.nextSeq(`RC:${i.series}`)}`;
    const r = db.from<Row>("recall").insert({
      ref, source: i.source, publishedAt: i.publishedAt, product: `${m.name} ${m.strength ?? ""}`.trim(), medicineId: m.id, batchNos: JSON.stringify(nos),
      reason: i.reason || "Not specified", status: "open", userId: i.userId, createdAt: new Date().toISOString(),
    })[0];
    return { id: r.id, ref };
  });
}

const recall = (db: DriveDB, id: string) => {
  const r = db.from<Row>("recall").eq("id", id).first();
  if (!r) throw new CounterError("Recall not found.");
  return { ...r, nos: JSON.parse(r.batchNos) as string[] };
};

type Match = { id: string; branchId: string; medicineId: string; medicine: string; batchNo: string; expiryDate: string; status: string; qty: number };

/** Batches a notice affects: its batch numbers on its medicine (the same number on another medicine isn't affected). */
function matches(db: DriveDB, r: { medicineId: string | null; nos: string[] }): Match[] {
  if (!r.nos.length) return [];
  return db.engine.all<Match>(
    `SELECT b.id, b.branchId, b.medicineId, m.name AS medicine, b.batchNo, b.expiryDate, b.status,
            COALESCE((SELECT SUM(s.qty) FROM stockMovement s WHERE s.batchId = b.id), 0) AS qty
       FROM batch b JOIN medicine m ON m.id = b.medicineId
      WHERE b.deletedAt IS NULL AND UPPER(b.batchNo) IN (${r.nos.map(() => "?").join(", ")}) ${r.medicineId ? "AND b.medicineId = ?" : ""}
      ORDER BY b.branchId, b.batchNo`, r.medicineId ? [...r.nos, r.medicineId] : r.nos).map((b) => ({ ...b, qty: Number(b.qty) }));
}

/** Notices, newest first, each with matching stock in every branch. `branches` names the branch ids. */
export function listRecalls(db: DriveDB, branches: { id: string; name: string }[] = [], today = todayISO()) {
  return db.from<Row>("recall").order("createdAt", { ascending: false }).all().map((r) => {
    const nos = JSON.parse(r.batchNos) as string[];
    return {
      id: r.id, ref: r.ref, product: r.product, source: r.source, publishedAt: r.publishedAt, reason: r.reason, status: r.status, batchNos: nos, createdAt: r.createdAt,
      matches: matches(db, { medicineId: r.medicineId, nos }).map((b) => ({
        id: b.id, branchId: b.branchId, branch: branches.find((x) => x.id === b.branchId)?.name ?? "", medicine: b.medicine, batchNo: b.batchNo, qty: b.qty, status: b.status,
        sellable: b.status === "ok" && b.qty > 0 && daysTo(b.expiryDate, today) > 0,
      })),
    };
  });
}

/**
 * Blocks every matching batch in every branch from sale: "quarantine" (held while checking) or "recalled" (going
 * back). Batches already blocked the same way are left alone; recalling also moves quarantined batches on. An open
 * notice becomes "investigating". Returns how many batches were blocked.
 */
export function blockRecall(db: DriveDB, input: { recallId: string; userId: string; status?: "quarantine" | "recalled" }) {
  const to = input.status ?? "quarantine";
  if (to !== "quarantine" && to !== "recalled") throw new CounterError("Unknown status.");
  return db.transaction(() => {
    const r = recall(db, input.recallId);
    const from = to === "quarantine" ? ["ok"] : ["ok", "quarantine"];
    const bs = matches(db, r).filter((b) => from.includes(b.status));
    const at = new Date().toISOString();
    for (const b of bs) {
      setBatchStatus(db, b.id, to);
      db.from("stockMovement").insert({ branchId: b.branchId, batchId: b.id, qty: 0, type: to === "quarantine" ? "quarantine" : "recall", refType: "recall", refId: r.id, userId: input.userId, at, note: `Recall ${r.ref}` });
    }
    if (r.status === "open" && bs.length) db.from("recall").eq("id", r.id).update({ status: "investigating" });
    return bs.length;
  });
}

/** Changes a notice's status (open → investigating → supplier return raised → resolved, in any order). */
export function setRecallStatus(db: DriveDB, id: string, status: RecallStatus) {
  if (!RECALL_STATUS.includes(status)) throw new CounterError("Unknown status.");
  recall(db, id);
  db.from("recall").eq("id", id).update({ status });
  return status;
}
