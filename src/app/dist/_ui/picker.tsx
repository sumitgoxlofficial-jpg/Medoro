"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { confirmPickAction, packAction, startPickAction } from "../actions";

type Line = { id: string; rack: string | null; name: string; batchNo: string; expiry: string; units: number; packSize: number; pickedUnits: number | null };

/** Phone-first picking: one card per batch line in rack order, big targets, short picks allowed. */
export function Picker({ pickId, lines, status, started }: { pickId: string; lines: Line[]; status: string; started: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [boxes, setBoxes] = useState(1);
  const [edit, setEdit] = useState<string | null>(null);
  const done = lines.filter((l) => l.pickedUnits != null).length;
  const call = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (!r.ok) setErr(t((r as { error: string }).error)); else { setErr(null); router.refresh(); } });
  if (status !== "open") return <div className="bg-[#E6F4EC] text-[#1E7F4F] rounded-xl p-4 font-semibold">{t("This pick list is")} {t(status)}.</div>;
  return (
    <div className="flex flex-col gap-3">
      {!started ? <button disabled={pending} onClick={() => call(() => startPickAction(pickId))} className="h-14 rounded-xl bg-[#0B2545] text-white text-[16px] font-semibold">{t("Start picking")}</button> : null}
      <div className="h-2 rounded bg-[#E3E7ED]"><div className="h-2 rounded bg-[#1E7F4F]" style={{ width: `${(done / Math.max(1, lines.length)) * 100}%` }} /></div>
      {lines.map((l) => {
        const packs = l.units / l.packSize, picked = l.pickedUnits == null ? null : l.pickedUnits / l.packSize;
        return (
          <div key={l.id} className={`rounded-xl border p-4 ${picked == null ? "bg-white border-[#C9D2DE]" : picked < packs ? "bg-[#FDF2E1] border-[#E9C987]" : "bg-[#E6F4EC] border-[#A9D8BD]"}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-[64px] text-center rounded-lg bg-[#0B2545] text-white py-2 px-1"><div className="text-[10px] uppercase opacity-70">{t("Rack")}</div><div className="text-[15px] font-bold">{l.rack ?? "—"}</div></div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-semibold leading-tight">{l.name}</div>
                <div className="text-[13.5px] mt-0.5">{t("Batch")} <strong>{l.batchNo}</strong> · {t("Exp")} {l.expiry.slice(5, 7)}/{l.expiry.slice(2, 4)}</div>
              </div>
              <div className="text-right"><div className="text-[26px] font-bold tnum leading-none">{packs}</div><div className="text-[11px] text-[#5B6B82]">{t("packs")}</div></div>
            </div>
            {edit === l.id ? (
              <div className="flex gap-2 mt-3">
                <input type="number" inputMode="numeric" min={0} max={packs} defaultValue={picked ?? packs} id={`q-${l.id}`} className="h-12 flex-1 rounded-lg border border-[#C9D2DE] px-3 text-[18px]" />
                <button className="h-12 px-4 rounded-lg bg-[#0B2545] text-white font-semibold" onClick={() => { const v = Number((document.getElementById(`q-${l.id}`) as HTMLInputElement).value); setEdit(null); call(() => confirmPickAction(l.id, Math.round(v) * l.packSize)); }}>{t("Save")}</button>
              </div>
            ) : (
              <div className="flex gap-2 mt-3">
                <button disabled={pending} onClick={() => call(() => confirmPickAction(l.id, l.units))} className="h-12 flex-1 rounded-lg bg-[#1E7F4F] text-white font-semibold text-[15px]">{picked === packs ? t("Picked ✓") : t("Picked all")}</button>
                <button disabled={pending} onClick={() => setEdit(l.id)} className="h-12 px-4 rounded-lg border border-[#C9D2DE] bg-white font-semibold">{t("Short")}</button>
              </div>
            )}
            {picked != null && picked < packs ? <div className="text-[12.5px] text-[#94570A] mt-2">{t("Short pick")}: {picked} / {packs}</div> : null}
          </div>
        );
      })}
      <div className="sticky bottom-0 bg-[#F4F6F9] pt-2 pb-3 flex gap-2 items-center">
        <label className="text-[13px]">{t("Boxes")}<input type="number" min={1} value={boxes} onChange={(e) => setBoxes(Math.max(1, Number(e.target.value) || 1))} className="ml-2 h-12 w-[72px] rounded-lg border border-[#C9D2DE] px-2 text-[18px]" /></label>
        <button disabled={pending || done < lines.length} onClick={() => call(() => packAction(pickId, boxes))} className="h-12 flex-1 rounded-xl bg-[#0B2545] text-white font-semibold disabled:opacity-40">{done < lines.length ? `${t("Pick every line first")} (${done}/${lines.length})` : t("Packed — ready to invoice")}</button>
      </div>
      {err ? <div role="alert" className="text-[13px] text-[#B3261E]">{err}</div> : null}
    </div>
  );
}
