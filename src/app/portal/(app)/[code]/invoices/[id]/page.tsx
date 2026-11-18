import Link from "next/link";
import { portalInvoice, readPortalAccount } from "@/domain/distribution/portal";
import { InvoiceDoc } from "@/app/dist/_ui/invoice-doc";
import { PrintButton } from "@/app/dist/_ui/print";

export const metadata = { title: "Invoice" };

export default async function Page({ params }: { params: Promise<{ code: string; id: string }> }) {
  const a = (await readPortalAccount())!;
  const { code, id } = await params;
  let v;
  try { v = await portalInvoice(a, code, id); } catch (e) { return <div>{(e as Error).message}</div>; }
  if (!v) return <div>Invoice not found.</div>;
  return (
    <>
      <div className="flex gap-3 items-center mb-3 print:hidden"><Link href={`/portal/${code}/account`} className="text-[13px]">← Dues & invoices</Link><span className="ml-auto"><PrintButton label="Print / save as PDF" /></span></div>
      <InvoiceDoc v={v} />
    </>
  );
}
