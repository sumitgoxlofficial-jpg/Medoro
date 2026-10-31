"use client";
/** Razorpay Checkout in the browser: loaded once, on demand. */
export type RzpResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RzpCheckout = { open: () => void; on: (e: string, fn: (r: { error?: { description?: string } }) => void) => void };
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => RzpCheckout } }

export const loadCheckout = () => new Promise<void>((resolve, reject) => {
  if (window.Razorpay) return resolve();
  const s = document.createElement("script");
  s.src = "https://checkout.razorpay.com/v1/checkout.js";
  s.onload = () => resolve();
  s.onerror = () => reject(new Error("Couldn’t load Razorpay. Check your internet connection and try again."));
  document.body.appendChild(s);
});

/** Opens Checkout for an order made on the server; `onPaid` gets Razorpay's signed response. */
export async function openCheckout(o: { keyId: string; orderId: string; amount: number; currency: string; name: string; description: string; prefill: Record<string, string>; notes: Record<string, string> }, onPaid: (r: RzpResponse) => void, onFail: (msg: string) => void) {
  await loadCheckout();
  const rzp = new window.Razorpay!({
    key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, name: o.name, description: o.description,
    prefill: o.prefill, notes: o.notes, theme: { color: "#0B5E5B" }, handler: onPaid,
  });
  rzp.on("payment.failed", (e) => onFail(e.error?.description ? `Payment failed: ${e.error.description}` : "Payment failed. No money was taken; try again."));
  rzp.open();
}
