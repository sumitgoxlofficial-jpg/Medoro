import Link from "next/link";
import { portalCatalogue, portalLink, portalOrders, readPortalAccount } from "@/domain/distribution/portal";
import { Shop } from "../../_cart";

export const metadata = { title: "Order" };

export default async function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ q?: string; repeat?: string }> }) {
  const a = (await readPortalAccount())!;
  const { code } = await params;
  const sp = await searchParams;
  let link;
  try { link = await portalLink(a, code); } catch (e) { return <div className="bg-white border border-[#E3E7ED] rounded-xl p-6">{(e as Error).message} <Link href="/portal">Back</Link></div>; }
  const items = await portalCatalogue(a, code, sp.q ?? "", 120);
  const preset = sp.repeat ? ((await portalOrders(a, code)).find((o) => o.id === sp.repeat)?.lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty })) ?? []) : [];
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex-1"><Link href="/portal" className="text-[13px]">← My distributors</Link><h1 className="text-[22px] font-semibold m-0">{link.tenant.name}</h1></div>
        <Link href={`/portal/${code}/orders`} className="text-[14px] font-semibold">My orders</Link>
        <Link href={`/portal/${code}/account`} className="text-[14px] font-semibold">Dues & invoices</Link>
      </div>
      <form className="mb-3"><input name="q" defaultValue={sp.q} placeholder="Search medicine or composition" className="h-11 w-full rounded-lg border border-[#C9D2DE] px-3 text-[15px]" /></form>
      <Shop code={code} items={items} preset={preset} />
    </>
  );
}
