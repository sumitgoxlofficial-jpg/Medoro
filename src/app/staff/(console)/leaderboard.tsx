"use client";
import { useState } from "react";
import { Trophy } from "lucide-react";
import { rupees } from "@/staff/constants";
import { Empty, Panel, Tabs, td, th } from "./ui";

export type BoardRow = { rank: number; me?: boolean; name: string; area: string; sales: number; signups: number; earned?: number };
export type Boards = Record<"today" | "week" | "month", { top: BoardRow[]; myRank?: number | null }>;
const MEDAL = ["#C99A06", "#8A9299", "#A8622A"];
const LABEL = { today: "Today", week: "This week", month: "This month" } as const;

/** Top reference partners today, this week and this month. */
export function Leaderboard({ boards, showEarnings = false }: { boards: Boards; showEarnings?: boolean }) {
  const [p, setP] = useState<keyof Boards>("week");
  const b = boards[p];
  const mine = b.myRank;
  return (
    <Panel title={<span className="flex gap-2 items-center"><Trophy size={16} className="text-[#C99A06]" />Top partners</span>}
      sub={mine ? `You’re #${mine} ${p === "today" ? "today" : p === "week" ? "this week" : "this month"}` : "Ranked by paying pharmacies, then sign-ups"}
      right={<Tabs value={p} onChange={setP} options={(["today", "week", "month"] as const).map((k) => [k, LABEL[k]])} />}>
      {b.top.length ? (
        <div className="overflow-auto tbl-scroll"><table className="w-full border-collapse min-w-[480px] text-[13.5px]">
          <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th + " w-14"}>#</th><th className={th}>Partner</th><th className={th + " text-right"}>Paying pharmacies</th><th className={th + " text-right"}>Sign-ups</th>{showEarnings ? <th className={th + " text-right"}>Earned</th> : null}</tr></thead>
          <tbody>{b.top.map((r) => (
            <tr key={r.rank + r.name} className={r.me ? "bg-teal-tint" : ""}>
              <td className={td}>{r.rank <= 3 ? <span className="size-6 rounded-full inline-flex items-center justify-center text-white text-[12px] font-bold" style={{ background: MEDAL[r.rank - 1] }}>{r.rank}</span> : <span className="pl-1.5 text-muted font-semibold">{r.rank}</span>}</td>
              <td className={td}><span className={r.me ? "font-bold text-teal" : "font-semibold"}>{r.name}</span>{r.area ? <div className="text-[12px] text-muted">{r.area}</div> : null}</td>
              <td className={td + " text-right tnum font-semibold"}>{r.sales}</td>
              <td className={td + " text-right tnum"}>{r.signups}</td>
              {showEarnings ? <td className={td + " text-right tnum"}>{rupees(r.earned ?? 0)}</td> : null}
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>No referrals {p === "today" ? "today" : p === "week" ? "this week" : "this month"} yet. The first one tops the board.</Empty>}
    </Panel>
  );
}
