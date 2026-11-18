import { requireDistCtx, distView, distCan } from "@/domain/distribution/context";
import { integrationStatus } from "@/domain/distribution/admin";
import { distSettings } from "@/domain/distribution/common";
import { db } from "@/server/db";
import { DataTable, PageHead, Panel, Pill } from "../_ui/ui";
import { ActForm, F, Grid, S } from "../_ui/forms";
import { distSettingsAction } from "../actions";

export const metadata = { title: "Settings" };

const TONE: Record<string, string> = { configured: "green", available: "green", "available (offline)": "blue", manual: "amber", "statement import": "blue", "not configured": "gray" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "users", "integrations");
  const [s, t] = await Promise.all([distSettings(ctx.tenantId), db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } })]);
  return (
    <>
      <PageHead title="Settings & integrations" />
      <div className="grid gap-4 lg:grid-cols-2">
        {distCan(ctx, "users") ? (
          <Panel title="Business rules">
            <ActForm action={distSettingsAction} submit="Save settings">
              <Grid cols={2}>
                <F label="Legal name (on invoices)" name="legalName" defaultValue={t.legalName ?? ""} />
                <F label="Minimum shelf life sent to chemists (days)" name="minShelfDays" type="number" defaultValue={s.minShelfDays} />
                <F label="Purchase cover (days)" name="coverDays" type="number" defaultValue={s.coverDays} />
                <F label="Safety stock (days)" name="safetyDays" type="number" defaultValue={s.safetyDays} />
                <S label="Orders breaking credit rules" name="creditMode" defaultValue={s.creditMode} options={[{ value: "hold", label: "Hold for override approval" }, { value: "block", label: "Block" }]} />
              </Grid>
            </ActForm>
          </Panel>
        ) : null}
        <Panel title="Integrations — real status" pad={false}>
          <DataTable cols={[{ label: "Integration" }, { label: "Status" }, { label: "What it means" }]} rows={integrationStatus().map((i) => [i.name, <Pill key="s" tone={TONE[i.status] ?? "gray"}>{i.status}</Pill>, <span key="d" className="text-[12px]">{i.detail}</span>])} />
        </Panel>
      </div>
    </>
  );
}
