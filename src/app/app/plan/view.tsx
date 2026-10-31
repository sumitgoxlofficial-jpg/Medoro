"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { openCheckout } from "@/components/razorpay";
import { PRODUCTS } from "@/staff/constants";
import type { planView } from "@/domain/system/licence";
import { addonAction, cancelAction, checkNowAction, confirmOnlineAction, connectKeyAction, couponAction, paidAction, payLinkAction, payOnlineAction } from "./actions";

type Online = { enabled: boolean; payments: { id: string; plan: string; cycle: string; amountPaise: number; gstPaise: number; coupon: string | null; paymentId: string | null; paidAt: string; periodTo: string }[] };


type V = Awaited<ReturnType<typeof planView>>;
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const day = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const inr = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
/** Rupees with paise shown as two digits when there are any: ₹1,999.20, ₹2,499. */
const rs = (r: number) => "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const PLANS = PRODUCTS.filter((p) => !("once" in p));
/** List price including GST, in rupees. Yearly is 10 months. */
const price = (id: string, cycle: string) => { const p = PLANS.find((x) => x.id === id) ?? PLANS[1]; return cycle === "y" ? p.m * 10 : p.m; };
const KIND: Record<string, string> = { payment: "Payment reported", addon_add: "Add AI add-on", addon_remove: "Remove AI add-on", cancel: "Cancel plan", trial_extended: "Trial extended", payment_claim: "Payment reported" };
const STATUS: Record<string, [string, Tone]> = { queued: ["Waiting to send", "gray"], open: ["With Medoro", "blue"], done: ["Done", "green"], rejected: ["Declined", "red"] };

function phaseOf(v: V): [string, Tone, string] {
  const a = v.access, n = a.daysLeft ?? 0, d = `${n} day${n === 1 ? "" : "s"}`;
  switch (a.phase) {
    case "unlicensed": return ["Self-hosted", "gray", "Not connected to Medoro’s licence server: nothing is limited."];
    case "trial": return ["Free trial", "blue", a.endsOn ? `${n ? `${d} left` : "Last day"} · ends ${day(a.endsOn)}` : "Trial"];
    case "active": return [a.cancelled ? "Cancelled" : "Active", a.cancelled ? "amber" : "green", a.endsOn ? `${a.cancelled ? "Access until" : "Paid until"} ${day(a.endsOn)}${!a.cancelled ? ` · ${d} left` : ""}` : "No end date"];
    case "grace": return ["Grace period", "amber", `${a.trial ? "Trial" : "Plan"} ended ${day(a.endsOn!)} · read-only in ${d}`];
    default: return ["Expired · read-only", "red", "Sales, purchases, stock changes and messages are paused. Viewing, exports, backups and restore still work."];
  }
}

export function PlanView({ v, usage, pay, reference, online }: { v: V; usage: { branches: number; counters: number; users: number }; pay: { upi: string | null; payee: string; bank: string | null }; reference: string; online: Online }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();
  const current = PLANS.find((p) => p.name === v.plan)?.id ?? "pro";
  const [product, setProduct] = useState<"starter" | "pro" | "multi" | "ai">(current as "starter" | "pro" | "multi");
  const [cycle, setCycle] = useState("m");
  const amount = price(product, cycle);
  const [paid, setPaid] = useState<null | { reference: string; paidOn: string; amountRupees: string; payer: string }>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const connected = !!v.server;
  const ref = `${reference}-${product.toUpperCase()}${cycle.toUpperCase()}`;
  const upiUrl = useMemo(() => (pay.upi ? `upi://pay?${new URLSearchParams({ pa: pay.upi, pn: pay.payee, am: amount.toFixed(2), cu: "INR", tn: `Medoro ${ref}` })}` : null), [pay.upi, pay.payee, amount, ref]);
  useEffect(() => { if (upiUrl) QRCode.toDataURL(upiUrl, { margin: 1, width: 168 }).then(setQr).catch(() => setQr(null)); }, [upiUrl]);
  const [label, tone, line] = phaseOf(v);
  const pendingAddon = v.requests.find((r) => r.kind.startsWith("addon_") && ["queued", "open"].includes(r.status));
  const pendingCancel = v.requests.find((r) => r.kind === "cancel" && ["queued", "open"].includes(r.status));
  const hasAi = v.addons.includes("ai");
  const manual = (!!pay.upi || !!pay.bank) && (connected || !online.enabled);
  const [paying, setPaying] = useState(false);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; percentOff: number } | null>(null);
  const [couponErr, setCouponErr] = useState("");
  // Same rounding as the server (GST-inclusive list price minus the percentage); the server re-checks before charging.
  const due = coupon ? amount - Math.round((amount * 100 * coupon.percentOff) / 100) / 100 : amount;
  const applyCoupon = () => {
    if (product === "ai" || !code.trim()) return;
    setCouponErr("");
    start(async () => {
      const r = await couponAction({ plan: product, cycle: cycle as "m" | "y", coupon: code });
      if (!r.ok) { setCoupon(null); return setCouponErr(r.error); }
      setCoupon(r.data.coupon);
    });
  };

  const payOnline = async () => {
    if (product === "ai") return;
    setPaying(true);
    try {
      const r = await payOnlineAction({ plan: product, cycle: cycle as "m" | "y", coupon: coupon?.code ?? "" });
      if (!r.ok) return toast(r.error, "red");
      if (r.data.free) { toast(r.message ?? "Your plan is active.", "green"); return router.refresh(); }
      await openCheckout(r.data,
        (resp) => act(() => confirmOnlineAction({ orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature })),
        (msg) => toast(msg, "red"));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t start the payment.", "red");
    } finally { setPaying(false); }
  };

  const act = <T,>(fn: () => Promise<{ ok: true; data: T; message?: string } | { ok: false; error: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast(r.error, "red");
    if (r.message) toast(r.message, "green");
    after?.(); router.refresh();
  });

  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] max-w-[1200px] items-start">
      <div className="flex flex-col gap-4">
        <div className={card}>
          <div className="flex items-center gap-2"><span className="text-[12.5px] text-muted font-medium">Current plan</span><Badge tone={tone} className="ml-auto">{label}</Badge></div>
          <div className="text-[22px] font-semibold">{v.plan ?? "—"}{hasAi ? " + AI add-on" : ""}</div>
          <div className="text-[13px] text-muted">{line}</div>
          {[["Branches", String(usage.branches)], ["Counters", String(usage.counters)], ["Active users", String(usage.users)], ["WhatsApp invoices", "Included (your own Meta account)"], ["Backups", "Included (your own Google Drive)"]].map(([k, val]) => (
            <div key={k} className="flex justify-between text-[13.5px] py-1 border-b border-row last:border-0"><span className="text-ink-2">{k}</span><span className="tnum">{val}</span></div>
          ))}
        </div>

        <div className={card}>
          <div className="font-semibold text-[15px]">Renew or pay</div>
          {online.enabled ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Plan"><Select value={product} onChange={(e) => { setProduct(e.target.value as typeof product); setCoupon(null); }}>{PLANS.filter((p) => !("addon" in p)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                <Field label="Billing"><Select value={cycle} onChange={(e) => { setCycle(e.target.value); setCoupon(null); }}><option value="m">Monthly</option><option value="y">Yearly (2 months free)</option></Select></Field>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); applyCoupon(); }} className="flex gap-2 items-end">
                <Field label="Coupon code (optional)" className="flex-1"><Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCoupon(null); setCouponErr(""); }} placeholder="LAUNCH20" className="font-mono uppercase" autoComplete="off" /></Field>
                {coupon ? <Button onClick={() => { setCoupon(null); setCode(""); }}>Remove</Button> : <Button type="submit" disabled={busy || !code.trim()}>Apply</Button>}
              </form>
              {couponErr ? <span role="alert" className="text-[12.5px] text-bad -mt-1">{couponErr}</span> : null}
              {coupon ? (
                <span className="text-[13.5px]">Coupon <strong className="font-mono">{coupon.code}</strong>: {coupon.percentOff}% off. <span className="line-through text-muted tnum">₹{amount.toLocaleString("en-IN")}</span> <strong className="tnum">{rs(due)}</strong> <span className="text-muted">(incl. 18% GST)</span></span>
              ) : <span className="text-[13.5px]">Amount <strong className="tnum">₹{amount.toLocaleString("en-IN")}</strong> <span className="text-muted">(incl. 18% GST)</span></span>}
              <Button variant="primary" className="self-start" disabled={busy || paying || product === "ai"} onClick={() => void payOnline()}>{paying ? "Opening…" : due === 0 ? "Activate plan" : `Pay ${rs(due)} now`}</Button>
              <span className="text-[12.5px] text-faint">UPI, cards, netbanking and wallets, through Razorpay. Your plan extends as soon as the payment goes through{v.access.phase === "trial" || v.access.phase === "active" ? ", after the days you have left" : ""}.</span>
            </>
          ) : null}
          {connected && !online.enabled ? (
            <div className="flex flex-col gap-1.5">
              <Button variant="primary" className="self-start" disabled={busy} onClick={() => start(async () => {
                const r = await payLinkAction();
                if (!r.ok) return toast(r.error, "red");
                setPayUrl(r.data);
                // The desktop app opens this in the system browser; a browser may block it, so the link below stays.
                window.open(r.data, "_blank", "noopener");
              })}>Pay online</Button>
              {payUrl ? <a href={payUrl} target="_blank" rel="noopener" className="text-[13px] text-teal underline self-start">Payment page didn’t open? Open it here</a> : null}
              <span className="text-[12.5px] text-faint">Opens Medoro’s payment page in your browser: UPI, cards, netbanking or wallets through Razorpay, with coupon codes. Your plan updates here after payment (press Check now to see it straight away).</span>
              {pay.upi || pay.bank ? <div className="text-[12.5px] text-muted pt-1 border-t border-row">Or pay by UPI or bank transfer and report it:</div> : null}
            </div>
          ) : null}
          {online.enabled && !manual ? null : connected && !online.enabled && !pay.upi && !pay.bank ? null : !pay.upi && !pay.bank ? (
            <div className="text-[13px] text-ink-2">Payment details aren’t configured on this server. Contact Medoro billing for UPI or bank details{connected ? ", then report the payment below" : ""}.</div>
          ) : (
            <>
              {online.enabled ? <div className="text-[12.5px] text-muted pt-1 border-t border-row">Or pay by UPI or bank transfer and report it:</div> : (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Plan"><Select value={product} onChange={(e) => setProduct(e.target.value as typeof product)}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                  <Field label="Billing"><Select value={cycle} onChange={(e) => setCycle(e.target.value)}><option value="m">Monthly</option><option value="y">Yearly (2 months free)</option></Select></Field>
                </div>
              )}
              <div className="flex gap-3 items-start flex-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {qr ? <img src={qr} alt="UPI QR code" width={168} height={168} className="rounded-lg border border-line" /> : null}
                <div className="flex flex-col gap-1 text-[13.5px] flex-1 min-w-[200px]">
                  <span>Amount <strong className="tnum">₹{amount.toLocaleString("en-IN")}</strong> <span className="text-muted">(incl. 18% GST)</span></span>
                  {pay.upi ? <span>UPI ID <strong className="font-mono">{pay.upi}</strong> ({pay.payee})</span> : null}
                  {pay.bank ? <span className="whitespace-pre-line">Bank transfer: {pay.bank}</span> : null}
                  <span className="flex items-center gap-1.5">Reference <strong className="font-mono">{ref}</strong>
                    <button type="button" aria-label="Copy reference" className="text-muted hover:text-ink cursor-pointer" onClick={() => { navigator.clipboard?.writeText(ref); toast("Reference copied.", "green"); }}><Copy size={13} /></button></span>
                  <span className="text-[12.5px] text-faint">Put the reference in the payment note. Scan the QR with any UPI app, or pay by bank transfer.</span>
                </div>
              </div>
            </>
          )}
          {connected && (pay.upi || pay.bank) ? (paid ? (
            <form onSubmit={(e) => { e.preventDefault(); act(() => paidAction({ product, cycle: cycle as "m" | "y", ...paid }), () => setPaid(null)); }} className="flex flex-col gap-2 bg-page border border-line rounded-lg p-3">
              <strong className="text-[13.5px]">Report your payment</strong>
              <div className="grid grid-cols-2 gap-2">
                <Field label="UPI reference (UTR) or bank transaction no."><Input value={paid.reference} onChange={(e) => setPaid({ ...paid, reference: e.target.value })} required /></Field>
                <Field label="Amount paid (₹)"><Input inputMode="decimal" value={paid.amountRupees} onChange={(e) => setPaid({ ...paid, amountRupees: e.target.value })} required /></Field>
                <Field label="Paid on"><Input type="date" max={today()} value={paid.paidOn} onChange={(e) => setPaid({ ...paid, paidOn: e.target.value })} required /></Field>
                <Field label="Paid by (name on the account)"><Input value={paid.payer} onChange={(e) => setPaid({ ...paid, payer: e.target.value })} /></Field>
              </div>
              <div className="flex gap-2 justify-end"><Button onClick={() => setPaid(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>Send to Medoro</Button></div>
            </form>
          ) : (
            <Button variant="primary" className="self-start" onClick={() => setPaid({ reference: "", paidOn: today(), amountRupees: String(amount), payer: "" })}>I’ve paid</Button>
          )) : null}
        </div>

        <div className={card}>
          <div className="font-semibold text-[15px]">AI Pharmacy Manager add-on</div>
          <div className="text-[13px] text-ink-2">{hasAi ? "Included in your plan." : `₹${PRODUCTS.find((p) => p.id === "ai")!.m}/month on top of your plan (incl. GST).`}</div>
          {pendingAddon ? <div className="text-[12.5px] text-muted">{KIND[pendingAddon.kind]} · {STATUS[pendingAddon.status][0].toLowerCase()} since {when(pendingAddon.at)}</div> : null}
          {connected ? <Button className="self-start" disabled={busy || !!pendingAddon} onClick={() => act(() => addonAction(!hasAi))}>{hasAi ? "Remove add-on" : "Add AI add-on"}</Button> : null}
        </div>

        {connected && v.access.phase !== "unlicensed" ? (
          <div className={card}>
            <div className="font-semibold text-[15px]">Cancel subscription</div>
            <div className="text-[13px] text-ink-2">You keep full access until the paid period ends; then Medoro becomes read-only. Your data stays on your server and exports, backups and restore keep working.</div>
            {pendingCancel ? <div className="text-[12.5px] text-muted">Cancellation {STATUS[pendingCancel.status][0].toLowerCase()} since {when(pendingCancel.at)}.</div>
              : v.access.cancelled ? <div className="text-[12.5px] text-muted">Cancelled. Pay again any time to continue.</div>
              : cancel === null ? <Button variant="danger-outline" className="self-start" onClick={() => setCancel("")}>Cancel subscription…</Button>
              : (
                <form onSubmit={(e) => { e.preventDefault(); act(() => cancelAction(cancel), () => setCancel(null)); }} className="flex flex-col gap-2">
                  <Field label="Why are you cancelling? (optional)"><Textarea value={cancel} onChange={(e) => setCancel(e.target.value)} maxLength={500} /></Field>
                  <div className="flex gap-2"><Button onClick={() => setCancel(null)}>Keep my plan</Button><Button type="submit" variant="danger" disabled={busy}>Request cancellation</Button></div>
                </form>
              )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <div className={card}>
          <div className="flex items-center"><span className="font-semibold text-[15px]">Licence</span>
            {connected ? <Button size="sm" className="ml-auto" disabled={busy} onClick={() => act(() => checkNowAction())}><RefreshCw size={13} />Check now</Button> : null}</div>
          {connected ? (
            <>
              <div className="text-[13.5px] text-ink-2">Checks in with Medoro at <span className="font-mono">{v.server}</span>. Check-ins send only your pharmacy’s name and owner contact (once, to start the licence), app version, branch and counter counts, and the requests you make on this page or under Help.</div>
              <div className="text-[12.5px] text-muted flex flex-col gap-0.5">
                {v.customerCode ? <span>Customer {v.customerCode}{v.licenceId ? ` · licence ${v.licenceId.slice(0, 8)}…` : ""}</span> : null}
                <span>{v.issuedAt ? `Licence signed ${when(v.issuedAt)}` : "No signed licence yet: the 14-day trial from setup applies."}{v.checkedAt ? ` · last check ${when(v.checkedAt)}` : ""}</span>
                {!v.verifying ? <span className="text-bad">LICENSE_PUBLIC_KEY is not set, so licences can’t be verified.</span> : null}
                {v.checkError ? <span className="text-[#94570A]">{v.checkError}</span> : null}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); act(() => connectKeyAction(key), () => setKey("")); }} className="flex gap-2 items-end">
                <Field label="Have a licence key from Medoro?" className="flex-1"><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="MEDORO-…" className="font-mono" /></Field>
                <Button type="submit" disabled={busy || !key.trim()}>Connect</Button>
              </form>
            </>
          ) : (
            online.enabled
              ? <div className="text-[13.5px] text-ink-2">Your subscription is managed on this server: pay online above and your plan updates straight away.</div>
              : <div className="text-[13.5px] text-ink-2">This installation isn’t connected to Medoro’s licence server (<span className="font-mono">LICENSE_SERVER_URL</span> is not set), so it runs without a licence and nothing is limited.</div>
          )}
          <div className="text-[12.5px] text-faint">If Medoro can’t be reached, the last signed licence keeps applying. After a trial or paid period ends there are {v.access.graceEndsOn && v.access.endsOn ? Math.round((Date.parse(v.access.graceEndsOn) - Date.parse(v.access.endsOn)) / 86400_000) : 7} days of grace, then the app is read-only until you renew. Your records, exports and backups always stay available.</div>
        </div>

        <div className={card}>
          <div className="font-semibold text-[15px]">Medoro invoices</div>
          {online.payments.length ? (
            <table className="w-full text-[13px] border-collapse">
              <thead><tr className="text-muted text-[12px] text-left"><th className="py-1 font-medium">Paid</th><th className="py-1 font-medium">For</th><th className="py-1 font-medium text-right">Amount</th></tr></thead>
              <tbody>{online.payments.map((p) => (
                <tr key={p.id} className="border-t border-row align-top">
                  <td className="py-1.5">{day(p.paidAt)}<div className="text-[12px] text-muted font-mono">{p.paymentId}</div></td>
                  <td className="py-1.5">{p.plan} · {p.cycle === "y" ? "1 year" : "1 month"}{p.coupon ? <div className="text-[12px] text-muted">Coupon {p.coupon}</div> : null}<div className="text-[12px] text-muted">Paid until {day(p.periodTo)}</div></td>
                  <td className="py-1.5 text-right tnum">{inr(p.amountPaise)}<div className="text-[12px] text-muted">incl. GST {inr(p.gstPaise)}</div></td>
                </tr>
              ))}</tbody>
            </table>
          ) : null}
          {online.payments.length && !v.invoices.length ? null : v.invoices.length ? (
            <table className="w-full text-[13px] border-collapse">
              <thead><tr className="text-muted text-[12px] text-left"><th className="py-1 font-medium">Invoice</th><th className="py-1 font-medium">For</th><th className="py-1 font-medium text-right">Amount</th></tr></thead>
              <tbody>{v.invoices.map((i) => (
                <tr key={i.number} className="border-t border-row align-top">
                  <td className="py-1.5"><div className="font-mono">{i.number}</div><div className="text-[12px] text-muted">{day(i.date)}</div></td>
                  <td className="py-1.5">{i.description}{i.reference ? <div className="text-[12px] text-muted">Ref {i.reference}</div> : null}</td>
                  <td className="py-1.5 text-right tnum">{inr(i.amountPaise + i.gstPaise)}<div className="text-[12px] text-muted">incl. GST {inr(i.gstPaise)}</div></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="text-[13px] text-fainter">{connected || online.enabled ? "No payments yet. They appear here once a payment goes through." : "Invoices come with the licence. Not connected."}</div>}
        </div>

        {v.requests.length || v.billing.length ? (
          <div className={card}>
            <div className="font-semibold text-[15px]">Requests to Medoro</div>
            {v.requests.map((r) => (
              <div key={r.id} className="flex gap-2 items-center text-[13px] py-1 border-t border-row first:border-0">
                <span className="flex-1 min-w-0">{KIND[r.kind] ?? r.kind}{r.kind === "payment" ? ` · ${String(r.payload.reference ?? "")}` : ""}<span className="text-muted"> · {r.by} · {when(r.at)}</span>{r.error ? <span className="text-bad"> · {r.error}</span> : null}</span>
                <Badge tone={r.error ? "red" : STATUS[r.status]?.[1] ?? "gray"}>{r.error ? "Not accepted" : STATUS[r.status]?.[0] ?? r.status}</Badge>
              </div>
            ))}
            {v.billing.filter((b) => !b.requestId).map((b) => (
              <div key={b.id} className="flex gap-2 items-center text-[13px] py-1 border-t border-row"><span className="flex-1">{b.detail}<span className="text-muted"> · {when(b.at)}</span></span><Badge tone="green">Done</Badge></div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
