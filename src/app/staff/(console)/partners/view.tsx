"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, Search, Send } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { rupees, TDS_PCT } from "@/staff/constants";
import { partnerBankDetails, payPartnerRazorpay, recordPartnerTransfer, refreshPartnerPayout, setEmployeeStatus, verifyBank } from "../../actions";
import { Leaderboard, type Boards } from "../leaderboard";
import { Empty, Kpi, Panel, Pill, btn, btnPrimary, fieldCls, fmtDay, fmtTime, td, th, useRun } from "../ui";

type Row = {
  id: string; empNo: string; name: string; email: string; phone: string; area: string; status: string; code: string | null; google: boolean; joined: string;
  signups: number; paying: number; monthPaise: number; totalPaise: number; readyPaise: number; readyNetPaise: number; processingPaise: number; paidPaise: number;
  bank: { label: string; holder: string; ifsc: string; verified: boolean } | null;
};
type Payout = { id: string; ref: string; staff: string; gross: number; tds: number; net: number; n: number; method: string; status: string; utr: string | null; failure: string | null; at: string };
const PST: Record<string, [string, string, string]> = { processing: ["On the way", "#EAF0FC", "#2459C9"], paid: ["Paid", "#E7F6EE", "#18794E"], failed: ["Failed", "#FDECEC", "#C0362C"] };

/** Super admin: every reference partner, what they've brought in, and paying them. */
export function PartnersView({ rows, boards, history, razorpay, month }: { rows: Row[]; boards: Boards; history: Payout[]; razorpay: boolean; month: string }) {
  const { run, busy } = useRun();
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<Row | null>(null);
  const [utr, setUtr] = useState("");
  const toast = useToast();
  // Full bank details for paying by bank transfer or UPI; loaded (and audited) when the pay dialog opens.
  const [acct, setAcct] = useState<{ holder: string; account: string; ifsc: string; bank: string } | { error: string } | null>(null);
  useEffect(() => {
    setAcct(null);
    if (!pay) return;
    let live = true;
    partnerBankDetails(pay.id).then((r) => { if (live) setAcct(r.ok ? r.data : { error: r.error }); });
    return () => { live = false; };
  }, [pay]);
  const copy = (v: string, what: string) => { navigator.clipboard?.writeText(v); toast(`${what} copied`, "green"); };
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => [r.name, r.email, r.phone, r.area, r.code ?? "", r.empNo].some((v) => v.toLowerCase().includes(s))) : rows;
  }, [rows, q]);
  const active = rows.filter((r) => r.status === "active").length;
  const sum = (k: "monthPaise" | "readyNetPaise" | "signups" | "paying") => rows.reduce((a, r) => a + r[k], 0);
  const monthName = new Date(month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long" });

  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[1100px]:grid-cols-4">
        <Kpi l="Reference partners" v={String(rows.length)} d={`${active} active`} />
        <Kpi l="Pharmacies referred" v={String(sum("signups"))} d={`${sum("paying")} paying`} />
        <Kpi l={`Partner earnings in ${monthName}`} v={rupees(sum("monthPaise"))} c="#0B5E5B" />
        <Kpi l="Ready to pay" v={rupees(sum("readyNetPaise"))} d={`After ${TDS_PCT}% TDS`} c="#94570A" />
      </div>

      <Leaderboard boards={boards} showEarnings />

      <Panel title="All partners" sub="Partners join on their own with Google or email. Verify their bank account before the first payout."
        right={<label className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className={fieldCls + " pl-8 w-[240px] max-[500px]:w-full"} placeholder="Name, phone, code, area" value={q} onChange={(e) => setQ(e.target.value)} /></label>}>
        {shown.length ? (
          <div className="overflow-auto tbl-scroll"><table className="w-full border-collapse min-w-[1040px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]">
              <th className={th}>Partner</th><th className={th}>Code</th><th className={th + " text-right"}>Referred</th><th className={th + " text-right"}>This month</th><th className={th + " text-right"}>Total earned</th><th className={th + " text-right"}>Ready to pay</th><th className={th}>Bank</th><th className={th}></th>
            </tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className={r.status !== "active" ? "opacity-60" : ""}>
                <td className={td}>
                  <div className="font-semibold">{r.name} <span className="text-muted font-normal text-[12px]">{r.empNo}</span></div>
                  <div className="text-[12px] text-muted">{r.email}{r.google ? " · Google" : ""} · {r.phone}</div>
                  <div className="text-[12px] text-muted">{r.area || "—"} · joined {fmtDay(r.joined)}{r.status !== "active" ? ` · ${r.status}` : ""}</div>
                </td>
                <td className={td + " font-mono text-[12.5px]"}>{r.code ?? "—"}</td>
                <td className={td + " text-right tnum"}>{r.signups}<div className="text-[12px] text-muted">{r.paying} paying</div></td>
                <td className={td + " text-right tnum font-semibold text-teal"}>{rupees(r.monthPaise)}</td>
                <td className={td + " text-right tnum"}>{rupees(r.totalPaise)}<div className="text-[12px] text-muted">{rupees(r.paidPaise)} paid</div></td>
                <td className={td + " text-right tnum"}>
                  <span className="font-semibold">{rupees(r.readyNetPaise)}</span>
                  {r.processingPaise ? <div className="text-[12px] text-[#2459C9]">{rupees(r.processingPaise)} on the way</div> : null}
                </td>
                <td className={td}>
                  {r.bank ? <div className="flex flex-col gap-1 items-start"><span>{r.bank.label}</span>
                    {r.bank.verified ? <Pill bg="#E7F6EE" fg="#18794E">Verified</Pill> : <button disabled={busy} className={btn} onClick={() => { if (confirm(`Verify ${r.bank!.holder} · ${r.bank!.label} · ${r.bank!.ifsc}? Check the name matches ${r.name} and the PAN.`)) run(() => verifyBank(r.id)); }}>Verify</button>}
                  </div> : <span className="text-muted text-[12.5px]">Not added</span>}
                </td>
                <td className={td}>
                  <div className="flex gap-1.5 justify-end">
                    <button disabled={busy || !r.readyPaise || !r.bank?.verified} title={!r.bank?.verified ? "Verify the bank account first" : ""} className={btnPrimary + " !py-1.5 !px-2.5 !text-[12.5px]"} onClick={() => { setPay(r); setUtr(""); }}><Send size={13} />Pay</button>
                    <button disabled={busy} className={btn} onClick={() => { if (confirm(r.status === "active" ? `Deactivate ${r.name}? Their referral code stops working for new sign-ups.` : `Reactivate ${r.name}?`)) run(() => setEmployeeStatus(r.id, r.status === "active" ? "deactivate" : "reactivate")); }}>{r.status === "active" ? "Deactivate" : "Reactivate"}</button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{rows.length ? "No partner matches that search." : "No reference partners yet. Share medoro.in/partners with MRs."}</Empty>}
      </Panel>

      {pay ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPay(null)}>
          <div className="bg-white rounded-xl w-[min(440px,100%)] p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Pay ${pay.name}`}>
            <strong className="text-[16px]">Pay {pay.name}</strong>
            <div className="grid grid-cols-[1fr_auto] gap-y-1 text-[13.5px]">
              <span className="text-muted">Commission ready</span><span className="tnum text-right">{rupees(pay.readyPaise)}</span>
              <span className="text-muted">TDS {TDS_PCT}%</span><span className="tnum text-right">−{rupees(pay.readyPaise - pay.readyNetPaise)}</span>
              <span className="font-semibold">To pay</span><span className="tnum text-right font-bold text-teal">{rupees(pay.readyNetPaise)}</span>
              <span className="text-muted">To</span><span className="text-right">{pay.bank?.holder} · {pay.bank?.label}</span>
            </div>
            {razorpay ? (
              <button disabled={busy} className={btnPrimary + " justify-center"} onClick={() => run(() => payPartnerRazorpay(pay.id), (d) => { setPay(null); return d.status === "paid" ? `Paid ${rupees(d.net)} to ${pay.name}.` : `${rupees(d.net)} sent with Razorpay. It shows as paid once the bank confirms.`; })}><Send size={14} />Pay {rupees(pay.readyNetPaise)} with Razorpay</button>
            ) : null}
            <div className={`flex flex-col gap-2 ${razorpay ? "border-t border-[#EEF0F2] pt-3" : ""}`}>
              <span className="text-[13px] font-semibold">{razorpay ? "Or pay from your bank or UPI app" : "1. Send the money from your bank or UPI app"}</span>
              <span className="text-[12.5px] text-muted">Use IMPS/NEFT, or “Pay to bank account” in PhonePe, Google Pay or Paytm.</span>
              {acct && "account" in acct ? (
                <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 items-center text-[13.5px] bg-[#F7F8F9] border border-[#EEF0F2] rounded-lg px-3 py-2.5">
                  <span className="text-muted">Name</span><span className="font-semibold truncate">{acct.holder}</span><span />
                  <span className="text-muted">Account</span><span className="font-mono tnum">{acct.account}</span><button type="button" className={btn} onClick={() => copy(acct.account, "Account number")}><Copy size={13} />Copy</button>
                  <span className="text-muted">IFSC</span><span className="font-mono">{acct.ifsc}</span><button type="button" className={btn} onClick={() => copy(acct.ifsc, "IFSC")}><Copy size={13} />Copy</button>
                  <span className="text-muted">Bank</span><span className="truncate">{acct.bank}</span><span />
                  <span className="text-muted">Amount</span><span className="font-bold text-teal tnum">{rupees(pay.readyNetPaise)}</span><button type="button" className={btn} onClick={() => copy((pay.readyNetPaise / 100).toFixed(2), "Amount")}><Copy size={13} />Copy</button>
                </div>
              ) : <div className="text-[12.5px] text-muted bg-[#F7F8F9] rounded-lg px-3 py-2.5">{acct && "error" in acct ? acct.error : "Loading bank details…"}</div>}
              <span className="text-[13px] font-semibold mt-1">{razorpay ? "Then enter its reference" : "2. Enter the UTR / UPI reference to mark it paid"}</span>
              <div className="flex gap-2"><input className={fieldCls} value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UTR / reference" />
                <button disabled={busy || utr.trim().length < 6} className={btn} onClick={() => run(() => recordPartnerTransfer(pay.id, utr), (d) => { setPay(null); return `Recorded ${rupees(d.net)} paid to ${pay.name}.`; })}>Record</button></div>
            </div>
            <button className="text-[13px] text-muted self-center cursor-pointer" onClick={() => setPay(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <Panel title="Partner payouts" sub="Razorpay payouts update automatically when the bank confirms. Failed payouts return the commission to “ready to pay”.">
        {history.length ? (
          <div className="overflow-auto tbl-scroll"><table className="w-full border-collapse min-w-[760px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Date</th><th className={th}>Partner</th><th className={th}>Reference</th><th className={th + " text-right"}>Gross</th><th className={th + " text-right"}>Paid (after TDS)</th><th className={th}>Status</th><th className={th}></th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}>
                <td className={td + " whitespace-nowrap"}>{fmtTime(h.at)}</td>
                <td className={td + " font-semibold"}>{h.staff}</td>
                <td className={td + " text-[12.5px]"}><span className="font-mono">{h.ref}</span><div className="text-muted">{h.method === "razorpay" ? "Razorpay" : "Bank transfer"}{h.utr ? ` · UTR ${h.utr}` : ""}</div></td>
                <td className={td + " text-right tnum"}>{rupees(h.gross)}</td>
                <td className={td + " text-right tnum font-semibold"}>{rupees(h.net)}</td>
                <td className={td}><Pill bg={PST[h.status][1]} fg={PST[h.status][2]}>{PST[h.status][0]}</Pill>{h.failure ? <div className="text-[12px] text-[#C0362C] mt-1 max-w-[220px]">{h.failure}</div> : null}</td>
                <td className={td}>{h.status === "processing" && h.method === "razorpay" ? <button disabled={busy} className={btn} onClick={() => run(() => refreshPartnerPayout(h.id), (d) => `Status: ${PST[d.status]?.[0] ?? d.status}`)}><RefreshCw size={13} />Check</button> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No partner payouts yet.</Empty>}
      </Panel>
    </>
  );
}
