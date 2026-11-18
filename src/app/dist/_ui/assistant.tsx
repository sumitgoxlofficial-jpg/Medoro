"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n-client";
import { Btn } from "./forms";
import { askAction, draftPoAction } from "../actions";

type Answer = { answer: string; table?: { columns: string[]; rows: (string | number)[][] }; source: string; actions?: { label: string; href: string }[] };

export function Assistant() {
  const t = useT();
  const [q, setQ] = useState("");
  const [a, setA] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ask = (text: string) => start(async () => { setQ(text); const r = await askAction(text); if (r.ok) { setA(r.data as Answer); setErr(null); } else setErr(t(r.error)); });
  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Ask: What should I reorder? Who owes us the most? Which schemes made money?")} className="h-10 flex-1 rounded-md border border-[#C9D2DE] px-3 text-[13.5px]" />
        <Btn variant="primary" type="submit" disabled={pending}>{pending ? t("Working…") : t("Ask")}</Btn>
      </form>
      <div className="flex flex-wrap gap-1.5">{["What should I reorder?", "Expiry risk", "Dead stock", "Who owes us money?", "Scheme results", "Margins by product", "Sales forecast"].map((s) => <button key={s} onClick={() => ask(s)} className="h-7 px-2.5 rounded-full bg-[#E8EDF5] text-[#0B2545] text-[12px] font-medium">{t(s)}</button>)}</div>
      {err ? <div className="text-[13px] text-[#B3261E]">{err}</div> : null}
      {a ? (
        <div className="border border-[#E3E7ED] rounded-lg p-3 bg-[#FAFBFC]">
          <div className="text-[14px] text-[#0B2545] font-medium">{a.answer}</div>
          {a.table && a.table.rows.length ? (
            <div className="overflow-x-auto mt-2"><table className="w-full text-[12.5px]"><thead><tr>{a.table.columns.map((c) => <th key={c} className="text-left py-1 pr-2 text-[#4A5A73] font-semibold">{c}</th>)}</tr></thead><tbody>{a.table.rows.map((r, i) => <tr key={i} className="border-t border-[#EEF1F5]">{r.map((c, j) => <td key={j} className="py-1 pr-2">{c}</td>)}</tr>)}</tbody></table></div>
          ) : null}
          <div className="text-[11.5px] text-[#6B7A90] mt-2">{t("Source")}: {a.source} {t("Answers come from fixed queries on your own data; nothing is sent outside and nothing is posted.")}</div>
          {a.actions?.length ? <div className="flex gap-2 mt-2">{a.actions.map((x) => <Link key={x.href} href={x.href} className="text-[13px] font-semibold">{t(x.label)} →</Link>)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function DraftPo({ items }: { items: { id: string; label: string }[] }) {
  const t = useT();
  const [sel, setSel] = useState<string[]>(items.map((i) => i.id));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1">{items.map((i) => <label key={i.id} className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={sel.includes(i.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))} />{i.label}</label>)}</div>
      <div className="flex items-center gap-3">
        <Btn variant="primary" disabled={pending || !sel.length} onClick={() => start(async () => { const r = await draftPoAction(sel); setMsg(r.ok ? { ok: true, text: t(r.message ?? "") } : { ok: false, text: t(r.error) }); })}>{t("Create draft POs (you place them)")}</Btn>
        {msg ? <span className={`text-[12.5px] ${msg.ok ? "text-[#1E7F4F]" : "text-[#B3261E]"}`}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
