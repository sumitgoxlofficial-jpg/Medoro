"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOST_REASONS, STAGES } from "@/staff/growth/constants";
import { setStage } from "../../../growth-actions";
import { Panel, Tabs, selSm, td, th, useRun } from "../../ui";
import { STAGE_TONE, ScoreChip, StageBadge, fmtD } from "../kit";

type Card = { id: string; code: string; name: string; city: string; score: number; assignee: string; nextFollowUpAt: string | null; stage: string; lostReason: string | null };
type Col = { id: string; label: string; count: number; leads: Card[] };

export function PipelineView({ board, staff, staffId, view, canEdit }: { board: Col[]; staff: { id: string; name: string }[]; staffId: string; view: "kanban" | "table"; canEdit: boolean }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const go = (p: Record<string, string>) => router.push("?" + new URLSearchParams({ view, ...(staffId ? { staffId } : {}), ...p }).toString());
  const move = (c: Card, to: string) => {
    if (to === c.stage) return;
    let lostReason: string | undefined;
    if (to === "LOST") { lostReason = window.prompt(`Why was it lost? (${LOST_REASONS.join(", ")})`) ?? undefined; if (!lostReason || !(LOST_REASONS as readonly string[]).includes(lostReason)) return; }
    run(() => setStage(c.id, { stage: to as "LOST", lostReason: lostReason as never }));
  };
  const Mover = ({ c }: { c: Card }) => canEdit ? <select aria-label={`Move ${c.name}`} disabled={busy} className={selSm + " !py-0.5 !text-[11.5px] w-full"} value={c.stage} onChange={(e) => move(c, e.target.value)}>{STAGES.filter(([v]) => v !== "CONVERTED" || c.stage === "CONVERTED").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null;
  const total = board.reduce((n, c) => n + c.count, 0);
  return (
    <>
      <div className="flex gap-2 flex-wrap items-center">
        <Tabs value={view} options={[["kanban", "Kanban"], ["table", "Table"]]} onChange={(v) => go({ view: v })} />
        {staff.length ? <select className={selSm} value={staffId} onChange={(e) => go({ staffId: e.target.value })}><option value="">All employees</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}
        <span className="text-muted text-[13px]">{total.toLocaleString("en-IN")} leads · converted is set by recording a conversion</span>
      </div>
      {view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {board.map((col) => (
            <div key={col.id} className="w-[230px] flex-none bg-white border border-[#E6E8EB] rounded-xl flex flex-col max-h-[70vh]">
              <div className="px-3 py-2.5 border-b border-[#EEF0F2] flex items-center gap-2" style={{ borderTop: `3px solid ${STAGE_TONE[col.id]?.[1] ?? "#999"}`, borderRadius: "12px 12px 0 0" }}><strong className="text-[13px] flex-1">{col.label}</strong><span className="text-muted text-[12px] tnum">{col.count}</span></div>
              <div className="flex flex-col gap-2 p-2 overflow-auto">
                {col.leads.map((c) => (
                  <div key={c.id} className="border border-[#EEF0F2] rounded-lg p-2 text-[12.5px] flex flex-col gap-1 bg-[#FAFBFB]">
                    <Link href={`/staff/growth/leads/${c.id}`} className="font-semibold hover:text-teal leading-tight">{c.name}</Link>
                    <span className="text-muted">{c.city} · <ScoreChip n={c.score} />{c.assignee ? ` · ${c.assignee.split(" ")[0]}` : ""}</span>
                    {c.nextFollowUpAt ? <span className="text-muted">Follow-up {fmtD(c.nextFollowUpAt)}</span> : null}
                    {c.lostReason ? <span className="text-[#C0362C]">{c.lostReason}</span> : null}
                    <Mover c={c} />
                  </div>
                ))}
                {col.count > col.leads.length ? <Link href={`/staff/growth/leads?stage=${col.id}${staffId ? `&staffId=${staffId}` : ""}`} className="text-center text-teal text-[12px] py-1">+{col.count - col.leads.length} more</Link> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Panel>
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[760px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Stage</th><th className={th}>Pharmacy</th><th className={th}>City</th><th className={th}>Employee</th><th className={th + " text-right"}>Score</th><th className={th}>Next follow-up</th><th className={th}>Move</th></tr></thead>
            <tbody>{board.flatMap((col) => col.leads).map((c) => <tr key={c.id}><td className={td}><StageBadge s={c.stage} /></td><td className={td}><Link className="font-semibold hover:text-teal" href={`/staff/growth/leads/${c.id}`}>{c.name}</Link></td><td className={td}>{c.city}</td><td className={td}>{c.assignee}</td><td className={td + " text-right"}><ScoreChip n={c.score} /></td><td className={td}>{fmtD(c.nextFollowUpAt)}</td><td className={td + " w-[190px]"}><Mover c={c} /></td></tr>)}</tbody>
          </table></div>
        </Panel>
      )}
    </>
  );
}
