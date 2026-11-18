import { requireDistCtx, distView } from "@/domain/distribution/context";
import { listConnections } from "@/domain/distribution/portal";
import { distSettings, distEnt } from "@/domain/distribution/common";
import { distHas } from "@/domain/distribution/plans";
import { listChemists } from "@/domain/distribution/masters";
import { db } from "@/server/db";
import { DataTable, dateIN, Note, PageHead, Panel, Pill, STATUS_TONE } from "../_ui/ui";
import { ActButton, ActForm, Check, F, Grid, S } from "../_ui/forms";
import { approveConnAction, decideConnAction, portalSettingsAction } from "../actions";

export const metadata = { title: "Chemist portal" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "portal", "masters");
  const [conns, s, chemists, ent, tenant] = await Promise.all([listConnections(ctx), distSettings(ctx.tenantId), listChemists(ctx), distEnt(ctx.tenantId), db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true } })]);
  const p = s.portal;
  return (
    <>
      <PageHead title="Chemist ordering portal" sub={`Chemists sign up at /portal, find you by name or your code ${tenant.code}, and order once you approve them. They see only what you allow below, and only their own orders, invoices and dues.`} />
      {!distHas(ent, "portal") ? <div className="mb-4"><Note tone="amber">The portal is not part of your current plan; approved chemists can’t order until you upgrade.</Note></div> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title="Requests & connected chemists" pad={false}>
          <DataTable cols={[{ label: "Pharmacy" }, { label: "Licence" }, { label: "GSTIN" }, { label: "Contact" }, { label: "Requested" }, { label: "Status" }, { label: "" }]}
            rows={conns.map((c) => [<div key="n"><div className="font-medium">{c.firmName}</div><div className="text-[12px] text-muted">{c.ownerName} · {c.address}, {c.pincode}</div></div>, <span key="l" className="text-[12px]">{c.dl20b} / {c.dl21b}<br />valid to {c.dlExpiry}</span>, c.gstin ?? "—", <span key="c" className="text-[12px]">{c.phone}<br />{c.email}</span>, dateIN(c.requestedAt), <Pill key="s" tone={STATUS_TONE[c.status]}>{c.status}</Pill>,
              c.status === "requested" ? (
                <div key="a" className="flex flex-col gap-1.5 min-w-[240px]">
                  <ActForm action={approveConnAction} submit="Approve">
                    <input type="hidden" name="id" value={c.id} />
                    <S label="Link to existing chemist" name="customerId" options={[{ value: "", label: "— create new from their details" }, ...chemists.filter((x) => !x.portal).map((x) => ({ value: x.id, label: x.name }))]} />
                    <Grid cols={2}><F label="Credit limit ₹" name="creditLimit" defaultValue="0" /><F label="Credit days" name="creditDays" type="number" defaultValue={21} /></Grid>
                  </ActForm>
                  <ActButton size="sm" variant="danger" label="Reject" ask="Reason the chemist will see" action={async (r) => { "use server"; return decideConnAction(c.id, "rejected", r); }} />
                </div>
              ) : c.status === "approved" ? <ActButton key="x" size="sm" variant="danger" label="Suspend" ask="Reason" action={async (r) => { "use server"; return decideConnAction(c.id, "suspended", r); }} /> : c.note ?? ""])} empty="No chemists have asked to connect yet." />
        </Panel>
        <Panel title="What chemists can see">
          <ActForm action={portalSettingsAction} submit="Save portal settings">
            <Check name="enabled" label="Portal ordering on" defaultChecked={p.enabled} />
            <Check name="discoverable" label="List me in distributor search" defaultChecked={p.discoverable} />
            <S label="Stock shown" name="stock" defaultValue={p.stock} options={[{ value: "band", label: "In stock / Low / Out only" }, { value: "exact", label: "Exact packs" }, { value: "none", label: "Hide stock" }]} />
            <Check name="showSchemes" label="Show schemes" defaultChecked={p.showSchemes} />
            <Check name="showMrp" label="Show MRP" defaultChecked={p.showMrp} />
            <F label="Minimum order ₹" name="minOrder" defaultValue={String(p.minOrderPaise / 100)} />
            <F label="Areas served (shown in search)" name="serviceArea" defaultValue={p.serviceArea} />
          </ActForm>
        </Panel>
      </div>
    </>
  );
}
