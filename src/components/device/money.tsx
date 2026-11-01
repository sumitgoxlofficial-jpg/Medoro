"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, FileUp, Link2, Printer, QrCode, RefreshCw, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import type { DeviceHandlers } from "@/drivedb/device.worker";
import type { TxnState } from "@/drivedb/money";
import { BANKS, BANK_FIELDS, type BankField, type BankMapping } from "@/domain/finance/statement";
import { CHANNEL_LABEL, type Channel } from "@/domain/finance/narration";
import { upiIntent } from "@/domain/finance/match";
import { LABEL_TEXT, SOURCES, type SourceLabel } from "@/domain/finance/providers";
import { qrSvg } from "@/lib/qr";
import { inr } from "@/lib/money";
import { addDays, todayISO } from "@/lib/dates";
import { downloadCsv } from "@/lib/csv";
import { downloadXlsx } from "@/lib/xlsx";
import { card, input, label, errText, toPaise, type Cfg, type Who } from "./ui";

type R<K extends keyof DeviceHandlers> = Awaited<ReturnType<DeviceHandlers[K]>>;
type Txn = R<"finTransactions">[number];
type Recon = R<"finReconciliation">;
const VIEWS = [["overview", "Overview"], ["import", "Import statement"], ["txns", "Transactions"], ["recon", "Reconcile"], ["history", "Import history"], ["reports", "Reports"], ["connect", "Connections"]] as const;
type View = (typeof VIEWS)[number][0];

const STATE: Record<TxnState, [string, Tone]> = {
  matched: ["Matched", "green"], partial: ["Part matched", "amber"], unmatched: ["Unmatched", "red"], review: ["Possible duplicate", "purple"],
  duplicate: ["Duplicate", "gray"], ignored: ["Set aside", "gray"], debit: ["Money out", "gray"], not_payment: ["Not a bill payment", "gray"],
};
const SOURCE_TONE: Record<SourceLabel, Tone> = { available: "green", sandbox: "blue", partner_required: "amber", unsupported: "gray" };
const StateBadge = ({ s }: { s: TxnState }) => <Badge tone={STATE[s][1]}>{STATE[s][0]}</Badge>;
const amt = (t: { direction: string; amountPaise: number }) => <span className={`tabular-nums ${t.direction === "credit" ? "text-ok" : ""}`}>{t.direction === "credit" ? "+" : "−"}{inr(t.amountPaise)}</span>;
const table = "w-full text-sm [&_th]:text-left [&_th]:font-medium [&_th]:text-muted [&_th]:py-1.5 [&_th]:pr-3 [&_td]:py-1.5 [&_td]:pr-3 [&_tr]:border-b [&_tr]:border-line align-top";

/**
 * UPI & Bank on the counter: import bank statements, see which bills and counter UPI payments the bank confirms,
 * review suggestions and duplicates, reports. Everything stays on this device and the pharmacy's Google Drive.
 */
export function Money({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const [view, setView] = useState<View>("overview");
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const r = refresh + tick;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <Segmented value={view} onChange={setView} options={VIEWS.map(([value, l]) => ({ value, label: l }))} />
        <span className="text-[12.5px] text-muted">Statements only: Medoro shows what your bank statement shows, as of the file you upload.</span>
      </div>
      {view === "overview" && <Overview refresh={r} go={setView} />}
      {view === "import" && <Import who={who} onDone={() => { bump(); setView("recon"); }} />}
      {view === "txns" && <Transactions who={who} refresh={r} onChange={bump} />}
      {view === "recon" && <Reconcile who={who} cfg={cfg} refresh={r} onChange={bump} />}
      {view === "history" && <History refresh={r} />}
      {view === "reports" && <Reports />}
      {view === "connect" && <Connections owner={who.owner} />}
    </div>
  );
}

function Tile({ k, v, sub, tone }: { k: string; v: React.ReactNode; sub?: string; tone?: "bad" | "ok" }) {
  return <div className="border border-line rounded-xl p-3 bg-white"><div className="text-[12.5px] text-muted">{k}</div><div className={`text-xl font-semibold tabular-nums ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{v}</div>{sub && <div className="text-[12px] text-muted">{sub}</div>}</div>;
}

function Overview({ refresh, go }: { refresh: number; go: (v: View) => void }) {
  const dev = useRef(deviceDb()).current;
  const [o, setO] = useState<R<"finOverview"> | null>(null);
  useEffect(() => { void dev.call("finOverview").then(setO); }, [dev, refresh]);
  if (!o) return <div className={card}>Loading…</div>;
  return (
    <div className="flex flex-col gap-4">
      {(o.counterNotSeen > 0 || o.review > 0) && (
        <div className={`${card} border-[#F2C4BF]`}>
          <div className="flex items-center gap-2 font-semibold text-bad"><AlertTriangle size={18} /> Needs attention</div>
          {o.counterNotSeen > 0 && <div className="text-sm">{o.counterNotSeen} UPI payment(s) taken at the counter are not in the bank statements that cover their day. A “payment successful” screen isn’t proof: check these.</div>}
          {o.review > 0 && <div className="text-sm">{o.review} transaction(s) may be duplicates from overlapping statements. They are not counted or matched until you decide.</div>}
          <Button size="sm" className="self-start" onClick={() => go("recon")}>Open Reconcile</Button>
        </div>
      )}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile k={`UPI credits, last ${o.days} days`} v={inr(o.upiCreditsPaise)} sub={`${o.upiCredits} payment(s)`} />
        <Tile k={`All bank credits, last ${o.days} days`} v={inr(o.bankCreditsPaise)} sub={`${o.bankCredits} credit(s)`} />
        <Tile k="Matched" v={o.matched} sub={o.partial ? `${o.partial} part matched` : "credits tied to bills or payments"} tone="ok" />
        <Tile k="Unmatched credits" v={o.unmatched} tone={o.unmatched ? "bad" : undefined} sub="money in, not yet tied to a bill" />
        <Tile k="Counter UPI not confirmed yet" v={o.counterUnverified} sub={o.counterNotSeen ? `${o.counterNotSeen} missing from statements` : "waiting for a statement"} tone={o.counterNotSeen ? "bad" : undefined} />
        <Tile k="Possible duplicates" v={o.review} tone={o.review ? "bad" : undefined} />
        <Tile k="Last statement" v={o.lastImport ? o.lastImport.toDate ?? "—" : "None yet"} sub={o.lastImport ? `${o.lastImport.accountLabel} · uploaded ${new Date(o.lastImport.at).toLocaleString("en-IN")}` : "Upload one to start"} />
        <Tile k="Automatic bank sync" v="Not connected" sub="Needs a bank or Account Aggregator partner (see Connections)" />
      </div>
      <div className={card}>
        <div className="font-semibold">Accounts</div>
        {o.accounts.length ? (
          <table className={table}><thead><tr><th>Account</th><th>Statements cover</th><th>Transactions</th></tr></thead>
            <tbody>{o.accounts.map((a) => <tr key={a.account}><td>{a.label}</td><td>{a.fromDate} to {a.toDate}</td><td>{a.transactions}</td></tr>)}</tbody></table>
        ) : <div className="text-sm text-muted">No statements yet. <button className="text-teal cursor-pointer" onClick={() => go("import")}>Upload your first statement</button>: any bank, CSV or Excel.</div>}
      </div>
    </div>
  );
}

function Import({ who, onDone }: { who: Who; onDone: () => void }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [bank, setBank] = useState("");
  const [last4, setLast4] = useState("");
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [p, setP] = useState<R<"statementPreview"> | null>(null);
  const [mapping, setMapping] = useState<BankMapping | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<R<"importStatement"> | null>(null);

  const preview = useCallback(async (f: { name: string; bytes: Uint8Array }, m?: BankMapping | null) => {
    try { const r = await dev.call("statementPreview", f.name, f.bytes, bank || "OTHER", m ?? undefined); setP(r); setMapping(r.mapping); }
    catch (e) { setP(null); toast(errText(e), "red"); }
  }, [dev, bank, toast]);
  useEffect(() => { if (file) void preview(file); }, [file, preview]);

  const run = async () => {
    if (!file || !mapping) return;
    setBusy(true);
    try {
      const r = await dev.call("importStatement", { fileName: file.name, bytes: file.bytes, bank, last4, mapping, userId: who.userId });
      setResult(r); setFile(null); setP(null);
      toast(`${r.added} new transaction(s) · ${r.duplicates} already here · ${r.matched} matched automatically.`, "green");
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  const width = Math.max(0, ...(p?.preview ?? []).map((r) => r.length));
  const setCol = (f: BankField, v: string) => mapping && setMapping({ ...mapping, cols: { ...mapping.cols, [f]: v === "" ? undefined : Number(v) } });

  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} max-w-3xl`}>
        <div className="font-semibold">Upload a bank statement</div>
        <div className="text-sm text-muted">Download the statement from net banking as <b>CSV or Excel</b> (.xlsx, or the .xls most banks offer) and upload it here. It is read on this device; nothing is sent to Medoro. Medoro never asks for your net-banking password, UPI PIN or OTP.</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className={label}>Bank<select value={bank} onChange={(e) => setBank(e.target.value)} className={input} aria-label="Bank"><option value="">Choose…</option>{BANKS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label className={label}>Last 4 digits of the account<input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" className={input} aria-label="Last 4 digits" /></label>
          <label className={label}>File
            <span className={`${input} flex items-center gap-2 cursor-pointer ${!bank || last4.length !== 4 ? "opacity-50 pointer-events-none" : ""}`}><FileUp size={15} />{file?.name ?? "Choose file"}
              <input type="file" className="hidden" accept=".csv,.xlsx,.xls,.txt" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setResult(null); setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); } }} aria-label="Statement file" />
            </span>
          </label>
        </div>
      </div>

      {p?.needsMapping && mapping && (
        <div className={card}>
          <div className="font-semibold">Which columns are which?</div>
          <div className="text-sm text-muted">Medoro couldn’t find the column names. Pick the row with the headings, then the columns. This is remembered for this bank.</div>
          <div className="grid sm:grid-cols-4 gap-2">
            <label className={label}>Heading row<select className={input} value={mapping.headerRow} onChange={(e) => setMapping({ ...mapping, headerRow: Number(e.target.value) })}>{p.preview.map((_, i) => <option key={i} value={i}>Row {i + 1}</option>)}<option value={-1}>—</option></select></label>
            {(Object.keys(BANK_FIELDS) as BankField[]).map((f) => (
              <label key={f} className={label}>{BANK_FIELDS[f]}<select className={input} value={mapping.cols[f] ?? ""} onChange={(e) => setCol(f, e.target.value)}><option value="">—</option>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{p.preview[mapping.headerRow]?.[i] || `Column ${i + 1}`}</option>)}</select></label>
            ))}
          </div>
          <div className="overflow-x-auto"><table className={table}><tbody>{p.preview.map((r, i) => <tr key={i} className={i === mapping.headerRow ? "font-semibold" : ""}><td className="text-muted">{i + 1}</td>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
          <Button variant="primary" className="self-start" onClick={() => file && preview(file, mapping)}>Check these columns</Button>
        </div>
      )}

      {p && !p.needsMapping && (
        <div className={card}>
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <div className="font-semibold">Check before importing</div>
            <Button variant="primary" onClick={run} disabled={busy || !p.count}>{busy ? "Importing…" : `Import ${p.count} transaction(s)`}</Button>
          </div>
          <div className="text-sm">{p.fromDate} to {p.toDate} · {p.credits} credit(s), {p.debits} debit(s){p.skipped ? ` · ${p.skipped} blank or total line(s) skipped` : ""}</div>
          {p.problems.length > 0 && <div className="text-sm text-bad">{p.problems.length} row(s) can’t be read and won’t be imported: {p.problems.slice(0, 5).map((x) => `row ${x.row} (${x.reason})`).join("; ")}{p.problems.length > 5 ? "…" : ""}</div>}
          <div className="overflow-x-auto"><table className={table}><thead><tr><th>Date</th><th>Amount</th><th>Channel</th><th>UTR / RRN</th><th>Payer</th><th>Narration</th></tr></thead>
            <tbody>{p.sample.map((s) => <tr key={s.row}><td className="whitespace-nowrap">{s.date}{s.time ? ` ${s.time.slice(0, 5)}` : ""}</td><td>{amt({ direction: s.amount > 0 ? "credit" : "debit", amountPaise: Math.abs(s.amount) })}</td><td>{CHANNEL_LABEL[s.channel]}</td><td className="font-mono text-[12px]">{s.utr ?? "—"}</td><td>{s.name ?? s.vpa ?? "—"}</td><td className="text-muted max-w-[360px] truncate" title={s.description}>{s.description}</td></tr>)}</tbody></table></div>
          {p.count > p.sample.length && <div className="text-[12.5px] text-muted">Showing the first {p.sample.length} of {p.count}.</div>}
        </div>
      )}

      {result && (
        <div className={card}>
          <div className="font-semibold">Imported</div>
          <div className="text-sm">{result.added} new · {result.duplicates} already imported or the same payment · {result.review} possible duplicate(s) to review · {result.matched} matched automatically{result.problems.length ? ` · ${result.problems.length} row(s) couldn’t be read` : ""}.</div>
          <Button className="self-start" onClick={onDone}>Go to Reconcile</Button>
        </div>
      )}
    </div>
  );
}

const STATE_FILTER: [string, string][] = [["", "All"], ["unmatched", "Unmatched"], ["partial", "Part matched"], ["matched", "Matched"], ["review", "Possible duplicates"], ["debit", "Money out"], ["not_payment", "Not bill payments"], ["ignored", "Set aside"], ["duplicate", "Duplicates"]];

function Transactions({ who, refresh, onChange }: { who: Who; refresh: number; onChange: () => void }) {
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [rows, setRows] = useState<Txn[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { void dev.call("finTransactions", { q: q || undefined, state: state || undefined, limit: 500 }).then(setRows); }, 150); return () => clearTimeout(t); }, [dev, q, state, refresh]);
  return (
    <div className={card}>
      <div className="flex gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search narration, UTR, payer, UPI ID or amount" aria-label="Search transactions" className={`${input} flex-1 min-w-[240px]`} />
        <select value={state} onChange={(e) => setState(e.target.value)} className={`${input} w-auto`} aria-label="Status">{STATE_FILTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <Button onClick={() => downloadCsv(`bank-transactions-${todayISO()}`, [["Transaction ID", "Date", "Time", "Amount (₹)", "Credit/Debit", "Bank", "Payment source", "UTR/RRN", "Narration", "Invoice / matched to", "Status"], ...rows.map((t) => [t.id.slice(-10), t.date, t.time ?? "", (t.amountPaise / 100).toFixed(2), t.direction, t.accountLabel, `${CHANNEL_LABEL[t.channel as Channel]} · ${t.source}`, t.utr ?? "", t.description, t.links.map((l) => l.label).join("; "), STATE[t.state][0]])])}><Download size={15} /> CSV</Button>
      </div>
      <div className="overflow-x-auto">
        <table className={table}>
          <thead><tr><th>Transaction</th><th>Date</th><th>Amount</th><th>Bank</th><th>Source</th><th>UTR / RRN</th><th>Narration</th><th>Invoice</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-chip" onClick={() => setOpen(t.id)}>
                <td className="font-mono text-[12px]">{t.id.slice(-10)}</td>
                <td className="whitespace-nowrap">{t.date}{t.time ? <span className="text-muted"> {t.time.slice(0, 5)}</span> : null}</td>
                <td>{amt(t)}</td><td className="whitespace-nowrap">{t.accountLabel}</td>
                <td className="whitespace-nowrap">{CHANNEL_LABEL[t.channel as Channel]}<span className="text-muted text-[12px] block">{t.source}</span></td>
                <td className="font-mono text-[12px]">{t.utr ?? "—"}</td>
                <td className="max-w-[300px]"><span className="block truncate" title={t.description}>{t.description}</span>{(t.counterpartyName || t.counterpartyVpa) && <span className="text-[12px] text-muted">{[t.counterpartyName, t.counterpartyVpa].filter(Boolean).join(" · ")}</span>}</td>
                <td>{t.links.map((l) => <span key={l.allocationId} className="block whitespace-nowrap">{l.label}</span>)}</td>
                <td><StateBadge s={t.state} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="text-muted">No transactions{q || state ? " match" : " yet. Upload a statement"}.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <TxnModal id={open} who={who} onClose={() => setOpen(null)} onChange={onChange} />}
    </div>
  );
}

function TxnModal({ id, who, onClose, onChange }: { id: string; who: Who; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [t, setT] = useState<R<"finTransaction"> | null>(null);
  const [match, setMatch] = useState(false);
  const load = useCallback(() => dev.call("finTransaction", id).then(setT).catch((e) => toast(errText(e), "red")), [dev, id, toast]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "green"); onChange(); await load(); } catch (e) { toast(errText(e), "red"); } };
  if (!t) return null;
  const left = t.amountPaise - t.allocatedPaise;
  return (
    <Modal open onClose={onClose} width={640} title={<span className="flex items-center gap-2">{amt(t)} <StateBadge s={t.state} /></span>} sub={`${t.date}${t.time ? ` ${t.time}` : ""} · ${t.accountLabel} · ${CHANNEL_LABEL[t.channel as Channel]}`}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="break-words">{t.description}</div>
        <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">UTR / RRN</dt><dd className="font-mono">{t.utr ?? "Not in the narration"}</dd>
          <dt className="text-muted">Payer</dt><dd>{[t.counterpartyName, t.counterpartyVpa].filter(Boolean).join(" · ") || "Not stated by the bank"}</dd>
          <dt className="text-muted">Bank reference</dt><dd>{t.ref ?? "—"}</dd>
          <dt className="text-muted">Source</dt><dd>{t.sources.map((s, i) => <span key={i} className="block">{s.fileName ?? s.source}{s.row ? `, row ${s.row}` : ""}{s.rule !== "new" ? ` (same payment, matched by ${s.rule === "utr" ? "UTR" : "date, amount and narration"})` : ""}</span>)}</dd>
        </dl>
        {t.links.length > 0 && (
          <div><div className="font-medium mb-1">Matched to</div>
            {t.links.map((l) => <div key={l.allocationId} className="flex justify-between items-center gap-2 py-1 border-b border-line"><span>{l.label} · {inr(l.amountPaise)} <span className="text-muted">({l.kind === "auto" ? `automatic, rule ${l.rule}` : l.kind})</span></span><Button size="sm" onClick={() => act(() => dev.call("finUnallocate", l.allocationId, who.userId), "Match undone.")}><Undo2 size={14} /> Undo</Button></div>)}
          </div>
        )}
        {t.state === "review" && (
          <div className="flex gap-2 flex-wrap items-center"><span>Is this the same payment as one already imported?</span>
            <Button size="sm" onClick={() => act(() => dev.call("finResolveDuplicate", t.id, true, who.userId), "Marked as a duplicate.")}>Yes, a duplicate</Button>
            <Button size="sm" onClick={() => act(() => dev.call("finResolveDuplicate", t.id, false, who.userId), "Kept as a separate payment.")}>No, a different payment</Button>
          </div>
        )}
        {(t.state === "unmatched" || t.state === "partial") && (
          <>
            {t.suggestions.length > 0 && <div><div className="font-medium mb-1">Suggestions</div><Suggestions txnId={t.id} list={t.suggestions} who={who} act={act} /></div>}
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={() => setMatch(true)}><Link2 size={14} /> Match to a bill or payment…</Button>
              <Button size="sm" onClick={() => act(() => dev.call("finSetIgnored", t.id, true, "Not a customer payment", who.userId), "Set aside.")}>Set aside (not a customer payment)</Button>
            </div>
          </>
        )}
        {t.state === "ignored" && <Button size="sm" className="self-start" onClick={() => act(() => dev.call("finSetIgnored", t.id, false, "", who.userId), "Brought back.")}>Bring back</Button>}
        {t.events.length > 0 && <div className="text-[12.5px] text-muted">{t.events.map((e, i) => <div key={i}>{new Date(e.at).toLocaleString("en-IN")}: {e.kind.replace("_", " ")}{e.note ? ` (${e.note})` : ""}</div>)}</div>}
      </div>
      {match && <ManualMatch txnId={t.id} leftPaise={left} who={who} onClose={() => setMatch(false)} onDone={() => { setMatch(false); onChange(); void load(); }} />}
    </Modal>
  );
}

function Suggestions({ txnId, list, who, act }: { txnId: string; list: R<"finTransaction">["suggestions"]; who: Who; act: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const dev = deviceDb();
  return (
    <ul className="flex flex-col gap-1">
      {list.map((p) => (
        <li key={p.targetId} className="flex justify-between items-center gap-2 flex-wrap border border-line rounded-lg px-2 py-1.5">
          <span>{p.label} · {inr(p.amountPaise)}<span className="block text-[12px] text-muted">{p.reason}</span></span>
          <span className="flex gap-1">
            <Button size="sm" variant="primary" onClick={() => act(() => dev.call("finApprove", txnId, p.targetId, who.userId), "Matched.")} aria-label={`Approve ${p.label}`}><Check size={14} /> Approve</Button>
            <Button size="sm" onClick={() => act(() => dev.call("finReject", txnId, p.targetId, who.userId), "Won’t be suggested again.")} aria-label={`Reject ${p.label}`}><X size={14} /></Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ManualMatch({ txnId, leftPaise, who, onClose, onDone }: { txnId: string; leftPaise: number; who: Who; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [r, setR] = useState<Recon | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ target: "bill" | "counter" | "receipt"; id: string; label: string; max: number } | null>(null);
  const [amount, setAmount] = useState("");
  useEffect(() => { void dev.call("finReconciliation").then(setR); }, [dev]);
  const opts = useMemo(() => {
    if (!r) return [];
    const all = [
      ...r.openBills.map((b) => ({ target: "bill" as const, id: b.saleId, label: `${b.invoiceNo} · ${b.customerName} · ${b.date}`, max: b.balancePaise })),
      ...r.counterUnverified.map((p) => ({ target: "counter" as const, id: p.paymentId, label: `Counter UPI · ${p.invoiceNo} · ${p.date}`, max: p.amountPaise })),
      ...r.receiptsUnverified.map((x) => ({ target: "receipt" as const, id: x.receiptId, label: `Receipt · ${x.customerName} · ${x.date}`, max: x.amountPaise })),
    ];
    const s = q.trim().toLowerCase();
    return all.filter((o) => !s || o.label.toLowerCase().includes(s) || String(o.max / 100).startsWith(s)).slice(0, 50);
  }, [r, q]);
  const save = async () => {
    if (!pick) return;
    try { await dev.call("finManualMatch", { txnId, target: pick.target, targetId: pick.id, amountPaise: toPaise(amount), userId: who.userId }); toast("Matched.", "green"); onDone(); }
    catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} width={560} title="Match to a bill or payment" sub={`${inr(leftPaise)} of this payment is left to match`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!pick || !toPaise(amount)}>Match</Button></>}>
      <div className="flex flex-col gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, customer or amount" className={input} aria-label="Search bills" autoFocus />
        <ul className="max-h-[300px] overflow-y-auto text-sm divide-y divide-line">
          {opts.map((o) => (
            <li key={o.target + o.id}><button className={`w-full text-left py-1.5 px-1 cursor-pointer flex justify-between ${pick?.id === o.id ? "bg-chip" : ""}`} onClick={() => { setPick(o); setAmount((Math.min(o.max, leftPaise) / 100).toFixed(2)); }}><span>{o.label}</span><span className="tabular-nums">{inr(o.max)}</span></button></li>
          ))}
          {r && !opts.length && <li className="py-2 text-muted">Nothing open matches.</li>}
        </ul>
        {pick && <label className={label}>Amount to match (₹)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} aria-label="Amount to match" /></label>}
      </div>
    </Modal>
  );
}

function Reconcile({ who, cfg, refresh, onChange }: { who: Who; cfg: Cfg; refresh: number; onChange: () => void }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [r, setR] = useState<Recon | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [qr, setQr] = useState<{ title: string; uri: string; note: string } | null>(null);
  const [settings, setSettings] = useState<R<"finSettings"> | null>(null);
  const load = useCallback(async () => { setR(await dev.call("finReconciliation")); setSettings(await dev.call("finSettings")); }, [dev]);
  useEffect(() => { void load(); }, [load, refresh]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "green"); onChange(); await load(); } catch (e) { toast(errText(e), "red"); } };
  if (!r) return <div className={card}>Loading…</div>;
  const unique = r.suggested.filter((t) => t.suggestions.some((p) => p.rule === 4)).length;
  const Section = ({ title, n, children, note }: { title: string; n: number; children: React.ReactNode; note?: string }) => (
    <div className={card}><div className="flex justify-between items-center gap-2 flex-wrap"><div className="font-semibold">{title} <span className="text-muted font-normal">({n})</span></div></div>{note && <div className="text-[12.5px] text-muted">{note}</div>}{n ? children : <div className="text-sm text-muted">Nothing here.</div>}</div>
  );
  const row = (t: Txn | Recon["unmatched"][number], extra?: React.ReactNode) => (
    <li key={t.id} className="py-2 flex justify-between gap-2 flex-wrap">
      <button className="text-left cursor-pointer hover:text-teal" onClick={() => setOpen(t.id)}>{amt(t)} <span className="text-muted">{t.date} · {CHANNEL_LABEL[t.channel as Channel]}{t.utr ? ` · ${t.utr}` : ""}</span><span className="block text-[12.5px] text-muted max-w-[520px] truncate">{t.description}</span></button>
      {extra}
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => act(() => dev.call("finAutoReconcile", who.userId), "Matched what could be matched safely.")}><RefreshCw size={15} /> Match again</Button>
        {unique > 0 && <Button variant="primary" onClick={() => act(async () => toast(`${await dev.call("finApproveUnique", who.userId)} matched.`, "green"), "Done.")}><Check size={15} /> Approve all {unique} one-to-one suggestion(s)</Button>}
      </div>
      <Section title="Counter UPI not in the bank statement" n={r.counterNotSeen.length} note="Bills marked UPI at the counter, from days your statements cover, with no matching credit. Check the customer’s payment before treating these as paid.">
        <ul className="text-sm divide-y divide-line">{r.counterNotSeen.map((p) => <li key={p.paymentId} className="py-1.5 flex justify-between"><span className="flex items-center gap-2"><AlertTriangle size={14} className="text-bad" />{p.invoiceNo} · {p.date}{p.ref ? ` · ref ${p.ref}` : ""}</span><span className="tabular-nums">{inr(p.amountPaise)}</span></li>)}</ul>
      </Section>
      <Section title="Suggested matches" n={r.suggested.length} note="Approve only when you’re sure. Amount alone is never matched automatically.">
        <ul className="divide-y divide-line">{r.suggested.map((t) => <li key={t.id} className="py-2 flex flex-col gap-1">{row(t)}<Suggestions txnId={t.id} list={t.suggestions} who={who} act={act} /></li>)}</ul>
      </Section>
      <Section title="Possible duplicates" n={r.duplicates.length} note="Same day and amount as a row from another statement file. Not counted or matched until you decide.">
        <ul className="divide-y divide-line text-sm">{r.duplicates.map((t) => row(t, <span className="flex gap-1 items-center flex-wrap"><span className="text-[12.5px] text-muted max-w-[260px] truncate">vs “{t.other?.description}”</span><Button size="sm" onClick={() => act(() => dev.call("finResolveDuplicate", t.id, true, who.userId), "Marked as a duplicate.")}>Duplicate</Button><Button size="sm" onClick={() => act(() => dev.call("finResolveDuplicate", t.id, false, who.userId), "Kept.")}>Different</Button></span>))}</ul>
      </Section>
      <Section title="Unmatched credits" n={r.unmatched.length} note="Money in with nothing that fits. Open one to match it by hand, or set it aside if it isn’t a customer payment.">
        <ul className="divide-y divide-line text-sm">{r.unmatched.slice(0, 200).map((t) => row(t))}</ul>
      </Section>
      <Section title="Part-paid bills" n={r.partialBills.length}>
        <ul className="text-sm divide-y divide-line">{r.partialBills.map((b) => <li key={b.saleId} className="py-1.5 flex justify-between"><span>{b.invoiceNo} · {b.customerName}</span><span className="tabular-nums">paid {inr(b.paidPaise)} of {inr(b.creditPaise)} · <span className="text-bad">{inr(b.balancePaise)} due</span></span></li>)}</ul>
      </Section>
      <Section title="Matched automatically (latest)" n={r.auto.length}>
        <ul className="divide-y divide-line text-sm">{r.auto.slice(0, 50).map((t) => row(t, <span className="text-[12.5px]">{t.links.map((l) => <span key={l.allocationId} className="block">{l.label} · rule {l.rule}</span>)}</span>))}</ul>
      </Section>
      <Section title="Open credit bills" n={r.openBills.length} note={settings?.upiId ? "Show a UPI QR for a bill: it pays your own UPI ID and carries the bill’s Medoro reference, so the bank credit matches the bill by itself." : "Add your shop’s UPI ID under Connections to show a payment QR for each bill."}>
        <ul className="text-sm divide-y divide-line">{r.openBills.slice(0, 200).map((b) => <li key={b.saleId} className="py-1.5 flex justify-between items-center gap-2"><span>{b.invoiceNo} · {b.customerName} <span className="text-muted">{b.date}</span></span><span className="flex items-center gap-2"><span className="tabular-nums text-bad">{inr(b.balancePaise)}</span>{settings?.upiId && <Button size="sm" onClick={() => setQr({ title: `${b.invoiceNo} · ${inr(b.balancePaise)}`, uri: upiIntent(settings.upiId, settings.payee || cfg.pharmacy?.tradeName || "Pharmacy", b.balancePaise, b.medoroRef), note: b.medoroRef })} aria-label={`UPI QR for ${b.invoiceNo}`}><QrCode size={14} /> QR</Button>}</span></li>)}</ul>
      </Section>
      {open && <TxnModal id={open} who={who} onClose={() => setOpen(null)} onChange={() => { onChange(); void load(); }} />}
      {qr && <Modal open onClose={() => setQr(null)} title="Pay by UPI" sub={qr.title} width={360}><div className="flex flex-col items-center gap-2"><div dangerouslySetInnerHTML={{ __html: qrSvg(qr.uri, { size: 240, title: "UPI payment QR" }) }} /><div className="text-[12.5px] text-muted text-center">Pays {settings?.upiId}. Note on the payment: <b>{qr.note}</b>. Whether the note reaches your statement depends on the customer’s app and your bank.</div></div></Modal>}
    </div>
  );
}

function History({ refresh }: { refresh: number }) {
  const dev = useRef(deviceDb()).current;
  const [rows, setRows] = useState<R<"importHistory">>([]);
  useEffect(() => { void dev.call("importHistory").then(setRows); }, [dev, refresh]);
  return (
    <div className={card}>
      <div className="font-semibold">Statement imports</div>
      <div className="text-[12.5px] text-muted">Each upload, newest first. Automatic bank sync isn’t connected, so this is the whole history.</div>
      <div className="overflow-x-auto"><table className={table}>
        <thead><tr><th>Uploaded</th><th>Account</th><th>File</th><th>Dates</th><th>Rows</th><th>New</th><th>Duplicates</th><th>To review</th><th>Errors</th></tr></thead>
        <tbody>{rows.map((i) => <tr key={i.id}><td className="whitespace-nowrap">{new Date(i.at).toLocaleString("en-IN")}</td><td>{i.accountLabel}</td><td className="max-w-[200px] truncate" title={i.fileName}>{i.fileName}</td><td className="whitespace-nowrap">{i.fromDate} to {i.toDate}</td><td>{i.rows}</td><td>{i.added}</td><td>{i.duplicates}</td><td>{i.review}</td><td title={i.problems.map((p) => `row ${p.row}: ${p.reason}`).join("\n")}>{i.problems.length || ""}</td></tr>)}
          {!rows.length && <tr><td colSpan={9} className="text-muted">No statements imported yet.</td></tr>}</tbody>
      </table></div>
    </div>
  );
}

function Reports() {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [from, setFrom] = useState(addDays(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [r, setR] = useState<R<"finReports"> | null>(null);
  useEffect(() => { dev.call("finReports", from, to).then(setR).catch((e) => toast(errText(e), "red")); }, [dev, from, to, toast]);
  const head = ["Period", "Credits", "Total (₹)", "UPI (₹)", "Matched (₹)"];
  const g = (xs: R<"finReports">["daily"]) => xs.map((x) => [x.key, x.count, x.totalPaise / 100, x.upiPaise / 100, x.matchedPaise / 100]);
  const txnRows = (xs: R<"finReports">["reconciliation"]) => [["Date", "Bank", "Channel", "Credit/Debit", "Amount (₹)", "UTR/RRN", "Narration", "Status", "Matched (₹)"], ...xs.map((t) => [t.date, t.accountLabel, CHANNEL_LABEL[t.channel as Channel], t.direction, t.amountPaise / 100, t.utr ?? "", t.description, STATE[t.state][0], Math.max(0, t.allocatedPaise) / 100])];
  const xlsx = () => r && downloadXlsx(`upi-bank-${from}-to-${to}`, [
    { name: "Daily credits", rows: [head, ...g(r.daily)] }, { name: "Monthly credits", rows: [head, ...g(r.monthly)] },
    { name: "By bank account", rows: [["Account", ...head.slice(1)], ...g(r.byAccount)] }, { name: "By channel", rows: [["Channel", ...head.slice(1)], ...g(r.byChannel).map((x) => [CHANNEL_LABEL[x[0] as Channel] ?? x[0], ...x.slice(1)])] },
    { name: "Unmatched", rows: txnRows(r.unmatched) }, { name: "Reconciliation", rows: txnRows(r.reconciliation) },
  ]);
  const Block = ({ title, rows, first }: { title: string; rows: R<"finReports">["daily"]; first: string }) => (
    <div className={`${card} break-inside-avoid`}><div className="font-semibold">{title}</div>
      <table className={table}><thead><tr><th>{first}</th><th>Credits</th><th>Total</th><th>UPI</th><th>Matched</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.key}><td>{CHANNEL_LABEL[x.key as Channel] ?? x.key}</td><td>{x.count}</td><td className="tabular-nums">{inr(x.totalPaise)}</td><td className="tabular-nums">{inr(x.upiPaise)}</td><td className="tabular-nums">{inr(x.matchedPaise)}</td></tr>)}
          {!rows.length && <tr><td colSpan={5} className="text-muted">No credits in this period.</td></tr>}</tbody></table></div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} print:hidden`}>
        <div className="flex gap-2 flex-wrap items-end">
          <label className={label}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></label>
          <label className={label}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></label>
          <Button onClick={xlsx} disabled={!r}><Download size={15} /> Excel</Button>
          <Button onClick={() => r && downloadCsv(`upi-bank-reconciliation-${from}-to-${to}`, txnRows(r.reconciliation))} disabled={!r}><Download size={15} /> CSV</Button>
          <Button onClick={() => window.print()} disabled={!r}><Printer size={15} /> Print / PDF</Button>
        </div>
        <div className="text-[12.5px] text-muted">From the statements imported on this device. Duplicates and set-aside rows are left out.</div>
      </div>
      {r && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile k="Credits" v={inr(r.totals.creditPaise)} sub={`${r.totals.credits} credit(s)`} />
            <Tile k="Matched to bills / payments" v={inr(r.totals.matchedPaise)} tone="ok" />
            <Tile k="Unmatched" v={r.unmatched.length} tone={r.unmatched.length ? "bad" : undefined} />
            <Tile k="Money out" v={inr(r.totals.debitPaise)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Block title="Daily incoming credits" rows={r.daily} first="Day" />
            <Block title="Monthly incoming credits" rows={r.monthly} first="Month" />
            <Block title="Bank-wise collections" rows={r.byAccount} first="Account" />
            <Block title="Collections by channel (UPI and others)" rows={r.byChannel} first="Channel" />
          </div>
          <div className={card}><div className="font-semibold">Unmatched payments ({r.unmatched.length})</div>
            <table className={table}><thead><tr><th>Date</th><th>Amount</th><th>Bank</th><th>UTR</th><th>Narration</th></tr></thead>
              <tbody>{r.unmatched.map((t) => <tr key={t.id}><td>{t.date}</td><td>{amt(t)}</td><td>{t.accountLabel}</td><td className="font-mono text-[12px]">{t.utr ?? "—"}</td><td className="max-w-[360px] truncate">{t.description}</td></tr>)}</tbody></table></div>
        </>
      )}
    </div>
  );
}

function Connections({ owner }: { owner: boolean }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [s, setS] = useState<R<"finSettings"> | null>(null);
  useEffect(() => { void dev.call("finSettings").then(setS); }, [dev]);
  const save = async () => { if (!s) return; try { setS(await dev.call("saveFinSettings", s)); toast("Saved on this device.", "green"); } catch (e) { toast(errText(e), "red"); } };
  const group = (kind: "bank" | "provider", title: string) => (
    <div className={card}>
      <div className="font-semibold">{title}</div>
      <ul className="flex flex-col gap-2">
        {SOURCES.filter((x) => x.kind === kind).map((x) => (
          <li key={x.id} className="border border-line rounded-lg p-3 flex flex-col gap-1">
            <div className="flex justify-between items-center gap-2 flex-wrap"><span className="font-medium">{x.name}</span><Badge tone={SOURCE_TONE[x.label]}>{LABEL_TEXT[x.label]}</Badge></div>
            <div className="text-sm">{x.today}</div>
            <div className="text-[12.5px] text-muted">Timing: {x.delay}{x.docs ? <> · <a className="text-teal" href={x.docs} target="_blank" rel="noopener noreferrer">provider documentation</a></> : null}</div>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted max-w-3xl">Keep your bank, your UPI ID and your QR code as they are. Payments from Google Pay, PhonePe, Paytm, BHIM or any UPI app reach your bank, so your bank statement shows them all. Direct connections are listed with where they stand; none is switched on until the provider confirms it works for your account.</div>
      <div className="grid gap-4 lg:grid-cols-2">{group("bank", "Bank connections")}{group("provider", "Payment providers")}</div>
      {owner && s && (
        <div className={`${card} max-w-xl`}>
          <div className="font-semibold">Payment QR and matching (this device)</div>
          <label className={label}>Shop’s UPI ID (the one on your QR today)<input value={s.upiId} onChange={(e) => setS({ ...s, upiId: e.target.value.trim() })} placeholder="shopname@okhdfcbank" className={input} aria-label="Shop UPI ID" /></label>
          <label className={label}>Name shown to the payer<input value={s.payee} onChange={(e) => setS({ ...s, payee: e.target.value })} className={input} aria-label="Payee name" /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={s.autoKnownPayers} onChange={(e) => setS({ ...s, autoKnownPayers: e.target.checked })} className="mt-1" />
            <span>Match automatically when the amount equals the only open bill of a customer whose UPI ID paid their bills before.<span className="block text-[12.5px] text-muted">Off: these stay suggestions for you to approve.</span></span></label>
          <Button variant="primary" className="self-start" onClick={save}>Save</Button>
        </div>
      )}
    </div>
  );
}
