import Link from "next/link";
import { requireDistCtx } from "@/domain/distribution/context";
import { listCompanies, listPrincipals } from "@/domain/distribution/masters";
import { db } from "@/server/db";
import { DataTable, PageHead, Panel, Pill } from "../_ui/ui";
import { ActForm, Check, Drawer, F, Grid, S } from "../_ui/forms";
import { saveCompanyAction, savePrincipalAction, saveSupplierAction } from "../actions";
import { isoOf } from "@/lib/dates";

export const metadata = { title: "Companies & principals" };

export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string; editp?: string }> }) {
  const ctx = await requireDistCtx();
  const sp = await searchParams;
  const [companies, principals, suppliers] = await Promise.all([listCompanies(ctx), listPrincipals(ctx), db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" } })]);
  const e = companies.find((c) => c.id === sp.edit), p = principals.find((x) => x.id === sp.editp);
  return (
    <>
      <PageHead title="Companies, principals & suppliers" sub="Manufacturers you stock, the agreements you hold with them (margins and expiry-return terms) and the parties you buy from." />
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <Drawer label={e ? `Edit ${e.name}` : "Add company / manufacturer"} open={!!e}>
            <ActForm action={saveCompanyAction} submit="Save company" resetOnOk={!e} key={e?.id ?? "n"}>
              {e ? <input type="hidden" name="id" value={e.id} /> : null}
              <Grid cols={2}>
                <F label="Company name" name="name" required defaultValue={e?.name} />
                <F label="Short name (on invoices)" name="shortName" defaultValue={e?.shortName ?? ""} />
                <F label="GSTIN" name="gstin" defaultValue={e?.gstin ?? ""} />
                <F label="Contact person" name="contact" defaultValue={e?.contact ?? ""} />
                <F label="Phone" name="phone" defaultValue={e?.phone ?? ""} />
                <F label="Email" name="email" type="email" defaultValue={e?.email ?? ""} />
              </Grid>
              <Check name="inactive" label="Inactive" defaultChecked={e ? !e.active : false} />
            </ActForm>
          </Drawer>
          <Panel title="Companies" pad={false}>
            <DataTable cols={[{ label: "Company" }, { label: "GSTIN" }, { label: "Products", num: true }, { label: "" }]}
              rows={companies.map((c) => [<span key="n" className="font-medium">{c.name}{c.shortName ? <span className="text-muted font-normal"> ({c.shortName})</span> : null}</span>, c.gstin ?? "—", c.products, <span key="a" className="flex gap-2 justify-end">{!c.active ? <Pill>Inactive</Pill> : null}<Link href={`?edit=${c.id}`}>Edit</Link></span>])} empty="No companies yet." />
          </Panel>
        </div>
        <div>
          <Drawer label={p ? `Edit principal ${p.company}` : "Add principal (stockist agreement)"} open={!!p}>
            <ActForm action={savePrincipalAction} submit="Save principal" resetOnOk={!p} key={p?.id ?? "n"}>
              {p ? <input type="hidden" name="id" value={p.id} /> : null}
              <Grid cols={2}>
                <S label="Company" name="companyId" defaultValue={p?.companyId} options={companies.map((c) => ({ value: c.id, label: c.name }))} />
                <S label="Buy from (supplier / C&F)" name="supplierId" defaultValue={p?.supplierId ?? ""} options={[{ value: "", label: "—" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
                <F label="Agreement no." name="agreementNo" defaultValue={p?.agreementNo ?? ""} />
                <F label="Divisions (comma separated)" name="divisions" defaultValue={p?.divisions.join(", ") ?? ""} />
                <F label="Agreement from" name="startDate" type="date" defaultValue={p?.startDate ? isoOf(p.startDate) : ""} />
                <F label="Agreement to" name="endDate" type="date" defaultValue={p?.endDate ? isoOf(p.endDate) : ""} />
                <F label="Distributor margin %" name="marginPct" inputMode="decimal" defaultValue={String(p?.marginPct ?? 10)} />
                <F label="Claim credit % of purchase" name="claimCreditPct" inputMode="decimal" defaultValue={String(p?.claimCreditPct ?? 100)} />
                <F label="Expiry returns open (days before expiry)" name="claimBeforeDays" type="number" defaultValue={p?.claimBeforeDays ?? 90} />
                <F label="Accepted until (days after expiry)" name="claimAfterDays" type="number" defaultValue={p?.claimAfterDays ?? 180} />
              </Grid>
              <Check name="inactive" label="Inactive" defaultChecked={p ? !p.active : false} />
            </ActForm>
          </Drawer>
          <Panel title="Principals" pad={false}>
            <DataTable cols={[{ label: "Company" }, { label: "Supplier" }, { label: "Margin", num: true }, { label: "Expiry claims" }, { label: "" }]}
              rows={principals.map((x) => [x.company, x.supplier ?? <Pill key="s" tone="amber">No supplier</Pill>, `${x.marginPct}%`, `${x.claimBeforeDays}d before → ${x.claimAfterDays}d after · ${x.claimCreditPct}%`, <Link key="e" href={`?editp=${x.id}`}>Edit</Link>])} empty="No principals yet." />
          </Panel>
        </div>
      </div>
      <div className="mt-4">
        <Drawer label="Add supplier">
          <ActForm action={saveSupplierAction} submit="Save supplier" resetOnOk>
            <Grid cols={4}>
              <F label="Supplier name" name="name" required />
              <F label="GSTIN" name="gstin" />
              <F label="Phone" name="phone" />
              <F label="Credit days" name="creditDays" type="number" defaultValue={30} />
              <F label="Lead time (days)" name="leadDays" type="number" defaultValue={2} />
              <F label="Return window (days before expiry)" name="returnWindowDays" type="number" defaultValue={90} />
              <F label="Opening balance ₹ (we owe)" name="opening" defaultValue="0" />
            </Grid>
            <Check name="acceptsReturns" label="Accepts expiry returns" defaultChecked />
          </ActForm>
        </Drawer>
        <Panel title="Suppliers" pad={false}>
          <DataTable dense cols={[{ label: "Supplier" }, { label: "GSTIN" }, { label: "Credit days", num: true }, { label: "Lead days", num: true }, { label: "Returns" }]}
            rows={suppliers.map((s) => [s.name, s.gstin ?? "—", s.creditDays, String(s.leadDays), s.acceptsReturns ? "Accepted" : "Not accepted"])} empty="No suppliers yet." />
        </Panel>
      </div>
    </>
  );
}
