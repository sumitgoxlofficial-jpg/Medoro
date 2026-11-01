"use client";
import { useState } from "react";
import { Building2, Landmark, Lock } from "lucide-react";
import { IFSC_BANKS, IFSC_RE, TDS_PCT, rupees } from "@/staff/constants";
import { runPayout, saveBank, verifyBank } from "../../actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, fmtDay, lbl, panel, td, th, useRun } from "../ui";

type Bank = { holder: string; last4: string; ifsc: string; bank: string; type: string; panMasked: string; status: string; addedAt: string; verifiedAt: string | null };
type Row = { key: string; month: string; staff: string; n: number; gross: number; tds: number; net: number; status: string; bank: { label: string; verified: boolean } | null };
const ST: Record<string, [string, string]> = { paid: ["Paid", "#18794E"], scheduled: ["Ready for next payout", "#2459C9"], processing: ["Payout on the way", "#2459C9"], awaiting: ["Awaiting verification", "#94570A"] };

export function PayoutsView({ admin, name, rows, bank, pendingBanks, run: r }: { admin: boolean; name: string; rows: Row[]; bank: Bank | null; pendingBanks: { staffId: string; name: string; empNo: string; label: string; holder: string; ifsc: string; panMasked: string; addedAt: string }[]; run: { total: number; people: number } }) {
  const { run, busy } = useRun();
  const [edit, setEdit] = useState(!bank);
  const [f, setF] = useState({ holder: name, account: "", account2: "", ifsc: "", pan: "", type: "Savings", consent: false });
  const ifscOk = IFSC_RE.test(f.ifsc);
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const status = !bank ? ["Not added", "#FDF2E1", "#94570A"] : bank.status === "verified" ? ["Verified", "#E7F6EE", "#18794E"] : ["Waiting for finance check", "#EAF0FC", "#2459C9"];

  return (
    <>
      {!admin ? (
        <section className={panel + " flex flex-col"}>
          <div className="px-[18px] py-3.5 border-b border-[#EEF0F2] flex gap-2.5 items-center flex-wrap">
            <Landmark size={18} className="text-teal" />
            <div className="flex flex-col flex-1 min-w-[200px]"><strong className="text-[14.5px]">Payout bank account</strong><span className="text-[12.5px] text-muted">Commission is paid here after each monthly payout run.</span></div>
            <Pill bg={status[1]} fg={status[2]}>{status[0]}</Pill>
          </div>
          {bank && !edit ? (
            <div className="px-[18px] py-4 flex gap-4 items-center flex-wrap">
              <div className="size-11 rounded-[10px] bg-teal-tint text-teal flex items-center justify-center flex-none"><Building2 size={20} /></div>
              <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]"><strong className="text-[15px]">{bank.bank} · •••• {bank.last4}</strong><span className="text-[13px] text-muted">{bank.holder} · {bank.type} · IFSC {bank.ifsc}</span><span className="text-[12.5px] text-muted">PAN {bank.panMasked} · {bank.verifiedAt ? `verified on ${fmtDay(bank.verifiedAt)}` : `added ${fmtDay(bank.addedAt)}, finance checks it before the first payout`}</span></div>
              <button className={btn + " px-3.5 py-2 text-[13.5px]"} onClick={() => setEdit(true)}>Change account</button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); run(() => saveBank(f as never), () => { setEdit(false); setF((x) => ({ ...x, account: "", account2: "", pan: "", consent: false })); }); }} className="px-[18px] py-4 flex flex-col gap-3">
              <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]">
                <label className={lbl}>Account holder name (as per bank)<input className={fieldCls} value={f.holder} onChange={(e) => set("holder", e.target.value)} autoComplete="off" /></label>
                <label className={lbl}>Account number<input className={fieldCls + " font-mono"} type="password" inputMode="numeric" autoComplete="off" value={f.account} onChange={(e) => set("account", e.target.value.replace(/\D/g, "").slice(0, 18))} /></label>
                <label className={lbl}>Re-enter account number<input className={fieldCls + " font-mono"} inputMode="numeric" autoComplete="off" value={f.account2} onChange={(e) => set("account2", e.target.value.replace(/\D/g, "").slice(0, 18))} />{f.account2 ? <span className="text-[12px]" style={{ color: f.account2 === f.account ? "#18794E" : "#B3261E" }}>{f.account2 === f.account ? "Account numbers match" : "Account numbers do not match"}</span> : null}</label>
                <label className={lbl}>IFSC code<input className={fieldCls + " font-mono uppercase"} autoComplete="off" value={f.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))} placeholder="HDFC0001123" />{f.ifsc ? <span className="text-[12px]" style={{ color: ifscOk ? "#18794E" : "#B3261E" }}>{ifscOk ? `${IFSC_BANKS[f.ifsc.slice(0, 4)] ?? "Bank " + f.ifsc.slice(0, 4)} · branch code ${f.ifsc.slice(5)}` : "IFSC is 11 characters, like HDFC0001123"}</span> : null}</label>
                <label className={lbl}>PAN (for TDS)<input className={fieldCls + " font-mono uppercase"} autoComplete="off" value={f.pan} onChange={(e) => set("pan", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} placeholder="ABCDE1234F" /></label>
                <label className={lbl}>Account type<select className={fieldCls} value={f.type} onChange={(e) => set("type", e.target.value)}><option>Savings</option><option>Current</option></select></label>
              </div>
              <label className="flex gap-2 items-start text-[13px] text-ink-2"><input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} className="mt-[3px]" />I confirm this account is in my name. Medoro deducts TDS on commission as per law.</label>
              <div className="flex gap-2 justify-end flex-wrap">{bank ? <button type="button" className={btn + " px-3.5 py-[9px] text-[14px]"} onClick={() => setEdit(false)}>Cancel</button> : null}<button disabled={busy} className={btnPrimary}>{bank ? "Save & re-verify" : "Add account"}</button></div>
              <span className="text-[12px] text-fainter flex gap-1.5 items-center"><Lock size={13} />Bank details are encrypted on the server. Only the last 4 digits are ever shown. Changes need a fresh finance check.</span>
            </form>
          )}
        </section>
      ) : (
        <>
          <section className={panel + " px-[18px] py-4 flex gap-3 items-center flex-wrap"}>
            <div className="flex flex-col"><strong className="text-[14.5px]">Payout run</strong><span className="text-[13px] text-muted">{rupees(r.total)} verified commission across {r.people} {r.people === 1 ? "person" : "people"} · {TDS_PCT}% TDS deducted · paid only to verified bank accounts</span></div>
            <button disabled={busy || !r.total} className={btnPrimary + " ml-auto"} onClick={() => { if (confirm("Record this month’s payout? Make the bank transfers from your bank, then keep the statement.")) run(() => runPayout(), (d) => `${d.paid} sale${d.paid === 1 ? "" : "s"} marked paid.${d.held.length ? ` Held for ${d.held.join(", ")}: no verified bank account.` : ""}`); }}>Record payout run</button>
          </section>
          {pendingBanks.length ? (
            <Panel title="Bank accounts to check" sub="Confirm each against a cancelled cheque or bank statement before payouts go to it.">
              {pendingBanks.map((b) => (
                <div key={b.staffId} className="flex gap-3 items-center px-4 py-2.5 border-t border-[#F1F3F4] first:border-t-0 text-[13.5px] flex-wrap">
                  <strong className="font-semibold min-w-[150px]">{b.name}</strong><span className="text-muted flex-1">{b.label} · {b.holder} · IFSC {b.ifsc} · PAN {b.panMasked} · added {fmtDay(b.addedAt)}</span>
                  <button disabled={busy} className={btn} onClick={() => run(() => verifyBank(b.staffId))}>Mark verified</button>
                </div>
              ))}
            </Panel>
          ) : null}
        </>
      )}
      <Panel>
        {rows.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[760px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Month</th><th className={th}>Salesperson</th><th className={th + " text-right"}>Sales</th><th className={th + " text-right"}>Gross commission</th><th className={th + " text-right"}>TDS {TDS_PCT}% (194H)</th><th className={th + " text-right"}>Net payout</th><th className={th}>Paid to</th><th className={th}>Status</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.key}>
                <td className={td + " font-semibold whitespace-nowrap"}>{new Date(p.month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</td>
                <td className={td}>{p.staff}</td><td className={td + " text-right"}>{p.n}</td>
                <td className={td + " text-right tnum"}>{rupees(p.gross)}</td><td className={td + " text-right tnum text-muted"}>−{rupees(p.tds)}</td><td className={td + " text-right tnum font-semibold"}>{rupees(p.net)}</td>
                <td className={td} style={{ color: p.bank?.verified ? "#3D454D" : "#C0362C" }}>{p.bank ? p.bank.label + (p.bank.verified ? "" : " (checking)") : "No bank account"}</td>
                <td className={td + " font-semibold"} style={{ color: ST[p.status][1] }}>{ST[p.status][0]}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No commission yet.</Empty>}
      </Panel>
      <span className="text-[12px] text-fainter">TDS rate shown for illustration. Confirm the applicable rate and contractor vs. employee treatment with your CA.</span>
    </>
  );
}
