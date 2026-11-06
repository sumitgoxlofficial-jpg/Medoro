"use client";
import { useState } from "react";
import Link from "next/link";
import { INDIAN_STATES } from "@/staff/growth/constants";
import { runJobsNow, startDiscovery } from "../../../growth-actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../../ui";
import { fmtDT } from "../kit";

type J = { id: string; code: string; fileName: string; status: string; totalRows: number; created: number; duplicates: number; possibleDuplicates: number; invalid: number; createdAt: string };

export function DiscoveryView({ jobs, enabled, endpoint, attribution }: { jobs: J[]; enabled: boolean; endpoint: string; attribution: string }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ state: "", district: "", city: "", pin: "" });
  return (
    <>
      <Panel title="Discover pharmacies" sub="India → State → District → City → PIN code. Searches OpenStreetMap (open data) for pharmacies; nothing is scraped.">
        <form className="grid gap-2.5 p-4 grid-cols-2 min-[900px]:grid-cols-5" onSubmit={(e) => { e.preventDefault(); run(() => startDiscovery(f as never), (r) => r.status === "completed" ? `${r.code}: ${r.created} new pharmacies found.` : `${r.code} queued; OpenStreetMap is busy, it retries automatically.`); }}>
          <label className={lbl}>State *<select required className={fieldCls} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Choose</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className={lbl}>District<input className={fieldCls} value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></label>
          <label className={lbl}>City<input className={fieldCls} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
          <label className={lbl}>PIN code<input className={fieldCls} maxLength={6} inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></label>
          <div className="flex items-end gap-2"><button className={btnPrimary} disabled={busy || !enabled || !f.state}>Discover</button></div>
        </form>
        <div className="px-4 pb-4 text-[12.5px] text-muted flex flex-col gap-1">
          <span>{enabled ? `Runs in the background against ${endpoint}, one query per search (public Overpass usage limits apply).` : "Discovery is switched off on this server (GROWTH_OSM=off)."} Found pharmacies start unverified; records without a phone go to Research pending.</span>
          <span>Tip: most pharmacies on OpenStreetMap in India have no PIN code recorded, so search by city or district. A PIN only drops pharmacies whose recorded PIN is different.</span>
          <span>{attribution}. Every lead keeps a link to its OpenStreetMap record.</span>
          <span>Other approved sources: <Link className="text-teal" href="/staff/growth/import">import</Link> official directory exports, licensed provider data or lists pharmacies gave you.</span>
        </div>
      </Panel>
      <Panel title="Discovery runs" right={<button className={btn} disabled={busy} onClick={() => run(() => runJobsNow(), (r) => `${r.ran} background job(s) run.`)}>Run pending now</button>}>
        {jobs.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[720px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Run</th><th className={th}>Area</th><th className={th}>Status</th><th className={th + " text-right"}>Found</th><th className={th + " text-right"}>New leads</th><th className={th + " text-right"}>Already known</th><th className={th + " text-right"}>Skipped</th><th className={th}>Started</th></tr></thead>
            <tbody>{jobs.map((j) => <tr key={j.id}><td className={td}>{j.code}</td><td className={td}>{j.fileName.replace("OpenStreetMap: ", "")}</td><td className={td}><Pill bg={j.status === "completed" ? "#E3F5EC" : "#FFF4E0"} fg={j.status === "completed" ? "#18794E" : "#94570A"}>{j.status}</Pill></td><td className={td + " text-right tnum"}>{j.totalRows}</td><td className={td + " text-right tnum"}>{j.created}</td><td className={td + " text-right tnum"}>{j.duplicates}</td><td className={td + " text-right tnum"}>{j.invalid}</td><td className={td}>{fmtDT(j.createdAt)}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty>No discovery runs yet.</Empty>}
      </Panel>
    </>
  );
}
