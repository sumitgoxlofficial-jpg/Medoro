"use client";
import { useCallback, useEffect, useState } from "react";
import { Link2, RefreshCw, ShieldOff, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { SourceLabel } from "@/domain/finance/providers";

type Provider = { id: string; kind: string; name: string; label: SourceLabel; labelText: string; connectable: boolean; capabilities: { webhook: boolean; minPollMin: number | null; consent: boolean } };
type Conn = { id: string; kind: string; connector: string; status: string; displayName: string; accountMasked: string; consentExpiresAt: string | null; lastSyncAt: string | null; lastError: string | null; lastErrorAt: string | null };
type Log = { id: string; connection: string; trigger: string; startedAt: string; endedAt: string; fetched: number; delivered: number; errors: number; errorCode: string | null };
export type ConnectionsData = { providers: Provider[]; connections: Conn[]; history: Log[] };

const LABEL_TONE: Record<SourceLabel, Tone> = { available: "green", sandbox: "blue", partner_required: "amber", unsupported: "gray" };
const STATUS: Record<string, [string, Tone]> = {
  pending: ["Waiting for the provider", "amber"], active: ["Connected", "green"], expired: ["Consent expired", "red"], revoked: ["Revoked", "gray"], error: ["Not syncing", "red"], disconnected: ["Disconnected", "gray"],
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN") : "never");
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j;
}

/**
 * Bank, Account Aggregator and payment-provider connections. A Connect button shows only for a connector Medoro has
 * live (none until a partner agreement is signed); the rest show where they stand.
 */
export function ConnectionsPanel({ initial, canManage, showStatus = true }: { initial?: ConnectionsData | null; canManage: boolean; showStatus?: boolean }) {
  const toast = useToast();
  const [d, setD] = useState<ConnectionsData | null>(initial ?? null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [p, c, h] = await Promise.all([call("GET", "/api/financial-connections/providers"), call("GET", "/api/financial-connections"), call("GET", "/api/financial-connections/history")]);
      setD({ providers: p.providers as Provider[], connections: c.connections as Conn[], history: h.history as Log[] }); setOffline(false);
    } catch { setOffline(true); }
  }, []);
  useEffect(() => { if (!initial) void load(); }, [initial, load]);

  const act = async (key: string, fn: () => Promise<Record<string, unknown>>, ok: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (typeof r.redirectUrl === "string") { window.location.assign(r.redirectUrl); return; }
      toast(typeof r.warning === "string" && r.warning ? r.warning : ok, r.warning ? "blue" : "green");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "red"); } finally { setBusy(null); }
  };

  if (!d) return <div className={card}><div className="font-semibold">Bank and provider connections</div><div className="text-sm text-muted">{offline ? "Connect to the internet and sign in to see connections." : "Loading…"}</div></div>;
  const live = d.providers.filter((p) => p.connectable);
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <div className="font-semibold">Connected accounts <span className="text-muted font-normal">({d.connections.length})</span></div>
          {canManage && d.connections.some((c) => c.status === "active") && <Button size="sm" disabled={!!busy} onClick={() => act("all", () => call("POST", "/api/transactions/sync"), "Sync queued for every connection.")}><RefreshCw size={14} /> Sync all now</Button>}
        </div>
        {d.connections.length ? (
          <ul className="flex flex-col gap-2">
            {d.connections.map((c) => (
              <li key={c.id} className="border border-line rounded-lg p-3 flex flex-col gap-1 text-sm">
                <div className="flex justify-between items-center gap-2 flex-wrap"><span className="font-medium">{c.displayName} {c.accountMasked && <span className="text-muted font-normal">{c.accountMasked}</span>}</span><Badge tone={STATUS[c.status]?.[1] ?? "gray"}>{STATUS[c.status]?.[0] ?? c.status}</Badge></div>
                <div className="text-[12.5px] text-muted">Last sync: {when(c.lastSyncAt)}{c.consentExpiresAt ? ` · consent until ${c.consentExpiresAt.slice(0, 10)}` : ""}</div>
                {c.lastError && <div className="text-[12.5px] text-bad">Last error ({when(c.lastErrorAt)}): {c.lastError}</div>}
                {canManage && (
                  <div className="flex gap-1 flex-wrap">
                    {c.status === "active" && <Button size="sm" disabled={!!busy} onClick={() => act(c.id, () => call("POST", `/api/financial-connections/bank/${c.id}/sync`), "Sync queued.")}><RefreshCw size={14} /> Sync now</Button>}
                    {(c.status === "expired" || (c.status === "active" && c.consentExpiresAt)) && <Button size="sm" disabled={!!busy} onClick={() => act(c.id, () => call("POST", `/api/financial-connections/bank/${c.id}/consent/refresh`), "")}><RotateCcw size={14} /> Renew consent</Button>}
                    {c.status !== "revoked" && <Button size="sm" disabled={!!busy} onClick={() => { if (confirm(`Revoke ${c.displayName}? Medoro stops fetching and deletes its access.`)) void act(c.id, () => call("POST", `/api/financial-connections/bank/${c.id}/revoke`), "Revoked."); }}><ShieldOff size={14} /> Revoke</Button>}
                    <Button size="sm" disabled={!!busy} onClick={() => { if (confirm(`Disconnect ${c.displayName}? Its history stays.`)) void act(c.id, () => call("DELETE", `/api/financial-connections/${c.id}`), "Disconnected."); }}><Trash2 size={14} /> Disconnect</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <div className="text-sm text-muted">No bank or provider is connected. {live.length ? "Connect one below." : "None can be connected yet (see the status of each below); upload bank statements meanwhile."}</div>}
        {canManage && live.map((p) => (
          <Button key={p.id} className="self-start" disabled={!!busy} onClick={() => act(p.id, () => call("POST", p.kind === "provider" ? `/api/financial-connections/provider/${encodeURIComponent(p.id)}/connect` : "/api/financial-connections/bank/start", p.kind === "provider" ? undefined : { connector: p.id }), "")}>
            <Link2 size={15} /> Connect {p.name}{p.label === "sandbox" ? " (sandbox)" : ""}
          </Button>
        ))}
        <div className="text-[12.5px] text-muted">Connecting always happens on the bank’s or provider’s own page. Medoro never asks for your net-banking password, UPI PIN or OTP.</div>
      </div>
      {d.history.length > 0 && (
        <div className={card}>
          <div className="font-semibold">Sync history</div>
          <div className="overflow-x-auto"><table className="w-full text-sm [&_th]:text-left [&_th]:font-medium [&_th]:text-muted [&_th]:py-1.5 [&_th]:pr-3 [&_td]:py-1.5 [&_td]:pr-3 [&_tr]:border-b [&_tr]:border-line">
            <thead><tr><th>Started</th><th>Finished</th><th>Connection</th><th>Trigger</th><th>Fetched</th><th>Delivered</th><th>Errors</th></tr></thead>
            <tbody>{d.history.map((l) => <tr key={l.id}><td className="whitespace-nowrap">{when(l.startedAt)}</td><td className="whitespace-nowrap">{when(l.endedAt)}</td><td>{l.connection}</td><td>{l.trigger}</td><td>{l.fetched}</td><td>{l.delivered}</td><td className={l.errors ? "text-bad" : ""}>{l.errors ? l.errorCode : ""}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
      {showStatus && <div className={card}>
        <div className="font-semibold">Where each connection stands</div>
        <ul className="flex flex-col gap-2">
          {d.providers.map((p) => <li key={p.id} className="flex justify-between items-center gap-2 flex-wrap text-sm border-b border-line pb-1.5"><span>{p.name}<span className="text-[12px] text-muted block">{p.capabilities.webhook ? "Real-time notifications" : p.capabilities.minPollMin ? `Checked every ${p.capabilities.minPollMin}+ minutes` : "Timing depends on the provider"}{p.capabilities.consent ? " · consent-based" : ""}</span></span><Badge tone={LABEL_TONE[p.label]}>{p.labelText}</Badge></li>)}
        </ul>
      </div>}
    </div>
  );
}
