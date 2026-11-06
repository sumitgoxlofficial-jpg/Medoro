"use client";
import Link from "next/link";
import { VERIFICATION_LABEL } from "@/staff/growth/constants";
import { displayPhone } from "@/staff/growth/normalize";
import { checkWebsite, dismissDuplicate, mergeDuplicate } from "../../../growth-actions";
import { Empty, Kpi, Panel, btn, td, th, useRun } from "../../ui";
import { LeadLink, ScoreChip, VerifyBadge } from "../kit";

type L = { id: string; code: string; name: string; phone: string | null; phoneRaw: string; email: string; website: string; address: string; city: string; pin: string; state: string; verification: string; score: number; sourceUrl: string; createdAt: string };
type Q = { unverified: L[]; duplicates: { id: string; reason: string; score: number; lead: L; match: L }[]; counts: Record<string, number> };

export function VerificationView({ q }: { q: Q }) {
  const { run, busy } = useRun();
  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[1000px]:grid-cols-4">
        {["UNVERIFIED", "PARTIALLY_VERIFIED", "INVALID", "DUPLICATE"].map((k) => <Kpi key={k} l={VERIFICATION_LABEL[k]} v={String(q.counts[k] ?? 0)} />)}
      </div>
      <Panel title="Duplicate review" sub="Nothing is merged automatically. Keep one record (the other stays as history) or mark them as different pharmacies.">
        {q.duplicates.length ? q.duplicates.map((d) => (
          <div key={d.id} className="border-t border-[#F1F3F4] p-4 flex flex-col gap-2">
            <div className="text-[13px] font-semibold text-[#94570A]">{d.reason}</div>
            <div className="grid gap-3 min-[900px]:grid-cols-2">
              {[d.match, d.lead].map((x, i) => (
                <div key={x.id} className="border border-[#E6E8EB] rounded-lg p-3 text-[13px] flex flex-col gap-1">
                  <span className="text-muted text-[11.5px]">{i === 0 ? "Existing record" : "Newer record"}</span>
                  <LeadLink id={x.id} name={x.name} code={x.code} />
                  <span>{x.phone ? displayPhone(x.phone) : x.phoneRaw || "No phone"} · {x.email || "no email"} · {x.website || "no website"}</span>
                  <span className="text-muted">{[x.address, x.city, x.state, x.pin].filter(Boolean).join(", ")}</span>
                  <span><VerifyBadge v={x.verification} /> · score <ScoreChip n={x.score} /></span>
                  <button className={btn + " self-start mt-1"} disabled={busy} onClick={() => run(() => mergeDuplicate(d.id, x.id))}>Keep this one</button>
                </div>
              ))}
            </div>
            <button className={btn + " self-start"} disabled={busy} onClick={() => run(() => dismissDuplicate(d.id))}>Different pharmacies — keep both</button>
          </div>
        )) : <Empty>No possible duplicates waiting.</Empty>}
      </Panel>
      <Panel title="Waiting for business verification" sub="Highest score first. Open a lead to record evidence (licence/GST check, field visit, call).">
        {q.unverified.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[760px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Pharmacy</th><th className={th}>Phone</th><th className={th}>Location</th><th className={th}>Status</th><th className={th + " text-right"}>Score</th><th className={th}></th></tr></thead>
            <tbody>{q.unverified.map((l) => <tr key={l.id}><td className={td}><LeadLink id={l.id} name={l.name} code={l.code} /></td><td className={td + " tnum"}>{l.phone ? displayPhone(l.phone) : l.phoneRaw || "—"}</td><td className={td}>{[l.city, l.state].filter(Boolean).join(", ")} {l.pin}</td><td className={td}><VerifyBadge v={l.verification} /></td><td className={td + " text-right"}><ScoreChip n={l.score} /></td><td className={td + " whitespace-nowrap"}><Link className={btn + " inline-flex"} href={`/staff/growth/leads/${l.id}`}>Verify</Link>{l.website ? <button className={btn + " inline-flex ml-1"} disabled={busy} onClick={() => run(() => checkWebsite(l.id), (r) => r.detail)}>Check website</button> : null}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty>Nothing waiting.</Empty>}
      </Panel>
    </>
  );
}
