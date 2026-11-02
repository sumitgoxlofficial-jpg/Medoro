"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n-client";
import { deviceDb } from "@/drivedb/device";
import type { listRecalls, RecallStatus } from "@/drivedb/recalls";
import { dayMonth, todayISO } from "@/lib/dates";
import { card, input, label, errText, type Cfg, type Who } from "./ui";

type R = ReturnType<typeof listRecalls>[number];
type Med = { id: string; name: string; strength?: string };
const ST: Record<RecallStatus, [string, Tone]> = { open: ["Open", "red"], investigating: ["Investigating", "amber"], supplier_return: ["Supplier return raised", "amber"], resolved: ["Resolved", "green"] };
const BATCH_ST: Record<string, string> = { ok: "SELLABLE", quarantine: "quarantined", recalled: "recalled", expired: "expired" };

/**
 * Recall notices from verified sources, matched to this pharmacy's batches in every branch, with one-tap blocking.
 * The owner records notices and blocks stock; everyone sees them. Nothing here is generated automatically.
 */
export function Recalls({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [rows, setRows] = useState<R[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => dev.call("listRecalls").then(setRows).catch((e) => toast(errText(e), "red")), [dev, toast]);
  useEffect(() => { void load(); }, [load, refresh]);

  const act = async (fn: () => Promise<unknown>, ok: (x: unknown) => string | null) => {
    setBusy(true);
    try { const x = await fn(); const m = ok(x); if (m) toast(m, "green"); void load(); } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  const block = (r: R, status: "quarantine" | "recalled") => {
    if (status === "recalled" && !confirm(t("Mark every batch on {ref} as recalled in all branches? It stays blocked from sale until released on Stock.", { ref: r.ref }))) return;
    void act(() => dev.call("blockRecall", { recallId: r.id, userId: who.userId, status }), (n) => (Number(n)
      ? t(status === "quarantine" ? "{n} batch(es) quarantined and blocked at billing." : "{n} batch(es) marked recalled and blocked at billing.", { n: Number(n) })
      : t("Nothing to block: the matching batches are already blocked.")));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[13px] text-ink-2 bg-teal-soft border border-teal-line rounded-[10px] px-3.5 py-2.5">{t("Record only notices from verified sources (CDSCO, state drug controller, manufacturer). Medoro never generates recall notices. It matches the medicine and batch numbers in the notice against stock in every branch.")}</div>
      {rows.length ? rows.map((r) => {
        const [lbl, tone] = ST[r.status] ?? [r.status, "gray"];
        const live = r.matches.filter((m) => m.sellable);
        const blockable = r.matches.filter((m) => m.status === "ok" || m.status === "quarantine");
        return (
          <div key={r.id} className={card + " gap-1.5"}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted">{r.ref}</span><strong className="text-[15px]">{r.product}</strong><Badge tone={tone}>{t(lbl)}</Badge>
              {who.owner && (
                <select value={r.status} aria-label={t("Status")} disabled={busy} onChange={(e) => { const s = e.target.value as RecallStatus; void act(() => dev.call("setRecallStatus", r.id, s), () => t("Status updated.")); }}
                  className="ml-auto border border-line rounded-md px-2 h-8 text-[12.5px] bg-white">
                  {(Object.keys(ST) as RecallStatus[]).map((k) => <option key={k} value={k}>{t(ST[k][0])}</option>)}
                </select>
              )}
            </div>
            <div className="text-[13.5px] text-ink-2">{r.reason} · {t("batches {list}", { list: r.batchNos.join(", ") })}</div>
            <div className="text-xs text-faint">{t("Source: {source} · published {date}", { source: r.source, date: dayMonth(new Date(r.publishedAt + "T00:00:00Z"), true) })}</div>
            {r.matches.length ? (
              <ul className="text-[13px] flex flex-col gap-0.5 pt-1">
                {r.matches.map((m) => (
                  <li key={m.id} style={{ color: m.sellable ? "#B3261E" : undefined }} className={m.sellable ? "" : "text-muted"}>
                    {m.branch || cfg.branchName}: {m.medicine} {m.batchNo} · {t("{n} units", { n: m.qty })} · {t(BATCH_ST[m.status] ?? m.status)}{m.status === "ok" && !m.sellable ? ` (${t(m.qty > 0 ? "expired" : "no stock")})` : ""}
                  </li>
                ))}
              </ul>
            ) : <div className="text-[13px] pt-1" style={{ color: "#1E7F4F" }}>{t("No matching stock in any branch")}</div>}
            {who.owner && blockable.length > 0 && (
              <div className="flex gap-2 flex-wrap pt-1">
                {r.matches.some((m) => m.status === "ok") && <Button size="sm" variant={live.length ? "danger" : "outline"} disabled={busy} onClick={() => block(r, "quarantine")}>{t("Quarantine affected stock")}</Button>}
                <Button size="sm" variant="danger-outline" disabled={busy} onClick={() => block(r, "recalled")}>{t("Mark recalled")}</Button>
              </div>
            )}
          </div>
        );
      }) : (
        <div className="bg-white border border-line rounded-xl py-8 px-4 flex flex-col items-center gap-2 text-center"><ShieldAlert size={24} className="text-fainter" /><div className="font-semibold">{t("No recall notices recorded")}</div><div className="text-[13px] text-faint">{t("When a notice arrives, record it here and the counter checks every branch for the batches.")}</div></div>
      )}
      {who.owner && <RecordNotice cfg={cfg} who={who} onSaved={(ref) => { toast(t("{ref} recorded and matched against stock.", { ref }), "green"); void load(); }} />}
      <div className="text-xs text-faint">{t("To send recalled stock back, raise a return to the supplier, then set the notice to Supplier return raised. Release a batch from the Stock screen if a notice is withdrawn.")}</div>
    </div>
  );
}

function RecordNotice({ cfg, who, onSaved }: { cfg: Cfg; who: Who; onSaved: (ref: string) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const blank = { medicineId: "", medicine: "", batches: "", source: "", publishedAt: "", reason: "" };
  const [f, setF] = useState(blank);
  const [meds, setMeds] = useState<Med[]>([]);
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  useEffect(() => {
    if (f.medicineId || !f.medicine.trim()) { setMeds([]); return; }
    const h = setTimeout(() => dev.call("search", f.medicine, cfg.branchId).then((r) => setMeds(r as Med[])).catch(() => setMeds([])), 120);
    return () => clearTimeout(h);
  }, [f.medicine, f.medicineId, dev, cfg.branchId]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await dev.call("addRecall", { medicineId: f.medicineId, batches: f.batches, source: f.source, publishedAt: f.publishedAt, reason: f.reason, series: cfg.series, userId: who.userId });
      setF(blank); onSaved(r.ref);
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  return (
    <div className={card}>
      <div className="font-semibold">{t("Record a verified notice")}</div>
      <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-[2fr_1.5fr_1.5fr_160px]">
        <label className={label + " relative"}>{t("Medicine *")}
          <input className={input} value={f.medicine} onChange={(e) => setF({ ...f, medicine: e.target.value, medicineId: "" })} placeholder={t("From catalogue")} aria-label={t("Medicine")} autoComplete="off" />
          {meds.length > 0 && (
            <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow divide-y divide-line max-h-56 overflow-auto text-ink">
              {meds.map((m) => <li key={m.id}><button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-page cursor-pointer" onClick={() => { setF({ ...f, medicineId: m.id, medicine: `${m.name} ${m.strength ?? ""}`.trim() }); setMeds([]); }}>{m.name} <span className="text-muted">{m.strength ?? ""}</span></button></li>)}
            </ul>
          )}
        </label>
        <label className={label}>{t("Batches (comma separated) *")}
          <input className={input} value={f.batches} onChange={(e) => setF({ ...f, batches: e.target.value.toUpperCase() })} placeholder={t("e.g. AB123, AB124")} aria-label={t("Batches")} />
        </label>
        <label className={label}>{t("Source & reference no. *")}
          <input className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder={t("e.g. CDSCO alert no.")} aria-label={t("Source")} />
        </label>
        <label className={label}>{t("Published on *")}
          <input className={input} type="date" max={today} value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} aria-label={t("Published on")} />
        </label>
        <label className={label + " col-span-full"}>{t("Reason")}
          <input className={input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={t("As stated in the notice")} aria-label={t("Reason")} />
        </label>
      </div>
      <Button variant="primary" className="self-start" disabled={busy || !f.medicineId || !f.batches.trim() || f.source.trim().length < 3 || !f.publishedAt} onClick={save}>{t("Record & match stock")}</Button>
    </div>
  );
}
