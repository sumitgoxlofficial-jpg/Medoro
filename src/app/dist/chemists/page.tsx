import Link from "next/link";
import { requireDistCtx } from "@/domain/distribution/context";
import { listChemists, listSalesmen, listTerritories } from "@/domain/distribution/masters";
import { GST_STATES } from "@/domain/accounting/gst";
import { inr } from "@/lib/money";
import { DataTable, PageHead, Panel, Pill, STATUS_TONE } from "../_ui/ui";
import { ActForm, Drawer, F, Grid, S } from "../_ui/forms";
import { saveChemistAction } from "../actions";
import { todayISO } from "@/lib/dates";

export const metadata = { title: "Chemists" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; status?: string }> }) {
  const ctx = await requireDistCtx();
  const sp = await searchParams;
  const [rows, terr, sms] = await Promise.all([listChemists(ctx, { q: sp.q, status: sp.status }), listTerritories(ctx), listSalesmen(ctx)]);
  const e = sp.edit ? (await listChemists(ctx)).find((c) => c.id === sp.edit) : undefined;
  return (
    <>
      <PageHead title="Chemists & retailers" sub="Drug licences, GST, credit terms, territory and salesman. Orders are refused for expired licences." />
      <Drawer label={e ? `Edit ${e.name}` : "Add chemist"} open={!!e}>
        <ActForm action={saveChemistAction} submit={e ? "Save changes" : "Add chemist"} resetOnOk={!e} key={e?.id ?? "new"}>
          {e ? <><input type="hidden" name="id" value={e.id} /><input type="hidden" name="version" value={e.version} /></> : null}
          <Grid cols={4}>
            <F label="Firm name" name="name" required defaultValue={e?.name} className="sm:col-span-2" />
            <F label="Owner / pharmacist" name="ownerName" defaultValue={e?.ownerName ?? ""} />
            <F label="Mobile" name="phone" inputMode="tel" defaultValue={e?.phone ?? ""} />
            <F label="GSTIN" name="gstin" defaultValue={e?.gstin ?? ""} hint="Leave blank for unregistered (B2C)" />
            <S label="State" name="stateCode" defaultValue={e?.stateCode ?? ""} options={[{ value: "", label: "Same as godown" }, ...GST_STATES.map(([c, n]) => ({ value: c, label: `${c} ${n}` }))]} />
            <F label="Address" name="address" defaultValue={e?.address ?? ""} className="sm:col-span-2" />
            <F label="PIN code" name="pincode" inputMode="numeric" defaultValue={e?.pincode ?? ""} />
            <F label="Drug licence (Form 20B)" name="dl20b" required defaultValue={e?.dl20b ?? ""} />
            <F label="Drug licence (Form 21B)" name="dl21b" required defaultValue={e?.dl21b ?? ""} />
            <F label="Licence valid until" name="dlExpiry" type="date" required min={todayISO()} defaultValue={e?.dlExpiry ?? ""} />
            <F label="Credit limit ₹" name="creditLimit" inputMode="decimal" defaultValue={e ? String(e.creditLimit / 100) : "0"} hint="0 = cash / advance only" />
            <F label="Credit days" name="creditDays" type="number" min={0} defaultValue={e?.creditDays ?? 21} />
            <F label="Grace days" name="graceDays" type="number" min={0} defaultValue={e?.graceDays ?? 7} />
            <S label="Price tier" name="priceTier" defaultValue={e?.priceTier ?? "ptr"} options={[{ value: "ptr", label: "PTR (retailer)" }, { value: "pts", label: "PTS (stockist / sub-distributor)" }]} />
            <S label="Territory" name="territoryId" defaultValue={e?.territoryId ?? ""} options={[{ value: "", label: "—" }, ...terr.map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }))]} />
            <S label="Salesman" name="salesmanId" defaultValue={e?.salesmanId ?? ""} options={[{ value: "", label: "—" }, ...sms.map((s) => ({ value: s.id, label: s.name }))]} />
            {!e ? <F label="Opening balance ₹" name="opening" inputMode="decimal" defaultValue="0" hint="Amount the chemist owes today" /> : null}
          </Grid>
        </ActForm>
      </Drawer>
      <Panel pad={false} title={`${rows.length} chemists`} right={
        <form className="flex gap-2"><input data-search name="q" defaultValue={sp.q} placeholder="Search name, mobile, GSTIN" className="h-8 w-[220px] rounded-md border border-input px-2 text-[13px]" />
          <select name="status" defaultValue={sp.status ?? ""} className="h-8 rounded-md border border-input px-1 text-[13px]"><option value="">All</option><option value="active">Active</option><option value="hold">On hold</option><option value="blocked">Blocked</option></select></form>}>
        <DataTable cols={[{ label: "Chemist" }, { label: "Licence" }, { label: "GSTIN" }, { label: "Territory / salesman" }, { label: "Limit", num: true }, { label: "Terms", num: true }, { label: "Status" }, { label: "" }]}
          rows={rows.map((c) => {
            const expired = c.dlExpiry && c.dlExpiry < todayISO();
            return [
              <div key="n"><Link href={`/dist/chemists/${c.id}`} className="font-medium">{c.name}</Link><div className="text-[12px] text-muted">{[c.ownerName, c.phone, c.pincode].filter(Boolean).join(" · ")}</div></div>,
              <div key="l" className="text-[12px]"><div>{c.dl20b} / {c.dl21b}</div><div className={expired ? "text-[#B3261E] font-semibold" : "text-muted"}>{expired ? "Expired " : "Valid to "}{c.dlExpiry}{c.kycVerified ? " · verified" : ""}</div></div>,
              c.gstin ?? <span className="text-muted">Unregistered</span>, [c.territory, c.salesman].filter(Boolean).join(" · ") || "—", inr(c.creditLimit), `${c.creditDays} d`,
              <span key="s" className="flex gap-1">{<Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>}{c.portal ? <Pill tone="blue">Portal</Pill> : null}</span>,
              <Link key="e" href={`?edit=${c.id}`}>Edit</Link>,
            ];
          })} empty="No chemists yet. Add one above, or approve portal sign-ups under Chemist portal." />
      </Panel>
    </>
  );
}
