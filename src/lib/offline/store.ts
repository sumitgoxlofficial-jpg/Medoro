/**
 * Device-side storage for offline billing (browser IndexedDB). Holds the device id, the last
 * snapshot from the server and the queue of bills made offline. Nothing here is trusted by the
 * server: every bill is rechecked when it syncs.
 */
import type { OfflineSnapshot, OfflineOpInput, SyncResult } from "@/domain/sales/offline-types";
import { baseQty } from "@/lib/units";

export type Device = { deviceId: string; name: string; tenant: string; branchId: string };
export type QueuedBill = OfflineOpInput & {
  state: "pending" | "posted" | "conflict";
  invoiceNo?: string; message?: string; sentAt?: string; cashier?: string;
  view: { name: string; batchNo: string; qty: number; mrpPaise: number; unit?: string }[];
};

const DB = "medoro-offline", STORE = "kv";
let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  }));
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const q = fn(t.objectStore(STORE));
    t.oncomplete = () => res(q.result);
    t.onerror = () => rej(t.error);
  });
}
export const get = <T,>(k: string) => tx<T | undefined>("readonly", (s) => s.get(k) as IDBRequest<T | undefined>);
export const put = (k: string, v: unknown) => tx("readwrite", (s) => s.put(v, k));
export const del = (k: string) => tx("readwrite", (s) => s.delete(k));

export const getDevice = () => get<Device>("device");
export const getSnapshot = () => get<OfflineSnapshot>("snapshot");
export const getQueue = async () => (await get<QueuedBill[]>("queue")) ?? [];

/** Appends or replaces bills by id. Keeps posted bills for 7 days as a local history. */
export async function saveQueue(bills: QueuedBill[]) {
  const week = Date.now() - 7 * 86_400_000;
  await put("queue", bills.filter((b) => b.state !== "posted" || new Date(b.createdAt).getTime() > week).slice(-500));
}

/** Random id that works without a secure context (crypto.randomUUID needs HTTPS). */
export function randomId(prefix: string) {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return prefix + Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function nextReceipt(deviceId: string) {
  const n = ((await get<number>("receiptSeq")) ?? 0) + 1;
  await put("receiptSeq", n);
  return `OFF-${deviceId.slice(0, 4).toUpperCase()}-${String(n).padStart(4, "0")}`;
}

/** Stock units of each batch this device may still sell: its allowance minus bills not yet posted. */
export function remaining(snap: OfflineSnapshot, queue: QueuedBill[]) {
  const left: Record<string, number> = {};
  const ps = new Map(snap.medicines.map((m) => [m.id, m.packSize ?? 1]));
  for (const b of snap.batches) left[b.id] = b.allowance;
  for (const bill of queue) {
    if (bill.state !== "pending") continue;
    for (const l of bill.sale.lines) if (l.batchId in left) left[l.batchId] -= baseQty(l.qty, l.unit, ps.get(l.medicineId) ?? 1);
  }
  return left;
}

/** Sends pending bills, then refreshes the snapshot. Uses the device's normal session cookie. */
export async function syncNow(): Promise<{ sent: number; posted: number; conflicts: number; error?: string }> {
  const dev = await getDevice();
  if (!dev) return { sent: 0, posted: 0, conflicts: 0, error: "Offline billing isn’t set up on this device." };
  let queue = await getQueue();
  const pending = queue.filter((b) => b.state === "pending");
  let posted = 0, conflicts = 0;
  for (let i = 0; i < pending.length; i += 50) {
    const chunk = pending.slice(i, i + 50);
    const ops = chunk.map(({ id, createdAt, baseVersion, receipt, cashierId, sale }) => ({ id, createdAt, baseVersion, receipt, cashierId, sale }));
    const r = await fetch("/api/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: dev.deviceId, ops }), credentials: "same-origin" });
    const j = (await r.json().catch(() => ({}))) as { results?: SyncResult[]; error?: string };
    if (!r.ok || !j.results) return { sent: i, posted, conflicts, error: j.error ?? `Server said ${r.status}.` };
    const byId = new Map(j.results.map((x) => [x.id, x]));
    const now = new Date().toISOString();
    queue = queue.map((b) => {
      const x = byId.get(b.id);
      if (!x) return b;
      if (x.status === "posted") posted++; else conflicts++;
      return { ...b, state: x.status, invoiceNo: x.invoiceNo, message: x.message, sentAt: now };
    });
    await saveQueue(queue);
  }
  const s = await fetch(`/api/offline/snapshot?device=${encodeURIComponent(dev.deviceId)}`, { credentials: "same-origin", cache: "no-store" });
  const sj = (await s.json().catch(() => ({}))) as OfflineSnapshot & { error?: string };
  if (!s.ok) return { sent: pending.length, posted, conflicts, error: sj.error ?? `Server said ${s.status}.` };
  await put("snapshot", sj);
  return { sent: pending.length, posted, conflicts };
}
