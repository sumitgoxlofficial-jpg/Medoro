"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import { del, getDevice, put, syncNow, type Device } from "@/lib/offline/store";
import { disableOfflineAction, enableOfflineAction, resolveOfflineAction } from "./actions";

type Op = { id: string; deviceId: string; status: string; createdAt: string; receivedAt: string; receipt: string; totalPaise: number; items: number; message: string | null; invoiceNo: string | null; resolution: string | null };
type Props = { devices: { id: string; name: string; branchId: string; lastSeen: string }[]; ops: Op[]; branchId: string; branchName: string; counterName: string | null; canManage: boolean };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2";
const when = (iso: string) => { const d = new Date(iso); return `${dayMonth(d)} · ${hhmm(d)}`; };

export function OfflinePanel({ devices, ops, branchId, branchName, counterName, canManage }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [mine, setMine] = useState<Device | null | undefined>(undefined);
  const [name, setName] = useState(counterName ?? "");
  const [note, setNote] = useState<Record<string, string>>({});
  useEffect(() => { getDevice().then((d) => setMine(d ?? null)).catch(() => setMine(null)); }, []);
  const mineActive = mine && devices.some((d) => d.id === mine.deviceId);

  const enable = () => start(async () => {
    const r = await enableOfflineAction(name);
    if (!r.ok) return toast(r.error, "red");
    const d: Device = { deviceId: r.data.deviceId, name: r.data.name, tenant: r.data.tenant, branchId: r.data.branchId };
    await put("device", d);
    const s = await syncNow();
    navigator.serviceWorker?.controller?.postMessage("warm");
    setMine(d);
    toast(s.error ? `Turned on, but the price list didn’t download: ${s.error}` : "Offline billing is ready on this device. If the connection drops, open Offline billing.", s.error ? "amber" : "green");
    router.refresh();
  });
  const disable = (id: string) => start(async () => {
    const r = await disableOfflineAction(id);
    if (!r.ok) return toast(r.error, "red");
    if (mine?.deviceId === id) { await del("device"); await del("snapshot"); setMine(null); }
    toast(r.message ?? "Turned off.", "green"); router.refresh();
  });
  const resolve = (id: string, action: "repost" | "partial" | "close") => start(async () => {
    const r = await resolveOfflineAction(id, action, note[id] ?? "");
    toast(r.ok ? r.message ?? "Done." : r.error, r.ok ? "green" : "red");
    if (r.ok) router.refresh();
  });
  const devName = (id: string) => devices.find((d) => d.id === id)?.name ?? "Device";

  return (
    <>
      <div className={card}>
        <div className="flex items-center gap-2 font-semibold text-[15px]"><CloudOff size={17} className="text-teal" />Offline billing</div>
        <p className="m-0 text-[13.5px] text-ink-2">A counter with offline billing keeps a copy of your price list and a reserved share of each batch, so it can keep billing when the connection to your server drops. Bills post with their original time when it’s back; the server rechecks stock, prices and permissions first.</p>
        {mine === undefined ? null : mineActive ? (
          <div className="flex items-center gap-2 flex-wrap bg-teal-soft border border-teal-line rounded-lg px-3 py-2 text-[13.5px]">
            <Badge tone="green">On for this device</Badge><span className="flex-1">{mine!.name}. If the connection drops, Medoro opens offline billing here.</span>
            <a href="/offline"><Button><Download size={14} />Open offline billing</Button></a>
          </div>
        ) : canManage ? (
          <form onSubmit={(e) => { e.preventDefault(); enable(); }} className="flex gap-2 flex-wrap items-end">
            <label className="flex flex-col gap-1 text-[12.5px] text-muted flex-1 min-w-[200px]">Name this device ({branchName})
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Counter 1" className="border border-input rounded-lg px-3 py-2 text-[14px] outline-none focus:border-teal bg-white" />
            </label>
            <Button variant="primary" type="submit" disabled={busy}>Turn on for this device</Button>
          </form>
        ) : <span className="text-[13px] text-muted">A manager can turn it on for this device.</span>}
        {devices.length ? (
          <div className="flex flex-col text-[13px] mt-1">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-2 py-1.5 border-t border-row flex-wrap">
                <span className="font-medium">{d.name}</span>
                <span className="text-muted">{d.branchId === branchId ? branchName : "Other branch"} · last synced {when(d.lastSeen)}</span>
                {mine?.deviceId === d.id ? <Badge tone="teal">This device</Badge> : null}
                {canManage ? <Button size="sm" variant="danger-outline" className="ml-auto" disabled={busy} onClick={() => disable(d.id)}>Turn off</Button> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={card}>
        <div className="font-semibold text-[15px]">Offline bills</div>
        {ops.length ? ops.map((o) => (
          <div key={o.id} className="flex flex-col gap-1.5 py-2 border-t border-row text-[13.5px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[12.5px]">{o.invoiceNo ?? o.receipt}</span>
              <span className="text-muted">{devName(o.deviceId)} · billed {when(o.createdAt)} · {o.items} item{o.items === 1 ? "" : "s"}</span>
              <span className="tnum font-medium ml-auto">{inr(o.totalPaise)}</span>
              <Badge tone={o.status === "conflict" ? "red" : o.status === "pending" ? "amber" : "green"}>{o.status === "posted" ? "Posted" : o.status === "resolved" ? "Closed" : o.status === "conflict" ? "Needs review" : "Pending"}</Badge>
            </div>
            {o.message ? <div className={o.status === "conflict" ? "text-bad text-[13px]" : "text-muted text-[12.5px]"}>{o.message}</div> : null}
            {o.resolution ? <div className="text-muted text-[12.5px]">{o.status === "resolved" ? "Closed" : "Settled"}: {o.resolution}</div> : null}
            {o.status === "conflict" && canManage ? (
              <div className="flex gap-2 flex-wrap items-center">
                <Button size="sm" variant="primary" disabled={busy} onClick={() => resolve(o.id, "repost")}>Post from current stock</Button>
                <Button size="sm" disabled={busy} onClick={() => resolve(o.id, "partial")} title="Post the items in stock now; the bill shows the refund due for the rest">Post what’s in stock, refund the rest</Button>
                <input value={note[o.id] ?? ""} onChange={(e) => setNote({ ...note, [o.id]: e.target.value })} placeholder="Or say how it was settled" aria-label="Settlement note" className="border border-input rounded-md px-2 py-1 text-[13px] flex-1 min-w-[180px]" />
                <Button size="sm" disabled={busy} onClick={() => resolve(o.id, "close")}>Close with note</Button>
              </div>
            ) : null}
          </div>
        )) : <div className="text-[13px] text-muted">No offline bills yet.</div>}
      </div>
    </>
  );
}
