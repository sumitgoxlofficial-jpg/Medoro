"use client";
import { Fragment, useRef, useState } from "react";
import { Gauge, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { speedTestTokenAction } from "./actions";

const SIZES = {
  small: { label: "Small pharmacy", medicines: 10_000, sales: 5_000, lines: 50_000 },
  large: { label: "Large pharmacy", medicines: 50_000, sales: 20_000, lines: 200_000 },
} as const;
type Row = { step: string; ms: number; note: string };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";
const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

export function SpeedTest({ drive }: { drive: boolean }) {
  const toast = useToast();
  const [size, setSize] = useState<keyof typeof SIZES>("large");
  const [withDrive, setWithDrive] = useState(drive);
  const [rows, setRows] = useState<Row[]>([]);
  const [info, setInfo] = useState<[string, string][]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);

  const startTest = async () => {
    setRows([]); setInfo([]); setError(""); setState("running");
    let token: string | undefined, driveNote = "skipped (not ticked)";
    if (withDrive) {
      const r = await speedTestTokenAction();
      if (r.ok) token = r.data; else driveNote = `skipped: ${r.error}`;
    }
    worker.current?.terminate();
    const w = new Worker("/drivedb/bench-worker.mjs", { type: "module" });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === "row") setRows((r) => [...r, { step: data.step, ms: data.ms, note: data.note }]);
      else if (data.type === "info") setInfo((i) => [...i, [data.key, data.value]]);
      else if (data.type === "done") { setState("done"); w.terminate(); }
      else if (data.type === "error") { setError(data.message); setState("error"); w.terminate(); }
    };
    w.onerror = (e) => { setError(e.message || "The test couldn't start in this browser."); setState("error"); };
    const s = SIZES[size];
    w.postMessage({ size: { medicines: s.medicines, sales: s.sales, lines: s.lines }, token, driveNote });
  };

  const copy = () => {
    const text = [`Medoro device speed test — ${SIZES[size].label}`, ...info.map(([k, v]) => `${k}: ${v}`), "", ...rows.map((r) => `${r.step}: ${fmt(r.ms)}${r.note ? ` (${r.note})` : ""}`), error ? `Error: ${error}` : ""].join("\n");
    navigator.clipboard.writeText(text).then(() => toast("Results copied. Paste them in the chat.", "green"), () => toast("Couldn't copy. Select the table and copy it.", "red"));
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className={card}>
        <div className="text-sm text-muted">
          Builds a sample pharmacy (medicines, batches, past bills) inside this browser, times searches, bills and reports, then
          uploads an encrypted copy to your Google Drive and downloads it again. Test files are deleted afterwards. Takes about 1–3 minutes;
          keep this page open. Run it on the phones and computers your counters actually use.
        </div>
        <div className="flex flex-wrap gap-4 items-center text-sm">
          {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="radio" name="size" checked={size === k} onChange={() => setSize(k)} disabled={state === "running"} />
              {SIZES[k].label} <span className="text-muted">({SIZES[k].medicines.toLocaleString("en-IN")} medicines, {SIZES[k].lines.toLocaleString("en-IN")} bill lines)</span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={withDrive} onChange={(e) => setWithDrive(e.target.checked)} disabled={!drive || state === "running"} />
          Include Google Drive upload/download test {!drive && <span className="text-muted">(connect Google Drive on the Backup page first)</span>}
        </label>
        <div className="flex gap-2">
          <Button variant="primary" onClick={startTest} disabled={state === "running"}><Gauge size={16} /> {state === "running" ? "Running…" : "Start test"}</Button>
          {(state === "done" || state === "error") && <Button onClick={copy}><Copy size={16} /> Copy results</Button>}
        </div>
      </div>
      {info.length > 0 && (
        <div className={card}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {info.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="break-all">{v}</dd></Fragment>))}
          </dl>
        </div>
      )}
      {rows.length > 0 && (
        <div className={card}>
          <table className="text-sm w-full">
            <thead><tr className="text-left text-muted"><th className="font-medium pb-1">Step</th><th className="font-medium pb-1 text-right">Time</th><th className="font-medium pb-1 pl-3">Details</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line"><td className="py-1.5">{r.step}</td><td className="py-1.5 text-right tabular-nums whitespace-nowrap">{fmt(r.ms)}</td><td className="py-1.5 pl-3 text-muted">{r.note}</td></tr>
              ))}
            </tbody>
          </table>
          {state === "running" && <div className="text-sm text-muted">Working… keep this page open.</div>}
        </div>
      )}
      {error && <div role="alert" className="text-sm text-bad">Test stopped: {error}</div>}
    </div>
  );
}
