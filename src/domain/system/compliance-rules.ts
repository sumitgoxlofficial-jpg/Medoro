/**
 * Compliance centre rules (pure, tested).
 *
 * Nothing here states what Indian law requires. The kinds below are labels the pharmacy picks from; which ones it needs,
 * how far ahead to be reminded and how long it keeps each class of record are its own configuration and must be confirmed
 * with a qualified regulatory adviser. The suggested defaults are marked as suggestions on screen.
 */
export const KINDS = [
  ["retail_licence", "Retail drug licence"],
  ["wholesale_licence", "Wholesale drug licence"],
  ["pharmacist_registration", "Registered pharmacist"],
  ["narcotics_licence", "Narcotic / psychotropic licence (if you hold one)"],
  ["gst_registration", "GST registration"],
  ["establishment", "Shop and establishment registration"],
  ["other", "Other"],
] as const;
export type Kind = (typeof KINDS)[number][0];
export const kindLabel = (k: string) => KINDS.find(([x]) => x === k)?.[1] ?? k;

export const DEFAULT_REMIND_DAYS = [60, 30, 7] as const;
/** A suggestion shown to the owner to start from, not a statement of what is required. */
export const SUGGESTED_REQUIRED: { kind: Kind; scope: "branch" | "pharmacy" }[] = [{ kind: "retail_licence", scope: "branch" }, { kind: "pharmacist_registration", scope: "branch" }];
export type Required = { kind: string; scope: "branch" | "pharmacy" };

export const INSPECTION_OUTCOMES = [["no_findings", "No findings"], ["observations", "Observations"], ["non_compliance", "Non-compliance noted"]] as const;

export type ItemStatus = "no_expiry" | "valid" | "expiring" | "expired";
const DAY = 86400_000;
export const daysLeft = (expiresOn: string, today: string) => Math.round((Date.parse(expiresOn) - Date.parse(today)) / DAY);

/** Expiring = within the item's own widest reminder window. */
export function statusOf(expiresOn: string | null, today: string, remindDays: readonly number[]): ItemStatus {
  if (!expiresOn) return "no_expiry";
  const d = daysLeft(expiresOn, today);
  if (d < 0) return "expired";
  return d <= Math.max(0, ...remindDays) ? "expiring" : "valid";
}

/**
 * The one reminder to send now, or null. For an item that has not expired, it is the tightest threshold that has been
 * crossed (daysLeft <= threshold) and not yet sent; thresholds wider than that are treated as covered, so a licence
 * entered 20 days before expiry gets one reminder, not three. An expired item gets threshold 0 once.
 */
export function dueReminder(expiresOn: string | null, today: string, remindDays: readonly number[], sent: readonly number[]): number | null {
  if (!expiresOn) return null;
  const d = daysLeft(expiresOn, today);
  if (d < 0) return sent.includes(0) ? null : 0;
  const crossed = [...remindDays].filter((t) => t > 0 && d <= t).sort((a, b) => a - b);
  if (!crossed.length) return null;
  const tightest = crossed[0];
  return sent.some((s) => s <= tightest && s > 0) ? null : tightest;
}

export type ItemLite = { id: string; branchId: string | null; kind: string; active: boolean; status: ItemStatus };
/** Required kinds with no active, unexpired item for the branch (branch scope) or the pharmacy. An expired item does not satisfy a requirement. */
export function missingRequired(branchId: string, items: readonly ItemLite[], required: readonly Required[]): string[] {
  return required.filter((r) => !items.some((i) => i.active && i.kind === r.kind && i.status !== "expired" && (r.scope === "pharmacy" ? i.branchId === null : i.branchId === branchId))).map((r) => r.kind);
}

export const normalizeRemindDays = (v: readonly number[] | undefined) => {
  const out = [...new Set((v ?? DEFAULT_REMIND_DAYS).map(Math.round).filter((n) => n > 0 && n <= 365))].sort((a, b) => b - a);
  return out.length ? out : [...DEFAULT_REMIND_DAYS];
};
