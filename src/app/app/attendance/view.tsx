"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FileDown, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n-client";
import { hm } from "@/domain/identity/attendance-format";
import type { monthOf, teamMonth, today } from "@/domain/identity/attendance";
import { fixDayAction, punchInAction, punchOutAction } from "./actions";

type Mine = Awaited<ReturnType<typeof monthOf>>;
type Team = Awaited<ReturnType<typeof teamMonth>>;
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row";
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
const shift = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

export function AttendanceView({ ym, now, mine, team, all, multiBranch, readOnly }: { ym: string; now: Awaited<ReturnType<typeof today>>; mine: Mine; team: Team | null; all: boolean; multiBranch: boolean; readOnly: boolean }) {
  const t = useT(), toast = useToast(), router = useRouter(), path = usePathname();
  const [pending, start] = useTransition(), [fix, setFix] = useState<{ userId: string; name: string } | null>(null);
  const go = (p: Record<string, string>) => router.replace(`${path}?${new URLSearchParams(p).toString()}`);
  const act = (fn: typeof punchInAction) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error, "red"); else toast(t("Saved."), "green"); router.refresh(); });
  return (
    <div className="flex flex-col gap-3.5 max-w-[1100px]">
      <div className={card + " p-4 flex items-center gap-4 flex-wrap"}>
        <div className="flex-1 min-w-[200px]">
          <div className="text-[13px] text-muted">{t("Today")}</div>
          <div className="text-[18px] font-semibold">{now.in ? `${t("In")} ${time(now.in)}${now.out ? ` · ${t("Out")} ${time(now.out)}` : ""}` : t("Not punched in yet")}</div>
        </div>
        {!now.in ? <Button variant="primary" disabled={pending || readOnly} onClick={() => act(punchInAction)}><LogIn size={15} />{t("Punch in")}</Button> : null}
        {now.in && !now.out ? <Button variant="primary" disabled={pending || readOnly} onClick={() => act(punchOutAction)}><LogOut size={15} />{t("Punch out")}</Button> : null}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => go({ m: shift(ym, -1), ...(all ? { all: "1" } : {}) })} aria-label={t("Previous month")}>‹</Button>
        <strong className="text-[14px]">{ym}</strong>
        <Button onClick={() => go({ m: shift(ym, 1), ...(all ? { all: "1" } : {}) })} aria-label={t("Next month")}>›</Button>
        {team ? <a href={`/api/reports/staff-attendance?period=month`} className="ml-auto inline-flex items-center gap-1 border border-input rounded-md px-2.5 py-1.5 text-[13px] text-ink hover:border-teal no-underline"><FileDown size={14} />{t("CSV")}</a> : null}
      </div>
      <div className={card + " overflow-x-auto"}>
        <div className="px-3.5 pt-3 text-[13px] font-semibold">{t("My days")} · {mine.present} {t("days")} · {hm(mine.minutes)}</div>
        {mine.days.length ? <table className="w-full text-[13.5px]"><thead><tr><th className={th}>{t("Date")}</th><th className={th}>{t("In")}</th><th className={th}>{t("Out")}</th><th className={th}>{t("Hours")}</th><th className={th}>{t("Note")}</th></tr></thead>
          <tbody>{mine.days.map((d) => <tr key={d.day}><td className={td}>{d.day}</td><td className={td}>{d.in}</td><td className={td}>{d.out || "—"}</td><td className={td}>{d.out ? hm(d.minutes) : "—"}</td><td className={td + " text-muted"}>{d.note}</td></tr>)}</tbody></table> : <Empty title={t("No days this month.")} />}
      </div>
      {team ? (
        <div className={card + " overflow-x-auto"}>
          <div className="px-3.5 pt-3 flex items-center gap-2"><span className="text-[13px] font-semibold">{t("Team")}</span>{multiBranch ? <Button className="ml-auto" onClick={() => go({ m: ym, ...(all ? {} : { all: "1" }) })}>{all ? t("This branch only") : t("All my branches")}</Button> : null}</div>
          {team.length ? <table className="w-full text-[13.5px]"><thead><tr><th className={th}>{t("Name")}</th><th className={th}>{t("Today")}</th><th className={th}>{t("Days present")}</th><th className={th}>{t("Hours")}</th><th className={th} /></tr></thead>
            <tbody>{team.map((p) => <tr key={p.userId}><td className={td}>{p.name}{p.employeeNo ? <span className="text-muted text-[12px]"> · {p.employeeNo}</span> : null}</td><td className={td}>{p.today || "—"}</td><td className={td}>{p.present}</td><td className={td}>{hm(p.minutes)}</td><td className={td + " text-right"}><Button disabled={readOnly} onClick={() => setFix({ userId: p.userId, name: p.name })}>{t("Fix a day")}</Button></td></tr>)}</tbody></table> : <Empty title={t("No staff to show.")} />}
        </div>
      ) : null}
      {fix ? <Fix who={fix} onClose={() => setFix(null)} /> : null}
    </div>
  );
}

function Fix({ who, onClose }: { who: { userId: string; name: string }; onClose: () => void }) {
  const t = useT(), toast = useToast(), router = useRouter();
  const [day, setDay] = useState(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)), [inT, setIn] = useState("09:00"), [outT, setOut] = useState("18:00"), [reason, setReason] = useState(""), [pending, start] = useTransition();
  const save = () => start(async () => { const r = await fixDayAction({ userId: who.userId, day, in: inT, out: outT, reason }); if (!r.ok) return toast(r.error, "red"); router.refresh(); onClose(); });
  return (
    <Modal open title={`${t("Fix a day")} · ${who.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label={t("Date")}><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("In (HH:MM)")}><Input value={inT} onChange={(e) => setIn(e.target.value)} /></Field>
          <Field label={t("Out (HH:MM, optional)")}><Input value={outT} onChange={(e) => setOut(e.target.value)} /></Field>
        </div>
        <Field label={t("Reason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="text-[12px] text-faint">{t("This is saved with your name and written to the audit trail.")}</div>
        <Button variant="primary" disabled={pending} onClick={save}>{t("Save")}</Button>
      </div>
    </Modal>
  );
}
