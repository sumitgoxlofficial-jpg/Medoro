import { requireDistCtx, distView } from "@/domain/distribution/context";
import { planView } from "@/domain/distribution/admin";
import { accessFor } from "@/domain/system/access";
import { inr } from "@/lib/money";
import { dateIN, PageHead, Panel, Pill, Stat } from "../_ui/ui";

export const metadata = { title: "Subscription" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "users");
  const [v, access] = await Promise.all([planView(ctx), accessFor(ctx.tenantId)]);
  const lim = (n: number) => (Number.isFinite(n) ? String(n) : "Unlimited");
  return (
    <>
      <PageHead title="Subscription & licensing" sub="Plans are enforced on the server. Licences are signed by the MEDORO licence server (Ed25519); with none configured this copy is unlicensed and not limited." />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <Stat label="Plan" value={v.meta?.plan ?? "—"} note={v.ent.open ? `Everything open (${v.ent.open})` : undefined} />
        <Stat label="Status" value={access.phase} note={access.endsOn ? `until ${dateIN(access.endsOn)}` : undefined} tone={access.readOnly ? "red" : "navy"} />
        <Stat label="Godowns used" value={`${v.used.godowns} / ${lim(v.ent.limits.godowns)}`} />
        <Stat label="Users / chemists" value={`${v.used.users} / ${lim(v.ent.limits.users)}`} note={`${v.used.chemists} / ${lim(v.ent.limits.chemists)} chemists`} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(v.plans).map(([id, p]) => (
          <Panel key={id} title={p.name} right={v.ent.plan === id ? <Pill tone="green">Current</Pill> : null}>
            <div className="text-[22px] font-semibold">{inr(p.priceMonthly)}<span className="text-[13px] font-normal text-muted"> / month + GST</span></div>
            <ul className="text-[13px] mt-2 pl-4">
              <li>{p.limits.godowns} godown(s), {p.limits.users} users, {p.limits.chemists.toLocaleString("en-IN")} chemists</li>
              {Object.entries(v.features).map(([f, label]) => <li key={f} className={p.features.includes(f as never) ? "" : "text-faint line-through"}>{label}</li>)}
            </ul>
          </Panel>
        ))}
      </div>
      <p className="text-[12.5px] text-muted mt-4">To change plan or pay, contact MEDORO sales; payment reporting and invoices use the same licence server as MEDORO Pharmacy. Prices shown are list prices configured in this build.</p>
    </>
  );
}
