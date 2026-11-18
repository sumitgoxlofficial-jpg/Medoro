import Link from "next/link";
import { requireDistCtx, distCan } from "@/domain/distribution/context";
import { listGodowns, listProducts, listRacks } from "@/domain/distribution/masters";
import { inr } from "@/lib/money";
import { DataTable, PageHead, Panel, Pill } from "../_ui/ui";
import { ActForm, Check, Drawer, F, Grid, S } from "../_ui/forms";
import { placeOnRackAction, saveGodownAction, saveRackAction } from "../actions";

export const metadata = { title: "Godowns & racks" };

export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireDistCtx();
  const sp = await searchParams;
  const [godowns, racks, products] = await Promise.all([listGodowns(ctx), listRacks(ctx, ctx.branchId), listProducts(ctx, { take: 3000 })]);
  const e = godowns.find((g) => g.id === sp.edit);
  return (
    <>
      <PageHead title="Godowns & racks" sub={`Racks shown for ${ctx.branchName}. Switch godown at the top to manage another.`} />
      {distCan(ctx, "users") ? (
        <Drawer label={e ? `Edit ${e.name}` : "Add godown"} open={!!e}>
          <ActForm action={saveGodownAction} submit="Save godown" resetOnOk={!e} key={e?.id ?? "n"}>
            {e ? <input type="hidden" name="id" value={e.id} /> : null}
            <Grid cols={4}>
              <F label="Name" name="name" required defaultValue={e?.name} />
              <F label="Code (invoice series)" name="code" required defaultValue={e?.code} hint="2–6 letters / digits" />
              <F label="GSTIN" name="gstin" defaultValue={e?.gstin ?? ""} />
              <F label="Wholesale drug licence" name="drugLicence" defaultValue={e?.drugLicence ?? ""} />
              <F label="Address" name="address" defaultValue={e?.address ?? ""} className="sm:col-span-4" />
            </Grid>
          </ActForm>
        </Drawer>
      ) : null}
      <Panel title="Godowns" pad={false} className="mb-4">
        <DataTable cols={[{ label: "Godown" }, { label: "GSTIN / licence" }, { label: "Racks", num: true }, { label: "Stock at cost", num: true }, { label: "" }]}
          rows={godowns.map((g) => [<span key="n" className="font-medium">{g.code} · {g.name} {g.id === ctx.branchId ? <Pill tone="blue">Current</Pill> : null}</span>, [g.gstin, g.drugLicence].filter(Boolean).join(" · ") || "—", g.racks, inr(g.stockValue), distCan(ctx, "users") ? <Link key="e" href={`?edit=${g.id}`}>Edit</Link> : ""])} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Racks in ${ctx.branchName}`}>
          <ActForm action={saveRackAction} submit="Save rack" resetOnOk inline>
            <input type="hidden" name="branchId" value={ctx.branchId} />
            <F label="Rack code" name="code" required placeholder="A-01-3" className="w-[120px]" />
            <F label="Zone" name="zone" placeholder="Fast movers" className="w-[140px]" />
            <F label="Pick order" name="seq" type="number" defaultValue={racks.length + 1} className="w-[90px]" />
            <div className="pb-2"><Check name="coldChain" label="Cold chain" /></div>
          </ActForm>
          <div className="mt-3 -mx-4 -mb-4"><DataTable dense cols={[{ label: "Rack" }, { label: "Zone" }, { label: "Pick order", num: true }, { label: "Products", num: true }]} rows={racks.map((r) => [<span key="r">{r.code} {r.coldChain ? <Pill tone="blue">2–8°C</Pill> : null}</span>, r.zone ?? "—", r.seq, r.products])} empty="No racks yet." /></div>
        </Panel>
        <Panel title="Place a product on a rack">
          <ActForm action={placeOnRackAction} submit="Place" resetOnOk>
            <input type="hidden" name="branchId" value={ctx.branchId} />
            <Grid cols={2}>
              <S label="Product" name="medicineId" options={products.map((p) => ({ value: p.id, label: p.name }))} />
              <S label="Rack" name="rack" options={racks.map((r) => ({ value: r.code, label: `${r.code}${r.zone ? " · " + r.zone : ""}` }))} />
            </Grid>
          </ActForm>
          <p className="text-[12.5px] text-[#5B6B82] mt-3">Pick lists are walked in rack pick order, so pickers never double back.</p>
        </Panel>
      </div>
    </>
  );
}
