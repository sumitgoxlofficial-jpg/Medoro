"use client";
import { useMemo, useState, useTransition } from "react";
import { Stethoscope, UserPlus, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { DoctorRow } from "@/domain/doctors/service";
import { quickAddDoctorAction } from "./catalog-actions";

export type DoctorOpt = Pick<DoctorRow, "id" | "name" | "qualification" | "regNo" | "clinic">;

const label = (d: DoctorOpt) => `Dr ${d.name}${d.qualification ? `, ${d.qualification}` : ""}`;

/**
 * Prescriber at the counter: pick a doctor from the master (linked for referral reports and the Rx register),
 * quick-add one, or just type a name (kept as the bill's free-text prescriber, like older bills).
 */
export function DoctorPicker({ doctors, setDoctors, doctorId, text, onChange, required }: {
  doctors: DoctorOpt[]; setDoctors: (d: DoctorOpt[]) => void; doctorId: string; text: string; required: boolean;
  onChange: (p: { doctorId: string; text: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [hl, setHl] = useState(0);
  const picked = doctors.find((d) => d.id === doctorId) ?? null;
  const q = text.trim().toLowerCase().replace(/^dr\.?\s*/, "");
  const matches = useMemo(() => (q ? doctors.filter((d) => d.name.toLowerCase().includes(q) || (d.regNo ?? "").toLowerCase().includes(q) || (d.clinic ?? "").toLowerCase().includes(q)) : doctors).slice(0, 8), [doctors, q]);
  const choose = (d: DoctorOpt) => { onChange({ doctorId: d.id, text: label(d) }); setOpen(false); };
  const border = required ? "border-[#E5B4AE]" : "border-input";

  if (picked) {
    return (
      <div className={`flex items-center gap-2 border ${border} rounded-[7px] px-2.5 py-2 text-[13.5px] bg-white`}>
        <Stethoscope size={14} className="text-teal shrink-0" />
        <span className="flex-1 min-w-0 truncate">{label(picked)}{picked.regNo ? <span className="text-muted"> · Reg {picked.regNo}</span> : null}</span>
        <button onClick={() => onChange({ doctorId: "", text: "" })} aria-label="Clear doctor" className="text-fainter hover:text-bad cursor-pointer"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="flex gap-1.5">
        <input value={text} onChange={(e) => { onChange({ doctorId: "", text: e.target.value }); setOpen(true); setHl(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && open && matches[hl]) { e.preventDefault(); choose(matches[hl]); }
          }}
          placeholder={required ? "Prescriber: pick a doctor or type a name *" : "Referring doctor (optional)"} aria-label="Prescriber"
          className={`flex-1 min-w-0 border ${border} rounded-[7px] px-2.5 py-2 text-[13.5px] bg-white outline-none focus:border-teal`} />
        <button onClick={() => setAdding(true)} title="Add a doctor" aria-label="Add a doctor" className={`border ${border} rounded-[7px] px-2 bg-white text-teal cursor-pointer`}><UserPlus size={15} /></button>
      </div>
      {open && matches.length ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] bg-white border border-input rounded-lg shadow-[0_12px_32px_rgba(0,0,0,.12)] z-30 overflow-hidden">
          {matches.map((d, i) => (
            <button key={d.id} onMouseDown={(e) => { e.preventDefault(); choose(d); }} onMouseEnter={() => setHl(i)} className="w-full text-left px-3 py-2 text-[13px] border-b border-row last:border-0 cursor-pointer" style={{ background: i === hl ? "#F0F7F6" : "#fff" }}>
              <span className="font-medium">{label(d)}</span><span className="text-muted">{d.regNo ? ` · Reg ${d.regNo}` : ""}{d.clinic ? ` · ${d.clinic}` : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
      {text.trim() && !doctorId ? <div className="text-[11.5px] text-faint mt-1">Not linked to a doctor: kept as typed. Pick from the list or add the doctor to track referrals.</div> : null}
      {adding ? <QuickAdd initial={text.replace(/^dr\.?\s*/i, "")} onClose={() => setAdding(false)} onSaved={(d, all) => { setDoctors(all); choose(d); setAdding(false); }} /> : null}
    </div>
  );
}

function QuickAdd({ initial, onClose, onSaved }: { initial: string; onClose: () => void; onSaved: (d: DoctorOpt, all: DoctorOpt[]) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: initial, qualification: "", regNo: "", clinic: "", phone: "" });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => start(async () => {
    const r = await quickAddDoctorAction(f);
    if (!r.ok) return toast(r.error, "red");
    onSaved(r.data.doctor, r.data.doctors);
  });
  return (
    <Modal open onClose={onClose} width={460} title="Add doctor" sub="Saved to the doctor master for prescriptions and referral reports."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Add and select"}</Button></>}>
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <Field label="Name *"><Input value={f.name} onChange={set("name")} autoFocus placeholder="A. Mehta" /></Field>
        <Field label="Qualification"><Input value={f.qualification} onChange={set("qualification")} placeholder="MBBS, MD" /></Field>
        <Field label="Registration no."><Input value={f.regNo} onChange={set("regNo")} className="font-mono" placeholder="MMC 2011/04/1234" /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        <div className="col-span-2 max-sm:col-span-1"><Field label="Clinic / hospital"><Input value={f.clinic} onChange={set("clinic")} /></Field></div>
      </div>
    </Modal>
  );
}
