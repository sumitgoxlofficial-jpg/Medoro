import Link from "next/link";
import { requireDistCtx } from "@/domain/distribution/context";
import { listCompanies, listProducts, listSchemes } from "@/domain/distribution/masters";
import { addDays, todayISO } from "@/lib/dates";
import { DataTable, PageHead, Panel, Pill } from "../_ui/ui";
import { ActButton, ActForm, Check, Drawer, F, Grid, S } from "../_ui/forms";
import { endSchemeAction, saveSchemeAction } from "../actions";

export const metadata = { title: "Schemes" };

export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireDistCtx();
  const sp = await searchParams;
  const [rows, products, companies] = await Promise.all([listSchemes(ctx), listProducts(ctx, { take: 3000 }), listCompanies(ctx)]);
  const e = rows.find((s) => s.id === sp.edit);
  const today = todayISO();
  return (
    <>
      <PageHead title="Free & discount schemes" sub="Buy X get Y free, or an extra discount, on a product or a whole company. The best scheme for the chemist applies automatically on orders and invoices." />
      <Drawer label={e ? `Edit ${e.code}` : "New scheme"} open={!!e}>
        <ActForm action={saveSchemeAction} submit="Save scheme" resetOnOk={!e} key={e?.id ?? "n"}>
          {e ? <input type="hidden" name="id" value={e.id} /> : null}
          <Grid cols={4}>
            <F label="Code" name="code" required defaultValue={e?.code} />
            <F label="Name" name="name" required defaultValue={e?.name} className="sm:col-span-2" />
            <S label="Type" name="kind" defaultValue={e?.kind ?? "free"} options={[{ value: "free", label: "Free goods (buy X get Y)" }, { value: "discount", label: "Extra discount %" }]} />
            <S label="Product" name="medicineId" defaultValue={e?.medicineId ?? ""} options={[{ value: "", label: "— (use company)" }, ...products.filter((p) => p.distReady).map((p) => ({ value: p.id, label: p.name }))]} className="sm:col-span-2" />
            <S label="…or every product of company" name="companyId" defaultValue={e?.companyId ?? ""} options={[{ value: "", label: "—" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} className="sm:col-span-2" />
            <F label="Buy (packs)" name="buyQty" type="number" min={0} defaultValue={e?.buyQty ?? 10} />
            <F label="Free (packs)" name="freeQty" type="number" min={0} defaultValue={e?.freeQty ?? 1} />
            <F label="Discount %" name="discPct" inputMode="decimal" defaultValue={String(e?.discPct ?? 0)} />
            <F label="Minimum quantity" name="minQty" type="number" min={1} defaultValue={e?.minQty ?? 1} />
            <F label="Valid from" name="validFrom" type="date" required defaultValue={e?.validFrom ?? today} />
            <F label="Valid to" name="validTo" type="date" required defaultValue={e?.validTo ?? addDays(today, 30)} />
          </Grid>
          <Check name="portal" label="Show to chemists on the portal" defaultChecked={e?.portal ?? true} />
        </ActForm>
      </Drawer>
      <Panel pad={false} title={`${rows.length} schemes`}>
        <DataTable cols={[{ label: "Scheme" }, { label: "Applies to" }, { label: "Offer" }, { label: "Min qty", num: true }, { label: "Valid" }, { label: "Status" }, { label: "" }]}
          rows={rows.map((s) => {
            const live = s.active && s.validFrom <= today && s.validTo >= today;
            const end = endSchemeAction.bind(null, s.id);
            return [<span key="c" className="font-medium">{s.code} <span className="font-normal text-[#5B6B82]">{s.name}</span></span>, s.target, s.kind === "free" ? `${s.buyQty} + ${s.freeQty} free` : `${s.discPct}% off`, s.minQty, `${s.validFrom} → ${s.validTo}`,
              <Pill key="p" tone={live ? "green" : s.active && s.validFrom > today ? "blue" : "gray"}>{live ? "Running" : s.active && s.validFrom > today ? "Upcoming" : "Ended"}</Pill>,
              <span key="a" className="flex gap-2 justify-end"><Link href={`?edit=${s.id}`}>Edit</Link>{s.active ? <ActButton size="sm" label="End" confirm="End this scheme now?" action={async () => { "use server"; return end(); }} /> : null}</span>];
          })} empty="No schemes yet." />
      </Panel>
    </>
  );
}
