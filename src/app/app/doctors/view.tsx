"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileDown, Pencil, Plus, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useActionToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { doctorSalesCsv } from "@/domain/doctors/contracts";
import type { DoctorRow, doctorSales } from "@/domain/doctors/service";
import { addDoctorAction, editDoctorAction } from "./actions";

type Report = Awaited<ReturnType<typeof doctorSales>>;
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row";
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";

export function DoctorsView({ tab, doctors, q, report, branches, canReport, canEdit }: {
  tab: "master" | "report"; doctors: DoctorRow[]; q: string; report: Report | null; branches: { id: string; name: string }[]; canReport: boolean; canEdit: boolean;
}) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const nav = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      {canReport ? <Segmented value={tab} onChange={(v) => nav({ tab: v === "report" ? "report" : null })} className="self-start bg-[#EEF0F2]" options={[{ value: "master", label: "Doctors" }, { value: "report", label: "Sales by doctor" }]} /> : null}
      {tab === "report" && report ? <ReportView report={report} branches={branches} nav={nav} /> : <Master doctors={doctors} q={q} nav={nav} canEdit={canEdit} />}
    </div>
  );
}

function Master({ doctors, q, nav, canEdit }: { doctors: DoctorRow[]; q: string; nav: (p: Record<string, string | null>) => void; canEdit: boolean }) {
  const [query, setQuery] = useState(q);
  const [edit, setEdit] = useState<DoctorRow | "new" | null>(null);
  useEffect(() => {
    if (query === q) return;
    const h = setTimeout(() => nav({ q: query || null }), 250);
    return () => clearTimeout(h);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex gap-2.5 items-center flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-[420px]">
          <Search size={16} className="absolute left-[11px] top-1/2 -translate-y-1/2 text-fainter" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, registration no., clinic or phone" aria-label="Search doctors"
            className="w-full border border-input rounded-lg py-[9px] pr-[11px] pl-[34px] text-[14px] outline-none bg-white focus:border-teal" />
        </div>
        <span className="text-[12.5px] text-muted ml-auto">{doctors.length} doctor{doctors.length === 1 ? "" : "s"}</span>
        <Button variant="primary" onClick={() => setEdit("new")}><Plus size={16} />Add doctor</Button>
      </div>
      <div className={card + " overflow-auto"}>
        {doctors.length ? (
          <table className="w-full border-collapse min-w-[760px] text-[14px]">
            <thead><tr className="bg-subtle"><th className={th}>Doctor</th><th className={th}>Registration no.</th><th className={th}>Clinic</th><th className={th}>Phone</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody>
              {doctors.map((d) => (
                <tr key={d.id}>
                  <td className={td}><div className="font-semibold">Dr {d.name}</div><div className="text-[12px] text-muted">{d.qualification ?? ""}</div></td>
                  <td className={td + " font-mono text-[13px]"}>{d.regNo ?? "—"}</td>
                  <td className={td + " text-[13px]"}>{d.clinic ?? "—"}{d.address ? <div className="text-[12px] text-muted truncate max-w-[260px]">{d.address}</div> : null}</td>
                  <td className={td + " text-[13px] tnum"}>{d.phone ?? "—"}</td>
                  <td className={td}><Badge tone={d.active ? "green" : "gray"}>{d.active ? "Active" : "Inactive"}</Badge></td>
                  <td className={td + " text-right"}>{canEdit ? <Button size="sm" onClick={() => setEdit(d)}><Pencil size={13} />Edit</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty icon={Stethoscope} title={q ? "No doctors match" : "No doctors yet"} body="Add the doctors whose prescriptions you fill. At the counter, pick them as the prescriber; their registration number prints on the bill and sales roll up under Sales by doctor." />}
      </div>
      {edit ? <DoctorModal doctor={edit === "new" ? null : edit} canEdit={canEdit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function DoctorModal({ doctor, canEdit, onClose }: { doctor: DoctorRow | null; canEdit: boolean; onClose: () => void }) {
  const toastR = useActionToast();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: doctor?.name ?? "", qualification: doctor?.qualification ?? "", regNo: doctor?.regNo ?? "", clinic: doctor?.clinic ?? "", phone: doctor?.phone ?? "", address: doctor?.address ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = (active?: boolean) => start(async () => {
    const r = doctor ? await editDoctorAction(doctor.id, doctor.version, { ...f, ...(active === undefined ? {} : { active }) }) : await addDoctorAction(f);
    if (!r.ok) return setErr(r.error);
    toastR(r); onClose();
  });
  return (
    <Modal open onClose={onClose} width={560} title={doctor ? `Dr ${doctor.name}` : "Add doctor"} sub="Registration number as issued by the State Medical Council or NMC."
      footer={<>
        {doctor && canEdit ? <Button className="mr-auto" disabled={pending} onClick={() => save(!doctor.active)}>{doctor.active ? "Deactivate" : "Reactivate"}</Button> : null}
        <Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => save()}>{pending ? "Saving…" : "Save doctor"}</Button>
      </>}>
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <Field label="Name *"><Input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Qualification"><Input value={f.qualification} onChange={set("qualification")} placeholder="MBBS, MD (Medicine)" /></Field>
        <Field label="Registration no."><Input value={f.regNo} onChange={set("regNo")} className="font-mono" /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        <Field label="Clinic / hospital"><Input value={f.clinic} onChange={set("clinic")} /></Field>
        <Field label="Address"><Input value={f.address} onChange={set("address")} /></Field>
      </div>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

function ReportView({ report: r, branches, nav }: { report: Report; branches: { id: string; name: string }[]; nav: (p: Record<string, string | null>) => void }) {
  const [from, setFrom] = useState(r.fromDay), [to, setTo] = useState(r.toDay);
  const branchName = r.branchId === "all" ? "All branches" : branches.find((b) => b.id === r.branchId)?.name ?? "";
  return (
    <>
      <div className="flex gap-2.5 items-end flex-wrap">
        <label className="flex flex-col gap-1 text-[12px] text-muted">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-input rounded-lg px-2.5 py-2 text-[13.5px] bg-white" /></label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-input rounded-lg px-2.5 py-2 text-[13.5px] bg-white" /></label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">Branch
          <select value={r.branchId} onChange={(e) => nav({ branch: e.target.value })} className="border border-input rounded-lg px-2.5 py-2 text-[13.5px] bg-white">
            {branches.length > 1 ? <option value="all">All my branches</option> : null}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <Button onClick={() => nav({ from, to })}>Apply</Button>
        <Button className="ml-auto" disabled={!r.rows.length} onClick={() => downloadCsv(`sales-by-doctor-${r.fromDay}-${r.toDay}`, doctorSalesCsv(r, branchName))}><FileDown size={15} />CSV</Button>
      </div>
      <div className={card + " overflow-auto"}>
        {r.rows.length ? (
          <table className="w-full border-collapse min-w-[860px] text-[14px]">
            <thead><tr className="bg-subtle"><th className={th}>Doctor</th><th className={th}>Reg. no.</th><th className={th + " text-right"}>Bills</th><th className={th + " text-right"}>Rx bills</th><th className={th + " text-right"}>Gross</th><th className={th + " text-right"}>Returns</th><th className={th + " text-right"}>Net</th><th className={th}>Last bill</th></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.key}>
                  <td className={td}><div className="font-semibold">Dr {x.name}</div><div className="text-[12px] text-muted">{x.clinic ?? ""}{x.linked ? "" : "Typed on the bill, not in the doctor master"}</div></td>
                  <td className={td + " font-mono text-[13px]"}>{x.regNo ?? "—"}</td>
                  <td className={td + " text-right tnum"}>{x.bills}</td>
                  <td className={td + " text-right tnum"}>{x.rxBills}</td>
                  <td className={td + " text-right tnum"}>{inr(x.gross)}</td>
                  <td className={td + " text-right tnum text-bad"}>{x.returns ? inr(-x.returns) : "—"}</td>
                  <td className={td + " text-right tnum font-semibold"}>{inr(x.net)}</td>
                  <td className={td + " text-[13px]"}>{new Date(x.last).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</td>
                </tr>
              ))}
              <tr className="bg-subtle font-semibold"><td className={td}>Total</td><td className={td} /><td className={td + " text-right tnum"}>{r.total.bills}</td><td className={td} /><td className={td + " text-right tnum"}>{inr(r.total.gross)}</td><td className={td + " text-right tnum"}>{r.total.returns ? inr(-r.total.returns) : "—"}</td><td className={td + " text-right tnum"}>{inr(r.total.net)}</td><td className={td} /></tr>
            </tbody>
          </table>
        ) : <Empty icon={Stethoscope} title="No prescriber on any bill in this period" body="Pick the referring doctor at the counter to see their sales here." />}
      </div>
      <div className="text-[12px] text-faint">Bill totals include GST. Returns are credit notes against those bills. Bills from before the doctor master show under the name typed at the counter.</div>
    </>
  );
}
