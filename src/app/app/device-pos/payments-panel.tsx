"use client";
import { useCallback, useEffect, useState } from "react";
import { CreditCard, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { connectCustomerPayAction, disconnectCustomerPayAction, payStatusAction } from "../lab/actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5 max-w-lg";
const input = "border border-line rounded-lg px-3 h-9 text-sm w-full bg-white font-mono";
type Status = { connected: boolean; keyId: string | null; webhookUrl: string };

/** Owner: connect the pharmacy's own Razorpay account so customers can pay dues by a UPI/card link. */
export function PaymentsPanel({ onChange }: { onChange?: (connected: boolean) => void }) {
  const toast = useToast();
  const [st, setSt] = useState<Status | null>(null);
  const [f, setF] = useState({ keyId: "", keySecret: "", webhookSecret: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await payStatusAction(); if (r.ok) { setSt(r.data); onChange?.(r.data.connected); } }, [onChange]);
  useEffect(() => { void load(); }, [load]);
  if (!st) return null;
  const save = async () => {
    setBusy(true);
    const r = await connectCustomerPayAction(f);
    toast(r.ok ? r.message ?? "Connected." : r.error, r.ok ? "green" : "red");
    if (r.ok) { setF({ keyId: "", keySecret: "", webhookSecret: "" }); setSt(r.data); onChange?.(true); }
    setBusy(false);
  };
  const off = async () => {
    if (!confirm("Disconnect online payments? Links already sent stop being recorded here.")) return;
    const r = await disconnectCustomerPayAction();
    if (r.ok) { setSt(r.data); onChange?.(false); }
  };
  return (
    <div className={card} data-testid="payments-panel">
      <div className="flex items-center gap-2 font-semibold"><CreditCard size={18} className="text-teal" />Online payments</div>
      <div className="text-sm text-muted">Customers pay what they owe by UPI or card from a link you send on WhatsApp, straight into your own Razorpay account. A payment made while this counter is offline is recorded on the customer’s account when it comes back online. Medoro passes the payment to your devices sealed, and keeps nothing.</div>
      <div className="text-[13px] flex flex-col gap-1">
        <span className="text-muted">In Razorpay → Settings → Webhooks, add this URL with the event <b>payment_link.paid</b> and a secret you choose:</span>
        <span className="flex gap-1.5 items-center"><code className="bg-page border border-line rounded px-2 py-1 break-all text-[12px]" data-testid="pay-webhook-url">{st.webhookUrl}</code>
          <Button size="sm" onClick={() => navigator.clipboard.writeText(st.webhookUrl).then(() => toast("Copied.", "green"))} aria-label="Copy webhook URL"><Copy size={14} /></Button></span>
      </div>
      {st.connected ? (
        <div className="flex items-center justify-between gap-2 flex-wrap text-sm"><span>Connected: <span className="font-mono">{st.keyId}</span></span><Button size="sm" variant="danger-outline" onClick={off}>Disconnect</Button></div>
      ) : (
        <>
          <input value={f.keyId} onChange={(e) => setF({ ...f, keyId: e.target.value })} placeholder="Key Id (rzp_live_…)" aria-label="Razorpay Key Id" className={input} />
          <input value={f.keySecret} onChange={(e) => setF({ ...f, keySecret: e.target.value })} type="password" placeholder="Key Secret" aria-label="Razorpay Key Secret" className={input} />
          <input value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} type="password" placeholder="Webhook secret (same as in Razorpay)" aria-label="Razorpay webhook secret" className={input} />
          <Button variant="primary" className="self-start" onClick={save} disabled={busy || !f.keyId || !f.keySecret || !f.webhookSecret}>{busy ? "Checking…" : "Connect Razorpay"}</Button>
        </>
      )}
    </div>
  );
}
