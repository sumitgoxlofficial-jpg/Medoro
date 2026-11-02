"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, Pencil, Plus, Stethoscope, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { useLang, useT } from "@/lib/i18n-client";
import { localeOf } from "@/lib/tr";
import { deviceDb } from "@/drivedb/device";
import type { Doctor, doctorSales } from "@/drivedb/doctors";
import { doctorSalesCsv } from "@/domain/doctors/contracts";
import { downloadCsv } from "@/lib/csv";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { card, input, label, errText, type Cfg, type Who } from "./ui";

type Report = ReturnType<typeof doctorSales>;

/** Doctor master for prescriptions, and (owner) sales by referring doctor. Works offline. */
export function Doctors({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const t = useT();
  const [tab, setTab] = useState<"master" | "report">("master");
  return (
    <div className="flex flex-col gap-3">
      {who.owner && <Segmented value={tab} onChange={(v) => setTab(v)} className="self-start" options={[{ value: "master", label: "Doctors" }, { value: "report", label: "Sales by doctor" }]} />}
      {tab === "report" && who.owner ? <SalesReport cfg={cfg} refresh={refresh} /> : <Master who={who} refresh={refresh} />}
      <div className="text-xs text-faint">{t("Saved on this counter and shared with your other counters through Google Drive.")}</div>
    </div>
  );
}

function Master({ who, refresh }: { who: Who; refresh: number }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Doctor[]>([]);
  const [edit, setEdit] = useState<Doctor | "new" | null>(null);
  const load = useCallback(() => dev.call("listDoctors", { q, all: true }).then(setRows).catch((e) => toast(errText(e), "red")), [dev, q, toast]);
  useEffect(() => { const h = setTimeout(() => void load(), 150); return () => clearTimeout(h); }, [load, refresh]);

  return (
    <div className={card}>
      <div className="flex gap-2 items-center flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search doctors")} aria-label={t("Search doctors")} className={input + " flex-1 min-w-[180px] max-w-[420px]"} />
        <span className="text-xs text-muted ml-auto">{t(rows.length === 1 ? "{n} doctor" : "{n} doctors", { n: rows.length })}</span>
        <Button variant="primary" onClick={() => setEdit("new")}><Plus size={16} /> {t("Add doctor")}</Button>
      </div>
      {rows.length ? (
        <ul className="text-sm divide-y divide-line">
          {rows.map((d) => (
            <li key={d.id} className="py-2.5 flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <div className="font-semibold">{t("Dr {name}", { name: d.name })}{d.qualification ? <span className="font-normal text-muted">, {d.qualification}</span> : null}</div>
                <div className="text-xs text-muted">{[d.regNo ? t("Reg {reg}", { reg: d.regNo }) : null, d.clinic, d.phone].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <Badge tone={d.active ? "green" : "gray"}>{t(d.active ? "Active" : "Inactive")}</Badge>
              {who.owner && <Button size="sm" onClick={() => setEdit(d)} aria-label={t("Edit Dr {name}", { name: d.name })}><Pencil size={13} /> {t("Edit")}</Button>}
            </li>
          ))}
        </ul>
      ) : <Empty icon={Stethoscope} title={q ? t("No doctors match") : t("No doctors yet")} body={t("Add the doctors whose prescriptions you fill. At the counter, pick them as the prescriber; their registration number prints on the bill and sales roll up under Sales by doctor.")} />}
      {edit && <DoctorModal doctor={edit === "new" ? null : edit} canEdit={who.owner} onClose={() => setEdit(null)} onSaved={(msg) => { setEdit(null); toast(msg, "green"); void load(); }} />}
    </div>
  );
}

type Form = { name: string; qualification: string; regNo: string; clinic: string; phone: string; address: string };

function DoctorModal({ doctor, initial, canEdit, onClose, onSaved }: { doctor: Doctor | null; initial?: Partial<Form>; canEdit: boolean; onClose: () => void; onSaved: (msg: string, d: Doctor) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = deviceDb();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Form>({ name: doctor?.name ?? initial?.name ?? "", qualification: doctor?.qualification ?? "", regNo: doctor?.regNo ?? initial?.regNo ?? "", clinic: doctor?.clinic ?? "", phone: doctor?.phone ?? "", address: doctor?.address ?? "" });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (active?: boolean) => {
    setBusy(true);
    try {
      const d = doctor ? await dev.call("updateDoctor", doctor.id, { ...f, ...(active === undefined ? {} : { active }) }) : await dev.call("addDoctor", f);
      onSaved(!doctor ? "Doctor added." : active === false ? "Doctor deactivated. Past bills keep the link." : active ? "Doctor reactivated." : "Doctor updated.", d);
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width={560} title={doctor ? t("Dr {name}", { name: doctor.name }) : t("Add doctor")} sub={t("Registration number as issued by the State Medical Council or NMC.")}
      footer={<div className="flex gap-2 justify-end w-full flex-wrap">
        {doctor && canEdit ? <Button className="mr-auto" disabled={busy} onClick={() => save(!doctor.active)}>{t(doctor.active ? "Deactivate" : "Reactivate")}</Button> : null}
        <Button onClick={onClose}>{t("Cancel")}</Button><Button variant="primary" disabled={busy || f.name.trim().length < 2} onClick={() => save()}>{t(busy ? "Saving…" : "Save doctor")}</Button>
      </div>}>
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <Field label={t("Name *")}><Input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label={t("Qualification")}><Input value={f.qualification} onChange={set("qualification")} placeholder="MBBS, MD" /></Field>
        <Field label={t("Registration no.")}><Input value={f.regNo} onChange={set("regNo")} className="font-mono" /></Field>
        <Field label={t("Phone")}><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        <Field label={t("Clinic / hospital")}><Input value={f.clinic} onChange={set("clinic")} /></Field>
        <Field label={t("Address")}><Input value={f.address} onChange={set("address")} /></Field>
      </div>
    </Modal>
  );
}

function SalesReport({ cfg, refresh }: { cfg: Cfg; refresh: number }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const today = todayISO();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState(cfg.branchId);
  const [r, setR] = useState<Report | null>(null);
  const load = useCallback(() => dev.call("doctorSales", from, to, branch).then(setR).catch((e) => toast(errText(e), "red")), [dev, from, to, branch, toast]);
  useEffect(() => { void load(); }, [load, refresh]);
  const branchName = branch === "all" ? t("All branches") : cfg.branches.find((b) => b.id === branch)?.name ?? cfg.branchName;

  return (
    <div className={card}>
      <div className="flex gap-2 items-end flex-wrap">
        <label className={label}>{t("From")}<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={input} /></label>
        <label className={label}>{t("To")}<input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={input} /></label>
        {cfg.branches.length > 1 && (
          <label className={label}>{t("Branch")}
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className={input}>
              <option value="all">{t("All branches")}</option>
              {cfg.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <Button className="ml-auto" disabled={!r?.rows.length} onClick={() => r && downloadCsv(`sales-by-doctor-${r.fromDay}-${r.toDay}`, doctorSalesCsv(r, branchName))}><FileDown size={15} /> CSV</Button>
      </div>
      {r?.rows.length ? (
        <div className="overflow-auto">
          <table className="w-full text-sm border-collapse min-w-[560px]">
            <thead><tr className="text-left text-xs text-muted border-b border-line">
              <th className="py-2 pr-2">{t("Doctor")}</th><th className="py-2 px-2 text-right">{t("Bills")}</th><th className="py-2 px-2 text-right">{t("Rx bills")}</th>
              <th className="py-2 px-2 text-right">{t("Gross")}</th><th className="py-2 px-2 text-right">{t("Returns")}</th><th className="py-2 px-2 text-right">{t("Net")}</th><th className="py-2 pl-2">{t("Last bill")}</th>
            </tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.key} className="border-b border-line">
                  <td className="py-2 pr-2"><div className="font-semibold">{t("Dr {name}", { name: x.name })}</div>
                    <div className="text-xs text-muted">{[x.regNo ? t("Reg {reg}", { reg: x.regNo }) : null, x.clinic, x.linked ? null : t("Typed on the bill, not in the doctor list")].filter(Boolean).join(" · ")}</div></td>
                  <td className="py-2 px-2 text-right tabular-nums">{x.bills}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{x.rxBills}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{inr(x.gross)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-bad">{x.returns ? inr(-x.returns) : "—"}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{inr(x.net)}</td>
                  <td className="py-2 pl-2 whitespace-nowrap">{new Date(x.last).toLocaleDateString(localeOf(lang), { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-2 pr-2">{t("Total")}</td><td className="py-2 px-2 text-right tabular-nums">{r.total.bills}</td><td /><td className="py-2 px-2 text-right tabular-nums">{inr(r.total.gross)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{r.total.returns ? inr(-r.total.returns) : "—"}</td><td className="py-2 px-2 text-right tabular-nums">{inr(r.total.net)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      ) : <Empty icon={Stethoscope} title={t("No prescriber on any bill in this period")} body={t("Pick the referring doctor at the counter to see their sales here.")} />}
      <div className="text-xs text-faint">{t("Bill totals include GST. Returns are credit notes against those bills. Bills are linked to a doctor by registration no., or by name when only one doctor has it.")}</div>
    </div>
  );
}

/**
 * Prescriber at the counter: search the doctor list and pick one (name and registration no. go on the bill), or
 * type a name and reg. no. as they are. A typed doctor can be saved to the list with one tap.
 */
export function DoctorPicker({ value, onChange }: { value: { name: string; reg: string }; onChange: (v: { name: string; reg: string }) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const [matches, setMatches] = useState<Doctor[]>([]);
  const [adding, setAdding] = useState(false);
  const [known, setKnown] = useState(false);
  const q = value.name.trim();

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => dev.call("listDoctors", { q }).then((r) => { setMatches(r.slice(0, 8)); setHl(0); }).catch(() => setMatches([])), 120);
    return () => clearTimeout(h);
  }, [q, open, dev]);
  // Whether the typed doctor is already on the list (by reg. no., else by name), to offer saving a new one.
  useEffect(() => {
    if (!q) { setKnown(true); return; }
    const h = setTimeout(() => dev.call("listDoctors", { q: value.reg.trim() || q, all: true })
      .then((r) => setKnown(r.some((d) => (value.reg.trim() ? (d.regNo ?? "").toUpperCase() === value.reg.trim().toUpperCase() : d.name.toLowerCase() === q.replace(/^dr\.?\s*/i, "").toLowerCase()))))
      .catch(() => setKnown(true)), 200);
    return () => clearTimeout(h);
  }, [q, value.reg, dev]);

  const choose = (d: Doctor) => { onChange({ name: d.name, reg: d.regNo ?? "" }); setOpen(false); setKnown(true); };
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_1fr] gap-2 max-sm:grid-cols-1">
        <div className="relative">
          <input value={value.name} onChange={(e) => { onChange({ ...value, name: e.target.value }); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, matches.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter" && open && matches[hl]) { e.preventDefault(); choose(matches[hl]); }
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder={t("Prescriber (doctor) name")} aria-label={t("Prescriber")} className={input + " pr-8"} autoComplete="off" />
          {value.name || value.reg ? <button type="button" onClick={() => onChange({ name: "", reg: "" })} aria-label={t("Clear doctor")} className="absolute right-2 top-1/2 -translate-y-1/2 text-fainter hover:text-bad cursor-pointer"><X size={14} /></button> : null}
          {open && matches.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow divide-y divide-line max-h-64 overflow-auto">
              {matches.map((d, i) => (
                <li key={d.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); choose(d); }} onMouseEnter={() => setHl(i)} className={`w-full text-left px-3 py-2 text-[13px] cursor-pointer ${i === hl ? "bg-page" : ""}`}>
                  <span className="font-medium">{t("Dr {name}", { name: d.name })}{d.qualification ? `, ${d.qualification}` : ""}</span>
                  <span className="text-muted">{d.regNo ? ` · ${t("Reg {reg}", { reg: d.regNo })}` : ""}{d.clinic ? ` · ${d.clinic}` : ""}</span>
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <input value={value.reg} onChange={(e) => onChange({ ...value, reg: e.target.value })} placeholder={t("Doctor’s reg. no.")} aria-label={t("Registration number")} className={input + " font-mono"} />
      </div>
      {q && !known && (
        <div className="text-[11.5px] text-faint flex items-center gap-2 flex-wrap">{t("Not in your doctor list: kept as typed.")}
          <button type="button" className="text-teal cursor-pointer" onClick={() => setAdding(true)}>{t("Add to doctors")}</button>
        </div>
      )}
      {adding && <DoctorModal doctor={null} initial={{ name: q.replace(/^dr\.?\s*/i, ""), regNo: value.reg }} canEdit={false} onClose={() => setAdding(false)}
        onSaved={(msg, d) => { setAdding(false); toast(msg, "green"); choose(d); }} />}
    </div>
  );
}
