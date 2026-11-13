import { counted } from "@/server/metrics";
import { getCtx } from "@/server/context";
import { limited, userKey } from "@/server/ratelimit";
import { invoicePdfOf } from "@/domain/system/invoice";

/** The PDF invoice for one of the signed-in pharmacy's subscription payments (owners and anyone who manages the plan). */
export const GET = counted("billingInvoice", async (_: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only.", { status: 403 });
  if (!ctx || !ctx.perms.includes("users")) return new Response("Forbidden", { status: 403 });
  const slow = await limited("invoiceDownload", userKey(ctx));
  if (slow) return slow;
  const made = await invoicePdfOf(ctx.tenantId, (await params).id);
  if (!made) return new Response("There is no invoice for this payment.", { status: 404 });
  return new Response(new Uint8Array(made.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Invoice-${made.inv.invoiceNo}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" },
  });
});
