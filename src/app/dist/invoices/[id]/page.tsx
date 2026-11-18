import { notFound } from "next/navigation";
import Link from "next/link";
import { requireDistCtx, distCan, distView } from "@/domain/distribution/context";
import { invoiceView } from "@/domain/distribution/billing";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { PageHead, Panel } from "../../_ui/ui";
import { ActButton } from "../../_ui/forms";
import { InvoiceDoc } from "../../_ui/invoice-doc";
import { ReturnForm } from "../../_ui/return-form";
import { PrintButton } from "../../_ui/print";
import { cancelInvoiceAction } from "../../actions";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "bill", "reports", "payments", "dispatch", "delivery");
  const { id } = await params;
  const v = await invoiceView(ctx.tenantId, id);
  if (!v) notFound();
  return (
    <>
      <div className="print:hidden">
        <PageHead title={`Invoice ${v.no}`} back={{ href: "/dist/invoices", label: "Invoices" }} sub={`${v.buyer.name} · ${inr(v.total)}`}
          actions={<>
            <PrintButton />
            <Link href={`/dist/chemists/${v.buyer.id}`} className="h-[36px] inline-flex items-center px-3 border border-[#C9D2DE] rounded-lg text-[13px] font-semibold">Chemist ledger</Link>
            {!v.cancelled && v.date === todayISO() && distCan(ctx, "cancelBill") && !v.returns.length ? <ActButton variant="danger" label="Cancel invoice" ask="Reason for cancelling (audited)" confirm="Cancel this invoice and put the stock back?" action={async (r) => { "use server"; return cancelInvoiceAction(id, r); }} /> : null}
          </>} />
      </div>
      <InvoiceDoc v={v} />
      <div className="print:hidden grid gap-4 lg:grid-cols-2 mt-4">
        {v.returns.length ? <Panel title="Credit notes against this invoice"><ul className="m-0 pl-4 text-[13px]">{v.returns.map((r) => <li key={r.id}>{r.no} · {inr(r.total)}</li>)}</ul></Panel> : null}
        {!v.cancelled && distCan(ctx, "bill") ? (
          <Panel title="Sales return / credit note" sub="Saleable goods go back to stock; expired or damaged goods go to claims.">
            <ReturnForm invoiceId={v.id} lines={v.lines.map((l) => ({ id: l.id, name: l.name, batchNo: l.batchNo, qty: l.qty, freeQty: l.freeQty, returned: l.returned, taxable: l.taxable, tax: l.tax }))} />
          </Panel>
        ) : null}
      </div>
    </>
  );
}
