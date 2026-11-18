import Link from "next/link";
import { requireDistCtx } from "@/domain/distribution/context";
import { listCompanies, listProducts } from "@/domain/distribution/masters";
import { inr } from "@/lib/money";
import { DataTable, PageHead, Panel, Pill } from "../_ui/ui";
import { ActForm, Check, Drawer, F, Grid, S } from "../_ui/forms";
import { saveProductAction } from "../actions";
import { retailerMarginPct } from "@/domain/distribution/rules/pricing";

export const metadata = { title: "Products" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; company?: string }> }) {
  const ctx = await requireDistCtx();
  const sp = await searchParams;
  const [rows, companies] = await Promise.all([listProducts(ctx, { q: sp.q, companyId: sp.company }), listCompanies(ctx)]);
  const e = sp.edit ? (await listProducts(ctx, { take: 5000 })).find((p) => p.id === sp.edit) : undefined;
  const rup = (p?: number) => (p ? (p / 100).toFixed(2) : "");
  return (
    <>
      <PageHead title="Product & medicine catalogue" sub="Wholesale rates (PTR / PTS), GST, packs and portal visibility. Stock is batch-wise under Stock." />
      <Drawer label={e ? `Edit ${e.name}` : "Add product"} open={!!e}>
        <ActForm action={saveProductAction} submit={e ? "Save changes" : "Add product"} resetOnOk={!e} key={e?.id ?? "new"}>
          {e ? <><input type="hidden" name="id" value={e.id} /><input type="hidden" name="version" value={e.version} /></> : null}
          <Grid cols={4}>
            <F label="Product name" name="name" required defaultValue={e?.name} className="sm:col-span-2" />
            <F label="Generic / composition" name="generic" defaultValue={e?.generic} className="sm:col-span-2" />
            <F label="Strength" name="strength" defaultValue={e?.strength} />
            <F label="Form" name="form" required placeholder="Tablet" defaultValue={e?.form} />
            <F label="Pack" name="pack" required placeholder="10 tabs" defaultValue={e?.pack} />
            <S label="Company" name="companyId" defaultValue={e?.companyId ?? ""} options={[{ value: "", label: "—" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} />
            <F label="Division" name="division" defaultValue={e?.division ?? ""} />
            <F label="HSN" name="hsn" required defaultValue={e?.hsn ?? "3004"} inputMode="numeric" />
            <S label="GST %" name="gstRate" defaultValue={String(e?.gstRate ?? 12)} options={["0", "5", "12", "18", "28"].map((v) => ({ value: v, label: v + "%" }))} />
            <S label="Schedule" name="schedule" defaultValue={e?.schedule ?? ""} options={["", "H", "H1", "X", "G"].map((v) => ({ value: v, label: v || "None" }))} />
            <F label="MRP ₹ (incl. GST)" name="mrp" required inputMode="decimal" defaultValue={rup(e?.mrp)} />
            <F label="PTR ₹ (ex-GST)" name="ptr" required inputMode="decimal" defaultValue={rup(e?.ptr)} hint="Price to retailer" />
            <F label="PTS ₹ (ex-GST)" name="pts" inputMode="decimal" defaultValue={rup(e?.pts)} hint="Price to stockist" />
            <F label="Barcode" name="barcode" defaultValue={e?.barcode ?? ""} />
            <F label="Units per pack" name="packSize" type="number" min={1} defaultValue={e?.packSize ?? 1} hint="1 = stock kept in packs" />
            <F label="Packs per case" name="caseSize" type="number" min={1} defaultValue={e?.caseSize ?? 1} />
            <F label="Minimum order (packs)" name="minOrderQty" type="number" min={1} defaultValue={e?.minOrderQty ?? 1} />
            <F label="Reorder level (packs)" name="reorderLevel" type="number" min={0} defaultValue={e?.reorderLevel ?? 0} />
          </Grid>
          <div className="flex gap-5 flex-wrap"><Check name="portalVisible" label="Show on chemist portal" defaultChecked={e?.portalVisible ?? true} /><Check name="discontinued" label="Discontinued" defaultChecked={e?.discontinued} /></div>
        </ActForm>
      </Drawer>
      <Panel pad={false} title={`${rows.length} products`} right={
        <form className="flex gap-2"><input data-search name="q" defaultValue={sp.q} placeholder="Search name, generic, barcode  ( / )" className="h-8 w-[240px] max-w-full rounded-md border border-input px-2 text-[13px]" />
          <select name="company" defaultValue={sp.company ?? ""} className="h-8 rounded-md border border-input px-1 text-[13px]"><option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></form>}>
        <DataTable cols={[{ label: "Product" }, { label: "Company" }, { label: "HSN / GST" }, { label: "MRP", num: true }, { label: "PTR", num: true }, { label: "PTS", num: true }, { label: "Retail margin", num: true }, { label: "Stock (packs)", num: true }, { label: "" }]}
          rows={rows.map((p) => [
            <div key="n"><div className="font-medium">{p.name}</div><div className="text-[12px] text-muted">{[p.generic !== p.name ? p.generic : "", p.pack].filter(Boolean).join(" · ")}</div></div>,
            p.company || "—", `${p.hsn} · ${p.gstRate}%`, inr(p.mrp), p.distReady ? inr(p.ptr) : <Pill key="x" tone="amber">Set PTR</Pill>, p.pts ? inr(p.pts) : "—",
            p.ptr ? `${retailerMarginPct(p.mrp, p.ptr, p.gstRate)}%` : "—", Math.floor(p.stockUnits / Math.max(1, p.packSize)),
            <span key="a" className="flex gap-2 items-center justify-end">{p.discontinued ? <Pill tone="gray">Discontinued</Pill> : !p.portalVisible ? <Pill tone="gray">Hidden</Pill> : null}<Link href={`?edit=${p.id}`}>Edit</Link></span>,
          ])} empty="No products yet. Add your first product above." />
      </Panel>
    </>
  );
}
