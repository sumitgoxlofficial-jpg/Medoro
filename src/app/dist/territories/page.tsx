import Link from "next/link";
import { requireDistCtx } from "@/domain/distribution/context";
import { listSalesmen, listTerritories } from "@/domain/distribution/masters";
import { db } from "@/server/db";
import { inr } from "@/lib/money";
import { DataTable, PageHead, Panel, Pill } from "../_ui/ui";
import { ActForm, Check, Drawer, F, Grid, S } from "../_ui/forms";
import { saveSalesmanAction, saveTerritoryAction } from "../actions";

export const metadata = { title: "Territories & salesmen" };

export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string; editt?: string }> }) {
  const ctx = await requireDistCtx();
  const sp = await searchParams;
  const [terr, sms, users, chemCount] = await Promise.all([listTerritories(ctx), listSalesmen(ctx), db.user.findMany({ where: { tenantId: ctx.tenantId, active: true }, include: { role: true } }), db.distChemist.groupBy({ by: ["salesmanId"], where: { tenantId: ctx.tenantId }, _count: true })]);
  const e = sms.find((s) => s.id === sp.edit), t = terr.find((x) => x.id === sp.editt);
  return (
    <>
      <PageHead title="Territories & salesmen" sub="Beats and areas, the salesmen covering them, and monthly targets." />
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <Drawer label={t ? `Edit ${t.name}` : "Add territory"} open={!!t}>
            <ActForm action={saveTerritoryAction} submit="Save territory" resetOnOk={!t} key={t?.id ?? "n"}>
              {t ? <input type="hidden" name="id" value={t.id} /> : null}
              <Grid cols={2}>
                <F label="Code" name="code" required defaultValue={t?.code} />
                <F label="Name" name="name" required defaultValue={t?.name} />
                <S label="Part of" name="parentId" defaultValue={t?.parentId ?? ""} options={[{ value: "", label: "—" }, ...terr.filter((x) => x.id !== t?.id).map((x) => ({ value: x.id, label: x.name }))]} />
                <F label="PIN codes" name="pincodes" defaultValue={t?.pincodes.join(", ")} hint="Comma separated" />
              </Grid>
            </ActForm>
          </Drawer>
          <Panel title="Territories" pad={false}>
            <DataTable cols={[{ label: "Code" }, { label: "Name" }, { label: "Part of" }, { label: "PIN codes" }, { label: "" }]}
              rows={terr.map((x) => [x.code, x.name, terr.find((y) => y.id === x.parentId)?.name ?? "—", x.pincodes.slice(0, 6).join(", ") + (x.pincodes.length > 6 ? "…" : ""), <Link key="e" href={`?editt=${x.id}`}>Edit</Link>])} empty="No territories yet." />
          </Panel>
        </div>
        <div>
          <Drawer label={e ? `Edit ${e.name}` : "Add salesman"} open={!!e}>
            <ActForm action={saveSalesmanAction} submit="Save salesman" resetOnOk={!e} key={e?.id ?? "n"}>
              {e ? <input type="hidden" name="id" value={e.id} /> : null}
              <Grid cols={2}>
                <F label="Code" name="code" required defaultValue={e?.code} />
                <F label="Name" name="name" required defaultValue={e?.name} />
                <F label="Mobile" name="phone" defaultValue={e?.phone ?? ""} />
                <S label="Signs in as (field app)" name="userId" defaultValue={e?.userId ?? ""} options={[{ value: "", label: "— not a user" }, ...users.map((u) => ({ value: u.id, label: `${u.name} (${u.role.name})` }))]} />
                <F label="Monthly target ₹" name="monthlyTarget" inputMode="decimal" defaultValue={e ? String(Number(e.monthlyTargetPaise) / 100) : "0"} />
              </Grid>
              <fieldset className="border border-line rounded-md p-2 flex flex-wrap gap-3"><legend className="text-[12px] text-muted px-1">Territories</legend>
                {terr.map((x) => <label key={x.id} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="territoryIds" value={x.id} defaultChecked={e?.territoryIds.includes(x.id)} />{x.name}</label>)}
              </fieldset>
              <Check name="inactive" label="Inactive" defaultChecked={e ? !e.active : false} />
            </ActForm>
          </Drawer>
          <Panel title="Salesmen" pad={false}>
            <DataTable cols={[{ label: "Salesman" }, { label: "Territories" }, { label: "Chemists", num: true }, { label: "Target / month", num: true }, { label: "" }]}
              rows={sms.map((s) => [<span key="n">{s.code} · {s.name} {!s.active ? <Pill>Inactive</Pill> : s.userId ? <Pill tone="blue">Field app</Pill> : null}</span>, s.territoryIds.map((i) => terr.find((x) => x.id === i)?.name).filter(Boolean).join(", ") || "—", chemCount.find((c) => c.salesmanId === s.id)?._count ?? 0, inr(Number(s.monthlyTargetPaise)), <Link key="e" href={`?edit=${s.id}`}>Edit</Link>])} empty="No salesmen yet." />
          </Panel>
        </div>
      </div>
    </>
  );
}
