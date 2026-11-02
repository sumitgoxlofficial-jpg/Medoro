"use client";
/**
 * The page side of the device database: starts the worker once and turns calls into messages.
 *   const dev = deviceDb(); await dev.call("open", "C1"); await dev.call("search", "dolo", branchId);
 */
import type { DeviceHandlers } from "./device.worker";
import { DEVICE_CHANGED_EVENT, DRIVEDB_EVENT, LIVE_EVENT } from "./live-events";

type Result<K extends keyof DeviceHandlers> = Awaited<ReturnType<DeviceHandlers[K]>>;

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Whether the live feed is connected (then the counter checks Drive less often and relies on pushes). */
let live = false;
if (typeof window !== "undefined") {
  window.addEventListener(LIVE_EVENT, (e) => {
    live = !!(e as CustomEvent<{ live?: boolean }>).detail?.live;
    if (worker) void api.call("setLive", live).catch(() => undefined);
  });
  // Another counter uploaded changes: fetch them now, and once more shortly after in case Drive's file
  // list hadn't caught up yet.
  window.addEventListener(DRIVEDB_EVENT, (e) => {
    const from = (e as CustomEvent<{ device?: string }>).detail?.device;
    if (!worker || (from && from === deviceId())) return;
    void api.call("syncNow").catch(() => undefined);
    setTimeout(() => { void api.call("syncNow").catch(() => undefined); }, 2500);
  });
}

function start() {
  if (worker) return worker;
  worker = new Worker(new URL("./device.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data?.event === "changed") { window.dispatchEvent(new CustomEvent(DEVICE_CHANGED_EVENT, { detail: { applied: data.applied } })); return; }
    const w = waiting.get(data?.id);
    if (!w) return;
    waiting.delete(data.id);
    if (data.ok) w.resolve(data.result); else w.reject(new Error(data.error));
  };
  worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || "The device database stopped.")); waiting.clear(); worker = null; };
  if (live) worker.postMessage({ id: ++seq, op: "setLive", args: [true] });
  return worker;
}

const api = {
  call<K extends keyof DeviceHandlers>(op: K, ...args: Parameters<DeviceHandlers[K]>): Promise<Result<K>> {
    const w = start(), id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, op, args });
    });
  },
};

/** The page's handle on the device database (one shared handle, so it is safe in hook dependencies). */
export function deviceDb() { return api; }

/** A stable id for this browser, used to stamp its changes and name its invoice series. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem("medoro-device-id");
    if (!id) { id = "D" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase(); localStorage.setItem("medoro-device-id", id); }
    return id;
  } catch { return "D" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase(); }
}
