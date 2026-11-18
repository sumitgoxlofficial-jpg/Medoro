import { requireDistCtx, distView } from "@/domain/distribution/context";
import { collectionsOn } from "@/domain/distribution/dispatch";
import { listCheques } from "@/domain/parties/cheques";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { DataTable, dateIN, PageHead, Panel, Pill, STATUS_TONE } from "../_ui/ui";
import { ActButton, ActForm, F, Grid, S } from "../_ui/forms";
import { chequeAction, collectAction } from "../actions";
import { entryChemists } from "../_lib/data";

export const metadata = { title: "Collections" };

export default async function Page({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "payments");
  const day = (await searchParams).day ?? todayISO();
  const [rows, chemists, cheques] = await Promise.all([collectionsOn(ctx, day), entryChemists(ctx, { salesmanOnly: !ctx.perms.includes("approve") }), listCheques(ctx, { open: true }).catch(() => [])]);
  return (
    <>
      <PageHead title="Payment collection" sub="Receipts from chemists (cash, UPI, NEFT, cheque). Bills are settled oldest first; cheques clear through Cheques in hand." />
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Panel title="Record a payment">
          <ActForm action={collectAction} submit="Post receipt" resetOnOk>
            <S label="Chemist" name="customerId" options={[{ value: "", label: "Choose…" }, ...chemists.filter((c) => c.balance > 0).map((c) => ({ value: c.id, label: `${c.name} · due ${inr(c.balance)}` }))]} />
            <Grid cols={2}>
              <F label="Amount ₹" name="amount" inputMode="decimal" required />
              <S label="Mode" name="method" options={["Cash", "UPI", "Bank transfer (NEFT)", "Cheque"].map((m) => ({ value: m, label: m }))} />
            </Grid>
            <F label="UTR / reference" name="ref" />
            <Grid cols={3}>
              <F label="Cheque no." name="chequeNo" inputMode="numeric" />
              <F label="Bank" name="bank" />
              <F label="Cheque date" name="chequeDate" type="date" />
            </Grid>
          </ActForm>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={`Collections on ${dateIN(day)}`} pad={false} right={<form><input type="date" name="day" defaultValue={day} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12px]" /><button className="h-8 px-2 ml-1 border border-[#C9D2DE] rounded text-[12px]">Show</button></form>}>
            <DataTable cols={[{ label: "Receipt" }, { label: "Chemist" }, { label: "Mode" }, { label: "Ref" }, { label: "By" }, { label: "Amount", num: true }]}
              rows={rows.map((r) => [r.voucherNo, r.customer, r.mode, r.ref ?? "", r.salesman ?? (r.deliveryId ? "Delivery" : "Office"), inr(r.amount)])} footer={["Total", "", "", "", "", inr(rows.reduce((a, r) => a + r.amount, 0))]} empty="No collections on this day." />
          </Panel>
          <Panel title="Cheques in hand" pad={false}>
            <DataTable dense cols={[{ label: "Cheque" }, { label: "Bank" }, { label: "Dated" }, { label: "Amount", num: true }, { label: "Status" }, { label: "" }]}
              rows={cheques.filter((c) => c.direction === "received").map((c) => [c.no, c.bank, dateIN(c.date), inr(c.amount), <Pill key="s" tone={STATUS_TONE[c.status] ?? "amber"}>{c.status}</Pill>,
                <span key="a" className="flex gap-1 justify-end">{c.status === "pending" ? <ActButton size="sm" label="Deposited" action={async () => { "use server"; return chequeAction(c.id, "deposit", ""); }} /> : null}{c.status === "deposited" ? <><ActButton size="sm" label="Cleared" action={async () => { "use server"; return chequeAction(c.id, "clear", ""); }} /><ActButton size="sm" variant="danger" label="Bounced" ask="Bank's reason" action={async (r) => { "use server"; return chequeAction(c.id, "bounce", r); }} /></> : null}</span>])} empty="No cheques waiting." />
          </Panel>
        </div>
      </div>
    </>
  );
}
