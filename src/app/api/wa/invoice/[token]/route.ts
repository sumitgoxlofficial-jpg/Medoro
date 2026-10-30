import type { Ctx } from "@/server/context";
import { db } from "@/server/db";
import { invoiceData } from "@/domain/sales/service";
import { invoicePdf } from "@/domain/sales/pdf";
import { checkInvoiceLink } from "@/domain/comms/links";

/** Invoice PDF behind the signed, expiring link sent in text-only WhatsApp invoice messages. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const id = checkInvoiceLink((await params).token);
  const sale = id ? await db.sale.findUnique({ where: { id }, select: { tenantId: true } }) : null;
  const inv = sale ? await invoiceData({ tenantId: sale.tenantId } as Ctx, id!) : null;
  if (!inv || inv.voided) return new Response("This link has expired or the invoice isn’t available. Ask the pharmacy for a copy.", { status: 404 });
  return new Response(new Uint8Array(await invoicePdf(inv)), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", "Content-Disposition": `inline; filename="${inv.invoiceNo.replace(/[^\w.-]/g, "-")}.pdf"` },
  });
}
