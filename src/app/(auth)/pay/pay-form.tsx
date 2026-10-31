"use client";
import { useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { openCheckout } from "@/components/razorpay";
import { PRODUCTS } from "@/staff/constants";
import { payConfirmAction, payFailedAction, payQuoteAction, payStartAction } from "./actions";

type Info = { enabled: boolean; name: string; code: string; plan: string; cycle: string; status: string; renewsOn: string | null; renewOpen: boolean; renewOpensOn: string | null };
type PlanId = "starter" | "pro" | "multi";
const PLANS = PRODUCTS.filter((p): p is (typeof PRODUCTS)[number] & { id: PlanId } => ["starter", "pro", "multi"].includes(p.id));
const rs = (r: number) => "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function PayForm({ link, info }: { link: { l: string; s: string }; info: Info }) {
  const [plan, setPlan] = useState<PlanId>((PLANS.find((p) => p.id === info.plan)?.id ?? "pro") as PlanId);
  const [cycle, setCycle] = useState<"m" | "y">(info.cycle === "y" ? "y" : "m");
  const [code, setCode] = useState(""), [coupon, setCoupon] = useState<{ code: string; label: string; total: number } | null>(null);
  const [err, setErr] = useState(""), [done, setDone] = useState(false), [dupe, setDupe] = useState(false);
  const [busy, start] = useTransition();
  const list = (PLANS.find((p) => p.id === plan)!.m) * (cycle === "y" ? 10 : 1);
  const due = coupon ? coupon.total / 100 : list;

  const apply = () => start(async () => {
    setErr("");
    const r = await payQuoteAction(link, { plan, cycle, coupon: code });
    if (!r.ok) { setCoupon(null); return setErr(r.error); }
    setCoupon(r.data.coupon ? { code: r.data.coupon.code, label: r.data.coupon.label, total: r.data.total } : null);
  });
  const pay = () => start(async () => {
    setErr("");
    const r = await payStartAction(link, { plan, cycle, coupon: coupon?.code ?? "" });
    if (!r.ok) return setErr(r.error);
    if (r.data.free) return setDone(true);
    try {
      await openCheckout(r.data, (resp) => start(async () => {
        const c = await payConfirmAction(link, { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature });
        if (!c.ok) return setErr(c.error);
        setDupe(c.data.duplicate);
        setDone(true);
      }), (msg) => { setErr(msg); void payFailedAction(link, { orderId: r.data.free ? "" : r.data.orderId, reason: msg }); });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t start the payment."); }
  });

  if (done) return (
    <div className="flex flex-col items-center text-center gap-2.5 py-2">
      <CircleCheck size={40} className="text-ok" />
      <strong className="text-[17px]">{dupe ? "You had already paid" : "Payment received. Thank you!"}</strong>
      {dupe ? <span className="text-[13.5px] text-ink-2">This plan was paid a few minutes ago, so this second payment is being refunded to you automatically (Razorpay usually takes 5–7 working days).</span> : null}
      <span className="text-[13.5px] text-muted">Your plan updates in the Medoro app at its next licence check-in. To see it now, open Subscription in the app and press <strong>Check now</strong>. Your invoice appears there too. You can close this page.</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="text-[13.5px] text-ink-2 bg-subtle border border-line rounded-lg px-3 py-2.5">
        <strong>{info.name}</strong> <span className="text-muted">({info.code})</span>
        <div className="text-muted">{info.status === "trial" ? "Free trial" : info.status === "cancelled" ? "Cancelled" : "Current plan"}{info.renewsOn ? ` · ${info.status === "trial" ? "ends" : "paid until"} ${day(info.renewsOn)}` : ""}</div>
      </div>
      {!info.enabled ? <p className="m-0 text-[13.5px] text-ink-2">Online payments aren’t switched on yet. Pay by UPI or bank transfer from Subscription in your app.</p> : !info.renewOpen ? (
        <p className="m-0 text-[13.5px] text-ink-2">You’re all set: your plan is paid until <strong>{day(info.renewsOn!)}</strong>. Renewal opens on {day(info.renewOpensOn!)}, 30 days before it ends, so you can’t pay twice by mistake.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Plan"><Select value={plan} onChange={(e) => { setPlan(e.target.value as PlanId); setCoupon(null); }}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Billing"><Select value={cycle} onChange={(e) => { setCycle(e.target.value as "m" | "y"); setCoupon(null); }}><option value="m">Monthly</option><option value="y">Yearly (2 months free)</option></Select></Field>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) apply(); }} className="flex gap-2 items-end">
            <Field label="Coupon code (optional)" className="flex-1"><Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCoupon(null); }} placeholder="LAUNCH20" className="font-mono uppercase" autoComplete="off" /></Field>
            {coupon ? <Button onClick={() => { setCoupon(null); setCode(""); }}>Remove</Button> : <Button type="submit" disabled={busy || !code.trim()}>Apply</Button>}
          </form>
          <span className="text-[13.5px]">{coupon ? <>Coupon <strong className="font-mono">{coupon.code}</strong>: {coupon.label}. <span className="line-through text-muted">{rs(list)}</span> </> : "Amount "}<strong className="tnum">{rs(due)}</strong> <span className="text-muted">(incl. 18% GST)</span></span>
          <Button variant="primary" size="lg" disabled={busy} onClick={pay}>{busy ? "Please wait…" : due === 0 ? "Activate plan" : `Pay ${rs(due)} now`}</Button>
          <span className="text-[12.5px] text-faint">UPI, cards, netbanking and wallets, through Razorpay. A renewal paid early starts when your current period ends. No auto-renewal. By paying you accept the <a href="/legal#terms" target="_blank" className="underline">Terms</a> and <a href="/legal#refund" target="_blank" className="underline">Cancellation & refund policy</a>.</span>
        </>
      )}
      {err ? <p role="alert" className="m-0 text-[13px] text-bad">{err}</p> : null}
    </div>
  );
}
