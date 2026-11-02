"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Download, Printer, MessageCircle, Trash2, ListPlus, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { useLang, useT } from "@/lib/i18n-client";
import { localeOf } from "@/lib/tr";
import { downloadCsv } from "@/lib/csv";
import { inr, inr0 } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { deviceDb } from "@/drivedb/device";
import { waLink } from "@/drivedb/share";
import { COVERS, SAFETIES, draftCsv, orderText, type Anomaly, type DraftGroup, type DraftLine, type ForecastRow, type Insights as Data, type MarginBy, type SeasonalRow, type seasonal } from "@/drivedb/insights";
import { card, errText, type Cfg, type Who } from "./ui";

const th = "text-left text-[12px] font-medium text-muted px-2.5 py-2 border-b border-line whitespace-nowrap";
const td = "px-2.5 py-2 border-b border-line align-top";
const num = " text-right tabular-nums";
type Seasonal = ReturnType<typeof seasonal>;
type Draft = { at: string | null; groups: DraftGroup[] };
const pct1 = (p: number | null) => (p == null ? "—" : `${p.toFixed(1)}%`);

/**
 * Stock intelligence on the counter (owner and manager): demand forecast and reorder policy, a draft order list to
 * print, export or send to suppliers on WhatsApp, seasonal pre-stock, supplier prices, slow stock, audit signals and
 * margins. Worked out on this device from its own records (src/drivedb/insights.ts); nothing goes to Medoro.
 */
export function Insights({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sea, setSea] = useState<Seasonal | null>(null);
  const [draft, setDraft] = useState<Draft>({ at: null, groups: [] });
  const [tick, setTick] = useState(0);
  const months = (m: number) => new Date(Date.UTC(2026, m, 15)).toLocaleDateString(localeOf(lang), { month: "short" });

  const load = useCallback(async () => {
    try {
      const [x, dr] = await Promise.all([dev.call("intelligence", cfg.branchId, cfg.branches), dev.call("intelDraft")]);
      setD(x); setDraft(dr); setErr(null);
      // The seasonal planner reads up to two years of bills, so it comes after the rest is on screen.
      setSea(await dev.call("intelSeasonal", cfg.branchId));
    } catch (e) { setErr(errText(e)); }
  }, [dev, cfg.branchId, cfg.branches]);
  useEffect(() => { void load(); }, [load, refresh, tick]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok, "green"); } catch (e) { toast(errText(e), "red"); } };
  const addLines = (lines: DraftLine[]) => act(async () => { setDraft(await dev.call("intelAddToDraft", lines)); }, t("{n} item(s) added to the order list.", { n: lines.length }));

  if (err) return <div className={card}><div className="text-sm text-bad">{err}</div></div>;
  if (!d) return <div className={card}><div className="text-sm text-muted">{t("Working out forecasts…")}</div></div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <div className="font-semibold text-[17px]">{t("Stock intelligence")}</div>
        <div className="text-[13px] text-muted">{t("Forecasts, reorder list, supplier prices and anomaly review, from this counter’s own records.")}</div>
      </div>
      <OrderList cfg={cfg} draft={draft} setDraft={setDraft} />
      <Forecast d={d} who={who} onAdd={addLines} onSaved={() => setTick((x) => x + 1)} />
      <SeasonalCard sea={sea} months={months} onAdd={async (items) => addLines(await dev.call("intelLinesFor", cfg.branchId, items))} />
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))]">
        <Prices rows={d.prices} />
        <Slow rows={d.slow} />
      </div>
      <Anomalies rows={d.anomalies} th={d.settings.anomaly} who={who} onChange={() => setTick((x) => x + 1)} />
      {d.central ? <Central plan={d.central} /> : null}
      <Margins m={d.margins} />
    </div>
  );
}

// ---------- draft order list ----------

function OrderList({ cfg, draft, setDraft }: { cfg: Cfg; draft: Draft; setDraft: (d: Draft) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [sups, setSups] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (draft.groups.some((g) => !g.supplierId)) void dev.call("supplierList").then(setSups); }, [dev, draft.groups]);
  const lines = draft.groups.flatMap((g) => g.lines);
  const save = async (next: DraftLine[]) => { try { setDraft(await dev.call("intelSaveDraft", next)); } catch (e) { toast(errText(e), "red"); } };
  const edit = (id: string, patch: Partial<DraftLine>) => save(lines.map((l) => (l.medicineId === id ? { ...l, ...patch } : l)));
  if (!lines.length) return null;

  const share = (g: DraftGroup) => {
    const text = orderText(g, cfg.pharmacy);
    window.open(waLink(g.phone, text) ?? `https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  const total = draft.groups.reduce((a, g) => a + g.valuePaise, 0);
  return (
    <div className={card}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-col flex-1 min-w-[220px]">
          <span className="font-semibold">{t("Order list")}</span>
          <span className="text-[12.5px] text-muted">{t("{n} item(s) · about {value} at last purchase cost. Saved on this counter until you clear it.", { n: lines.length, value: inr0(total) })}</span>
        </div>
        <Button size="sm" onClick={() => downloadCsv(`order-list-${todayISO()}`, draftCsv(draft.groups))}><Download size={14} />{t("CSV")}</Button>
        <Button size="sm" onClick={() => printOrder(draft.groups, cfg)}><Printer size={14} />{t("Print")}</Button>
        <Button size="sm" variant="danger-outline" onClick={() => { if (confirm(t("Clear the whole order list?"))) void save([]); }}><Trash2 size={14} />{t("Clear")}</Button>
      </div>
      {draft.groups.map((g) => (
        <div key={g.supplierId ?? "none"} className="border border-line rounded-lg overflow-auto">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-page text-[13.5px] flex-wrap">
            {g.supplierId ? <strong>{g.supplier}</strong> : (
              <select aria-label={t("Supplier for these items")} className="border border-line rounded-md px-2 h-8 text-[13px] bg-white" value=""
                onChange={(e) => e.target.value && void save(lines.map((l) => (l.supplierId ? l : { ...l, supplierId: e.target.value })))}>
                <option value="">{t("No supplier on record: choose one…")}</option>
                {sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-muted">{inr0(g.valuePaise)}</span>
              {g.supplierId ? <Button size="sm" onClick={() => share(g)} title={g.phone ? undefined : t("No mobile number saved for this supplier: pick the chat in WhatsApp.")}><MessageCircle size={14} />{t("WhatsApp")}</Button> : null}
              <Button size="sm" onClick={() => printOrder([g], cfg)} aria-label={t("Print order for {name}", { name: g.supplier ?? "" })}><Printer size={14} /></Button>
            </span>
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>{g.lines.map((l) => (
              <tr key={l.medicineId}>
                <td className={td}>{l.name}</td>
                <td className={td + num + " max-sm:hidden text-muted"}>{inr(l.ratePaise)}</td>
                <td className={td + " w-[150px]"}>
                  <span className="flex items-center gap-1.5 justify-end">
                    <input type="number" min={1} defaultValue={l.qty} key={`${l.medicineId}:${l.qty}`} aria-label={t("Quantity of {name}", { name: l.name })}
                      onBlur={(e) => { const q = Math.floor(Number(e.target.value)); if (q >= 1 && q !== l.qty) void edit(l.medicineId, { qty: q }); else e.target.value = String(l.qty); }}
                      className="border border-line rounded-md px-2 h-8 w-16 text-right tabular-nums" />
                    <span className="text-muted text-[12px] w-12 truncate">{l.unit}</span>
                    <button className="p-1 text-muted hover:text-bad cursor-pointer" aria-label={t("Remove {name}", { name: l.name })} onClick={() => void save(lines.filter((x) => x.medicineId !== l.medicineId))}><Trash2 size={14} /></button>
                  </span>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** A plain printable order per supplier, in English like the other papers shared with suppliers. */
function printOrder(groups: DraftGroup[], cfg: Cfg) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const ph = cfg.pharmacy, from = esc(ph?.tradeName || ph?.name || cfg.branchName);
  const body = groups.map((g) => `
    <section><h2>Purchase order${g.supplier ? ` · ${esc(g.supplier)}` : ""}</h2>
    <p>${from}${ph?.address ? `<br>${esc(ph.address)}` : ""}${ph?.gstin ? `<br>GSTIN ${esc(ph.gstin)}` : ""}${ph?.dl ? ` · DL ${esc(ph.dl)}` : ""}${ph?.phone ? `<br>Phone ${esc(ph.phone)}` : ""}<br>Date ${new Date().toLocaleDateString("en-IN")}</p>
    <table><thead><tr><th>#</th><th>Medicine</th><th>Qty</th><th>Unit</th><th>Last rate</th></tr></thead><tbody>
    ${g.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="r">${l.qty}</td><td>${esc(l.unit)}</td><td class="r">₹${(l.ratePaise / 100).toFixed(2)}</td></tr>`).join("")}
    </tbody></table><p class="s">Please confirm availability, rates and expiry before dispatch.</p></section>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Purchase order</title><style>
    body{font:13px system-ui,sans-serif;color:#111;margin:24px} h2{font-size:16px;margin:0 0 6px} section{page-break-after:always;margin-bottom:24px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:5px 7px;text-align:left} .r{text-align:right} .s{color:#555}
  </style></head><body>${body}</body></html>`);
  w.document.close(); w.focus(); w.print();
}

// ---------- forecast and policy ----------

function Forecast({ d, who, onAdd, onSaved }: { d: Data; who: Who; onAdd: (l: DraftLine[]) => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const p = d.settings.policy, f = d.forecast;
  const setPolicy = async (cover: number, safety: number) => { try { await dev.call("intelSaveSettings", { policy: { cover, safety } }); onSaved(); } catch (e) { toast(errText(e), "red"); } };
  const why = (r: ForecastRow) => r.why === "out" ? t("Out of stock (reorder level {rl}). Orders enough for {cover} days.", { rl: r.reorderLevel, cover: p.cover })
    : r.why === "below" ? t("Stock {st} is below the reorder level {rl}. Orders enough for {cover} days.", { st: r.stock, rl: r.reorderLevel, cover: p.cover })
    : r.why === "lead" ? t("Stock {st} won’t last the {days}-day lead time plus safety stock. Orders enough for {cover} days.", { st: r.stock, days: r.lead + p.safety, cover: p.cover })
    : r.why === "ok" ? t("Above reorder point") : t("No sales in the last 28 days");
  return (
    <div className={card + " !p-0 overflow-hidden"}>
      <div className="flex items-center gap-2 flex-wrap px-4 pt-3.5">
        <div className="font-semibold mr-auto">{t("Demand forecast & reorder policy")}</div>
        <span className="text-[12.5px] text-muted">{t("Cover")}</span>
        <Segmented size="sm" value={String(p.cover)} onChange={(v) => who.owner ? void setPolicy(Number(v), p.safety) : toast(t("Only the owner can change the policy."), "red")} options={COVERS.map((x) => ({ value: String(x), label: t("{n} d", { n: x }) }))} />
        <span className="text-[12.5px] text-muted">{t("Safety")}</span>
        <Segmented size="sm" value={String(p.safety)} onChange={(v) => who.owner ? void setPolicy(p.cover, Number(v)) : toast(t("Only the owner can change the policy."), "red")} options={SAFETIES.map((x) => ({ value: String(x), label: t("{n} d", { n: x }) }))} />
        <Button variant="primary" size="sm" disabled={!f.needs.length} onClick={() => onAdd(f.needs.map((r) => ({ medicineId: r.id, name: r.name, unit: r.unit, qty: r.suggestion, ratePaise: r.cost, supplierId: r.supplierId })))}>
          <ListPlus size={14} />{t("Add {n} to order list", { n: f.needs.length })}
        </Button>
      </div>
      {f.rows.length ? (
        <div className="overflow-auto max-h-[560px]">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-page"><tr><th className={th}>{t("Medicine")}</th><th className={th + num + " max-sm:hidden"}>{t("28-d avg")}</th><th className={th + num + " max-sm:hidden"}>{t("Next 14 d")}</th><th className={th + num}>{t("Sellable")}</th><th className={th + num}>{t("Cover")}</th><th className={th + num + " max-sm:hidden"}>{t("Reorder pt")}</th><th className={th + num}>{t("Suggest")}</th><th className={th + " max-md:hidden"}>{t("Why")}</th></tr></thead>
            <tbody>{f.rows.map((r) => (
              <tr key={r.id}>
                <td className={td}><span className="font-medium">{r.name}</span><div className="text-[12px] text-faint">{r.supplier ?? t("No supplier yet")}</div></td>
                <td className={td + num + " max-sm:hidden"}>{r.velocity ? (r.velocity < 0.1 ? t("<0.1/day") : t("{n}/day", { n: r.velocity.toFixed(1) })) : "—"}</td>
                <td className={td + num + " max-sm:hidden"}>{r.f14}</td>
                <td className={td + num}>{r.stock}</td>
                <td className={td + num} style={{ color: r.cover != null && r.cover <= r.lead + p.safety ? "#B3261E" : r.cover != null && r.cover <= 7 ? "#94570A" : undefined }}>{r.cover != null ? t("{n} d", { n: r.cover }) : "—"}</td>
                <td className={td + num + " max-sm:hidden"}>{r.rop}</td>
                <td className={td + num + " font-semibold"} style={{ color: r.suggestion ? "#0B5E5B" : "#8A929A" }}>{r.suggestion ? "+" + r.suggestion : "—"}</td>
                <td className={td + " text-[12.5px] text-muted max-w-[340px] max-md:hidden"}>{why(r)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="px-4 text-[13px] text-muted">{t("Add medicines and record sales to see forecasts.")}</div>}
      <div className="px-4 pb-3 text-[12px] text-faint">
        {t("Basis: 28-day sales on this branch, with 1 day for delivery (the counter keeps no supplier lead times). These are estimates, not guarantees.")}
      </div>
    </div>
  );
}

// ---------- seasonal ----------

function SeasonalCard({ sea, months, onAdd }: { sea: Seasonal | null; months: (m: number) => string; onAdd: (items: { medicineId: string; qty: number }[]) => void }) {
  const t = useT();
  const [month, setMonth] = useState<number | null>(null);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const m = month ?? sea?.targets[0] ?? 0;
  useEffect(() => setOff({}), [m]);
  const rows: SeasonalRow[] = sea?.ready ? sea.plans[m] ?? [] : [];
  const chosen = rows.filter((r) => r.need > 0 && !off[r.id]);
  return (
    <div className={card}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="size-8 rounded-lg bg-teal/10 text-teal flex items-center justify-center"><Sparkles size={16} /></span>
        <div className="flex flex-col flex-1 min-w-[220px]"><div className="font-semibold">{t("Seasonal demand planner")}</div><div className="text-[12.5px] text-muted">{t("Finds items that sold above average in a coming month in your own history, so you can stock up before the rush.")}</div></div>
        {sea?.ready ? <Segmented size="sm" value={String(m)} onChange={(v) => setMonth(Number(v))} options={sea.targets.map((x) => ({ value: String(x), label: months(x) }))} /> : null}
      </div>
      {!sea ? <div className="text-[13px] text-muted">{t("Reading your sales history…")}</div>
        : !sea.ready ? <div className="text-[13px] text-muted bg-page rounded-lg px-3 py-2.5">{t("Needs 12 months of sales history at this branch ({n} so far). Until then, reorders use the 28-day sales rate.", { n: sea.months })}</div>
        : !rows.length ? <div className="text-[13px] text-muted">{t("No items sell noticeably above average in {month}. Normal reorder rules are enough.", { month: months(m) })}</div>
        : <>
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={th} /><th className={th}>{t("Medicine")}</th><th className={th + " max-sm:hidden"}>{t("12-month pattern")}</th><th className={th + num}>{t("vs avg")}</th><th className={th + num + " max-sm:hidden"}>{t("Expected")}</th><th className={th + num + " max-sm:hidden"}>{t("Stock then")}</th><th className={th + num}>{t("Pre-stock")}</th></tr></thead>
              <tbody>{rows.map((r) => {
                const mx = Math.max(...r.bars, 0.01);
                return (
                  <tr key={r.id}>
                    <td className={td}><input type="checkbox" className="accent-teal" disabled={!r.need} checked={!!r.need && !off[r.id]} onChange={(e) => setOff({ ...off, [r.id]: !e.target.checked })} aria-label={t("Include {name}", { name: r.name })} /></td>
                    <td className={td + " font-medium"}>{r.name}</td>
                    <td className={td + " max-sm:hidden"}><div className="flex items-end gap-[2px] h-7">{r.bars.map((b, i) => <div key={i} title={`${months(i)}: ${Math.round(b * 100)}%`} className="w-[7px] rounded-sm" style={{ height: Math.round(4 + (b / mx) * 22), background: i === m ? "#0B5E5B" : i === sea.cur ? "#7FB8B1" : "#D5E7E4" }} />)}</div></td>
                    <td className={td + num + " text-teal font-semibold"}>+{Math.round(r.lift)}%</td>
                    <td className={td + num + " max-sm:hidden"}>{r.expected}</td>
                    <td className={td + num + " max-sm:hidden"}>{r.atStart}</td>
                    <td className={td + num + " font-semibold"} style={{ color: r.need ? "#0B5E5B" : "#18794E" }}>{r.need ? "+" + r.need : t("Covered")}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12px] text-faint flex-1 min-w-[240px]">{t("Basis: the same month in your sales history compared with the 12-month average, current stock and expected sales until then. Weather and outbreaks can shift real demand, so review before ordering.")}</span>
            <Button variant="primary" size="sm" disabled={!chosen.length} onClick={() => onAdd(chosen.map((r) => ({ medicineId: r.id, qty: r.need })))}><ListPlus size={14} />{t("Add {n} for {month} to order list", { n: chosen.length, month: months(m) })}</Button>
          </div>
        </>}
    </div>
  );
}

// ---------- prices and slow stock ----------

function Prices({ rows }: { rows: Data["prices"] }) {
  const t = useT();
  return (
    <div className={card}>
      <div className="font-semibold">{t("Supplier price comparison")} <span className="text-[12px] font-normal text-faint">{t("landed cost per pack, after free goods")}</span></div>
      {rows.length ? <ul className="divide-y divide-line">{rows.map((p) => (
        <li key={p.name} className="py-1.5 flex flex-col gap-0.5">
          <div className="flex justify-between gap-2 flex-wrap"><strong className="text-[13.5px]">{p.name}</strong><span className="text-[12.5px]" style={{ color: p.savingPct ? "#1E7F4F" : "#5B636B" }}>{p.savingPct ? t("Best: {name} · {pct}% below last price", { name: p.best, pct: p.savingPct.toFixed(1) }) : t("Best: {name} · last price is best", { name: p.best })}</span></div>
          <div className="text-[12.5px] text-muted">{p.quotes.map((q) => `${q.supplier} ${inr(q.rate)}${q.deal ? ` (${t("rate")} ${inr(q.ptr)}, ${q.deal})` : ""}`).join(" · ")}</div>
        </li>
      ))}</ul> : <div className="text-[13px] text-muted">{t("Shows once you’ve bought the same medicine from more than one supplier. Based on your purchase bills.")}</div>}
    </div>
  );
}

function Slow({ rows }: { rows: Data["slow"] }) {
  const t = useT();
  const note = (k: string) => (k === "dead" ? t("Dead stock: no sales in 90 days") : k === "slow" ? t("Slow mover: under 1 a week") : t("Overstocked versus demand"));
  return (
    <div className={card}>
      <div className="font-semibold">{t("Slow-moving & dead stock")}</div>
      {rows.length ? <ul className="divide-y divide-line">{rows.map((x) => (
        <li key={x.id} className="py-1.5 flex justify-between gap-3">
          <div className="flex flex-col"><strong className="text-[13.5px]">{x.name}</strong><span className="text-[12.5px] text-muted">{note(x.kind)}{x.cover != null ? ` · ${t("{n} days of stock", { n: x.cover })}` : ""}</span></div>
          <div className="text-right"><div className="font-semibold tabular-nums">{inr0(x.value)}</div><div className="text-[12px] text-faint">{t("{n} packs", { n: x.packs })}</div></div>
        </li>
      ))}</ul> : <div className="text-[13px] text-muted">{t("No slow or dead stock. Items qualify after 30 days on the shelf with little or no sales.")}</div>}
    </div>
  );
}

// ---------- anomalies ----------

function Anomalies({ rows, th: thr, who, onChange }: { rows: Anomaly[]; th: { disc: number; refunds: number }; who: Who; onChange: () => void }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [v, setV] = useState({ disc: String(thr.disc), refunds: String(thr.refunds) });
  useEffect(() => setV({ disc: String(thr.disc), refunds: String(thr.refunds) }), [thr.disc, thr.refunds]);
  const text = (a: Anomaly): [string, string] => {
    const x = a.vars;
    switch (a.rule) {
      case "disc": return [t("Discount above {limit}%", { limit: x.limit }), t("{pct}% on {bill}", { pct: x.pct, bill: x.bill })];
      case "refunds": return [t("More than {limit} refunds in a day", { limit: x.limit }), t("{n} credit notes on {date}", { n: x.n, date: x.date })];
      case "count": return [t("Stock count difference above ₹500"), t("{value} on {date}", { value: inr(Number(x.value)), date: x.date })];
      case "cost": return [t("Purchase rate up more than 3%"), `${x.name} ${inr(Number(x.prev))} → ${inr(Number(x.cur))} (+${Number(x.pct).toFixed(1)}%)`];
      case "night": return [t("Bills between 11 pm and 6 am"), t("{n} bill(s) on {date}, first {bill}", { n: x.n, date: x.date, bill: x.bill })];
    }
  };
  const save = async () => {
    try { await dev.call("intelSaveSettings", { anomaly: { disc: Number(v.disc), refunds: Number(v.refunds) } }); toast(t("Thresholds saved."), "green"); onChange(); }
    catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className={card}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="font-semibold">{t("Audit anomalies")}</div>
        <span className="text-[12px] text-faint">{t("Signals to review, not proof of wrongdoing. Last 7 days.")}</span>
        {who.owner ? (
          <div className="ml-auto flex items-center gap-3 text-[12.5px] text-muted flex-wrap">
            <label className="flex items-center gap-1">{t("Discount >")}<input inputMode="numeric" value={v.disc} onChange={(e) => setV({ ...v, disc: e.target.value.replace(/\D/g, "") })} className="w-11 border border-line rounded px-1 py-0.5 text-right" />%</label>
            <label className="flex items-center gap-1">{t("Refunds/day >")}<input inputMode="numeric" value={v.refunds} onChange={(e) => setV({ ...v, refunds: e.target.value.replace(/\D/g, "") })} className="w-11 border border-line rounded px-1 py-0.5 text-right" /></label>
            <Button size="sm" onClick={save}>{t("Save")}</Button>
          </div>
        ) : null}
      </div>
      {rows.length ? <ul className="divide-y divide-line">{rows.map((a) => {
        const [rule, detail] = text(a);
        return (
          <li key={a.key} className="flex items-center gap-3 py-2 flex-wrap">
            <Badge tone={a.sev}>{rule}</Badge>
            <span className="text-[13.5px] flex-1 min-w-[180px]">{detail}{a.rule === "cost" ? <span className="text-muted"> · {t("Supplier pricing")}</span> : a.who ? <span className="text-muted"> · {a.who}</span> : null}</span>
            {a.reviewed ? <span className="text-[12.5px] text-ok">{t("Reviewed by {name}", { name: a.reviewed.by })}</span>
              : who.owner ? <Button size="sm" onClick={async () => { try { await dev.call("intelReview", a.key, `${rule} · ${detail}`, who.userName); onChange(); } catch (e) { toast(errText(e), "red"); } }}>{t("Mark reviewed")}</Button> : null}
          </li>
        );
      })}</ul> : <div className="text-[13px] text-muted">{t("Nothing flagged in the last 7 days.")}</div>}
      <div className="text-[12px] text-faint">{t("Reviews are kept on this counter.")}</div>
    </div>
  );
}

// ---------- central buying ----------

function Central({ plan }: { plan: NonNullable<Data["central"]> }) {
  const t = useT();
  const csv = () => downloadCsv(`central-order-${todayISO()}`, [["Supplier", "Medicine", ...plan.branches.map((b) => b.name), "Total"],
    ...plan.suppliers.flatMap((s) => s.lines.map((l) => [s.supplier ?? "No supplier on record", l.name, ...plan.branches.map((b) => l.qty[b.id] ?? 0), l.total]))]);
  return (
    <div className={card}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="size-8 rounded-lg bg-teal/10 text-teal flex items-center justify-center"><Network size={16} /></span>
        <div className="flex flex-col flex-1 min-w-[220px]"><div className="font-semibold">{t("Central buying · all branches")}</div>
          <div className="text-[12.5px] text-muted">{t("Reorder needs of every branch, combined per supplier so you can negotiate one order. From the bills and stock this counter has received.")}</div></div>
        {plan.suppliers.length ? <Button size="sm" onClick={csv}><Download size={14} />{t("CSV")}</Button> : null}
      </div>
      {plan.suppliers.length ? plan.suppliers.map((s) => (
        <div key={s.supplierId ?? "none"} className="border border-line rounded-lg overflow-auto">
          <div className="flex items-center justify-between px-3 py-2 bg-page text-[13.5px]"><strong>{s.supplier ?? t("No supplier on record")}</strong><span className="tabular-nums text-muted">{t("{n} item(s) · about {value}", { n: s.lines.length, value: inr0(s.value) })}</span></div>
          <table className="w-full border-collapse text-[13px]">
            <thead><tr><th className={th}>{t("Medicine")}</th>{plan.branches.map((b) => <th key={b.id} className={th + num}>{b.name}</th>)}<th className={th + num}>{t("Total")}</th></tr></thead>
            <tbody>{s.lines.map((l) => (
              <tr key={l.medicineId}><td className={td}>{l.name}</td>{plan.branches.map((b) => <td key={b.id} className={td + num}>{l.qty[b.id] || <span className="text-faint">—</span>}</td>)}<td className={td + num + " font-semibold"}>{l.total}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )) : <div className="text-[13px] text-muted">{t("No branch needs reordering under this policy.")}</div>}
    </div>
  );
}

// ---------- margins ----------

function Margins({ m }: { m: Data["margins"] }) {
  const t = useT();
  const [by, setBy] = useState<MarginBy | "stock">("item");
  const rows = by === "stock" ? m.stock.map((r) => ({ key: r.id, name: r.name, qty: r.qty, sales: r.sell, cost: r.cost, margin: r.margin, pct: r.pct })) : m[by];
  const tot = rows.reduce((a, r) => ({ sales: a.sales + r.sales, cost: a.cost + r.cost }), { sales: 0, cost: 0 });
  const head = by === "supplier" ? t("Supplier") : by === "category" ? t("Category (form)") : t("Medicine");
  const csv = () => downloadCsv(`margins-${by}`, [[by === "supplier" ? "Supplier" : by === "category" ? "Category" : "Medicine", by === "stock" ? "Units" : "Units sold", by === "stock" ? "Value at MRP ex-GST" : "Sales ex-GST", "Landed cost", "Margin", "Margin %"],
    ...rows.map((r) => [r.name, r.qty, (r.sales / 100).toFixed(2), (r.cost / 100).toFixed(2), (r.margin / 100).toFixed(2), r.pct ?? ""])]);
  return (
    <div className={card + " !p-0 overflow-hidden"}>
      <div className="flex items-center gap-3 px-4 pt-3 flex-wrap">
        <div className="flex flex-col flex-1 min-w-[220px]"><span className="font-semibold">{t("Margins on landed cost")}</span><span className="text-[12px] text-faint">{by === "stock" ? t("Stock in hand: MRP excluding GST against each batch’s landed cost") : t("Last 30 days, net of returns: sales excluding GST against landed cost (free goods spread over paid ones)")}</span></div>
        <Segmented size="sm" value={by} onChange={setBy} options={[{ value: "item", label: t("Item") }, { value: "category", label: t("Category") }, { value: "supplier", label: t("Supplier") }, { value: "stock", label: t("Stock in hand") }]} />
        <Button size="sm" onClick={csv} disabled={!rows.length}><Download size={14} />{t("CSV")}</Button>
      </div>
      <div className="overflow-auto max-h-[480px]">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-page"><tr><th className={th}>{head}</th><th className={th + num + " max-sm:hidden"}>{t("Units")}</th><th className={th + num}>{by === "stock" ? t("At MRP ex-GST") : t("Sales ex-GST")}</th><th className={th + num + " max-sm:hidden"}>{t("Landed cost")}</th><th className={th + num}>{t("Margin")}</th><th className={th + num}>{t("Margin %")}</th></tr></thead>
          <tbody>
            {rows.slice(0, 50).map((r) => (
              <tr key={r.key}><td className={td}>{r.name || (by === "supplier" ? t("No supplier (opening stock)") : "—")}</td><td className={td + num + " max-sm:hidden"}>{r.qty}</td><td className={td + num}>{inr0(r.sales)}</td><td className={td + num + " max-sm:hidden"}>{inr0(r.cost)}</td><td className={td + num}>{inr0(r.margin)}</td>
                <td className={td + num + " font-semibold"} style={{ color: (r.pct ?? 0) < 10 ? "#B3261E" : (r.pct ?? 0) < 20 ? "#94570A" : "#1E7F4F" }}>{pct1(r.pct)}</td></tr>
            ))}
            {by !== "stock" && rows.length ? <tr className="bg-page font-semibold"><td className={td}>{t("Total")}</td><td className={td + " max-sm:hidden"} /><td className={td + num}>{inr0(tot.sales)}</td><td className={td + num + " max-sm:hidden"}>{inr0(tot.cost)}</td><td className={td + num}>{inr0(tot.sales - tot.cost)}</td><td className={td + num}>{pct1(tot.sales ? Math.round(((tot.sales - tot.cost) / tot.sales) * 10000) / 100 : null)}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {!rows.length ? <div className="px-4 pb-3 text-[13px] text-muted">{by === "stock" ? t("No stock in hand.") : t("No sales in the last 30 days.")}</div> : <div className="px-4 pb-3 text-[12px] text-faint">{t("Top 50 shown; the CSV has every row.")}</div>}
    </div>
  );
}
