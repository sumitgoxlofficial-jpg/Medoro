"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HealthRow } from "@/domain/system/health";
import type { HealthState } from "@/domain/system/health-state";
import { STATE_LABEL } from "@/domain/system/health-state";
import { testAction } from "./actions";

const TONE: Record<HealthState, string> = {
  not_configured: "bg-slate-100 text-slate-700 border-slate-200",
  connected: "bg-amber-50 text-amber-800 border-amber-200",
  tested: "bg-sky-50 text-sky-800 border-sky-200",
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  error: "bg-red-50 text-red-800 border-red-200",
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");

export function HealthView({ rows, canTest }: { rows: HealthRow[]; canTest: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; ok: boolean; text: string } | null>(null);

  const run = (r: HealthRow) => {
    setBusy(r.key);
    start(async () => {
      if (r.action === "recheck") { router.refresh(); setBusy(null); return; }
      const res = await testAction(r.key);
      setNotice(res.ok ? { key: r.key, ok: res.data.state !== "error", text: res.data.state === "error" ? (res.data.lastError ?? "The test failed.") : `Test finished: ${STATE_LABEL[res.data.state]}.` } : { key: r.key, ok: false, text: res.error });
      setBusy(null);
      router.refresh();
    });
  };

  return (
    <div className="max-w-[1100px] flex flex-col gap-3" data-testid="health-list">
      {rows.map((r) => (
        <section key={r.key} className="bg-white border border-line rounded-xl p-4 flex flex-col gap-2" data-testid={`health-${r.key}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="m-0 text-[15px] font-semibold flex-1 min-w-[200px]">{r.label}</h2>
            <span className={`text-[12px] font-medium rounded-full border px-2.5 py-0.5 ${TONE[r.state]}`} data-testid={`health-state-${r.key}`}>{STATE_LABEL[r.state]}</span>
            {canTest ? (
              <button type="button" disabled={pending} onClick={() => run(r)} data-testid={`health-run-${r.key}`}
                className="text-[13px] rounded-lg border border-line px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
                {busy === r.key ? "Working…" : r.action === "test" ? (r.state === "error" ? "Retry test" : "Run test") : "Check again"}
              </button>
            ) : null}
          </div>
          <p className="m-0 text-[13px] text-slate-600">{r.reason}</p>
          {r.detail ? <p className="m-0 text-[12.5px] text-slate-500">{r.detail}</p> : null}
          <dl className="m-0 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[12px] text-slate-500">
            <div><dt className="inline">Last test: </dt><dd className="inline text-slate-700">{when(r.lastTestAt)}</dd></div>
            <div><dt className="inline">Last success: </dt><dd className="inline text-slate-700">{when(r.lastSuccessAt)}</dd></div>
            {r.lastErrorAt ? <div><dt className="inline">Last error: </dt><dd className="inline text-slate-700">{when(r.lastErrorAt)}</dd></div> : null}
          </dl>
          {r.state === "error" && r.lastError ? <p role="alert" className="m-0 text-[12.5px] text-red-700 break-words" data-testid={`health-error-${r.key}`}>{r.lastError}</p> : null}
          {notice?.key === r.key ? <p role="status" className={`m-0 text-[12.5px] ${notice.ok ? "text-emerald-700" : "text-red-700"}`}>{notice.text}</p> : null}
        </section>
      ))}
    </div>
  );
}
