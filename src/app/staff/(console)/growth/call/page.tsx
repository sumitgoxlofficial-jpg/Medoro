import Link from "next/link";
import { requireGrowth } from "@/staff/growth/access";
import { nextToCall, openCalls } from "@/staff/growth/calls";
import { displayPhone } from "@/staff/growth/normalize";
import { Empty, Panel, btn, btnPrimary } from "../../ui";
import { StageBadge } from "../kit";
import { fmtDT } from "../fmt";

export default async function CallQueue() {
  const a = await requireGrowth("calls.make");
  const [q, open] = await Promise.all([nextToCall(a), openCalls(a)]);
  const first = q.due[0]?.lead ?? q.fresh[0];
  return (
    <>
      {open.length ? (
        <Panel title="Calls waiting for your report" sub="You opened the dialer for these; report each call">
          {open.map((o) => <div key={o.id} className="flex gap-2 items-center px-4 py-2.5 border-t border-[#F1F3F4] text-[13.5px]"><span className="flex-1"><strong>{o.lead.name}</strong> <span className="text-muted">· dialer opened {fmtDT(o.launchedAt.toISOString())}</span></span><Link className={btn} href={`/staff/growth/call/${o.lead.id}`}>Report</Link></div>)}
        </Panel>
      ) : null}
      <Panel title="Next to call" right={first ? <Link className={btnPrimary} href={`/staff/growth/call/${first.id}`}>Start with {first.name}</Link> : null}>
        <div className="px-4 pt-3 text-[12.5px] text-muted font-semibold uppercase tracking-wide">Follow-ups due today and overdue</div>
        {q.due.length ? q.due.map((x) => <Row key={x.followUp.id} id={x.lead.id} name={x.lead.name} phone={x.lead.phone} stage={x.lead.stage} sub={`Due ${fmtDT(x.followUp.dueAt)}${x.followUp.note ? " · " + x.followUp.note : ""}`} />) : <Empty>Nothing due.</Empty>}
        <div className="px-4 pt-3 text-[12.5px] text-muted font-semibold uppercase tracking-wide border-t border-[#EEF0F2]">Not called yet (highest score first)</div>
        {q.fresh.length ? q.fresh.map((l) => <Row key={l.id} id={l.id} name={l.name} phone={l.phone} stage={l.stage} sub={[l.city, l.pin].filter(Boolean).join(" · ")} />) : <Empty>Every assigned lead has been called.</Empty>}
      </Panel>
    </>
  );
}

function Row({ id, name, phone, stage, sub }: { id: string; name: string; phone: string | null; stage: string; sub: string }) {
  return (
    <div className="flex gap-3 items-center px-4 py-2.5 border-t border-[#F1F3F4] text-[13.5px] flex-wrap">
      <div className="flex-1 min-w-[200px]"><strong>{name}</strong> <StageBadge s={stage} /><div className="text-muted text-[12.5px]">{phone ? displayPhone(phone) : "No number"} · {sub}</div></div>
      <Link className={btn} href={`/staff/growth/call/${id}`}>Open</Link>
    </div>
  );
}
