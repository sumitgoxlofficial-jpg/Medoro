"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Data } from "@/staff/hrms/screens";
import type { Shell } from "@/staff/hrms/screens";
import { ASSET_KINDS, BOARD_COLS, CLAIM_STATUS, CLAIM_TYPES, LEAVE_TYPES, TICKET_TOPICS, inr, leaveLabel } from "@/staff/hrms/constants";
import { addReminder, applyLeave, cancelLeave, checkIn, checkOut, deleteTask, openPayslip, postAnnouncement, deleteAnnouncement, raiseTicket, referCandidate, requestCorrection, resolveTicket, savePhoto, saveProfile, scheduleMeeting, setTaskDone, submitClaim, addHoliday, removeHoliday, addNationalHolidays, saveMeetingNotes, cancelMeeting, moveTask, disconnectGoogle, addAsset, issueAsset, returnAsset, setAssetStatus, reportAssetIssue } from "../actions";
import { MyLetters } from "./letters";
import { Selfie, SelfieModal } from "./monitor";
import { Avatar, Card, Empty, Field, Grid, Modal, Pill, Stat, Table, Tabs, ago, btnCls, cx, dangerCls, dayLabel, dayLong, inputCls, primaryCls, statusTone, tdCls, timeLabel, useRun, Hide } from "./kit";

type P = { sh: Shell };

/** A real browser navigation to a route that redirects to Google, so deliberately not next/link. */
const GoogleConnect = () => (
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  <a className={primaryCls} href="/staff/hrms/google/start">Connect Google Calendar</a>
);

// ── Profile form (also the first-sign-in step)
type Prof = Data<"profile">["p"];
const blankProf = { phone: "", personalEmail: "", dob: "", gender: "", address: "", emergencyName: "", emergencyPhone: "", bloodGroup: "", bankHolder: "", bankAccount: "", bankIfsc: "", pan: "", uan: "" };
export function ProfileForm({ initial, complete, onSave, busy }: { initial: Partial<Prof> | null; complete?: boolean; onSave: (v: typeof blankProf) => void; busy: boolean }) {
  const [v, setV] = useState({ ...blankProf, ...(initial ? { phone: initial.phone ?? "", personalEmail: initial.personalEmail ?? "", dob: initial.dob ?? "", gender: initial.gender ?? "", address: initial.address ?? "", emergencyName: initial.emergencyName ?? "", emergencyPhone: initial.emergencyPhone ?? "", bloodGroup: initial.bloodGroup ?? "", bankHolder: initial.bankHolder ?? "", bankIfsc: initial.bankIfsc ?? "", uan: initial.uan ?? "" } : {}) });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <Grid n={3}>
        <Field label="Mobile"><input className={inputCls} value={v.phone} onChange={set("phone")} inputMode="tel" required={complete} /></Field>
        <Field label="Personal email"><input className={inputCls} type="email" value={v.personalEmail} onChange={set("personalEmail")} /></Field>
        <Field label="Date of birth"><input className={inputCls} type="date" value={v.dob} onChange={set("dob")} required={complete} /></Field>
        <Field label="Gender"><select className={inputCls} value={v.gender} onChange={set("gender")}><option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option></select></Field>
        <Field label="Blood group"><input className={inputCls} value={v.bloodGroup} onChange={set("bloodGroup")} placeholder="B+" maxLength={5} /></Field>
        <Field label="UAN (PF number)"><input className={inputCls} value={v.uan} onChange={set("uan")} inputMode="numeric" placeholder="12 digits, if you have one" /></Field>
      </Grid>
      <Field label="Address"><textarea className={inputCls} rows={2} value={v.address} onChange={set("address")} required={complete} /></Field>
      <Grid n={3}>
        <Field label="Emergency contact name"><input className={inputCls} value={v.emergencyName} onChange={set("emergencyName")} required={complete} /></Field>
        <Field label="Emergency contact mobile"><input className={inputCls} value={v.emergencyPhone} onChange={set("emergencyPhone")} inputMode="tel" required={complete} /></Field>
      </Grid>
      <h4 className="text-[13px] font-bold mt-1">Salary bank account</h4>
      <Grid n={3}>
        <Field label="Account holder"><input className={inputCls} value={v.bankHolder} onChange={set("bankHolder")} required={complete} /></Field>
        <Field label="Account number" hint={initial?.bankLast4 ? `Saved: ••••${initial.bankLast4}. Leave blank to keep it.` : "9 to 18 digits"}><input className={inputCls} value={v.bankAccount} onChange={set("bankAccount")} inputMode="numeric" autoComplete="off" /></Field>
        <Field label="IFSC" hint={initial?.bankName ? initial.bankName : "e.g. HDFC0001234"}><input className={inputCls} value={v.bankIfsc} onChange={set("bankIfsc")} autoCapitalize="characters" /></Field>
        <Field label="PAN" hint={initial?.panMasked ? `Saved: ${initial.panMasked}. Leave blank to keep it.` : "For salary tax"}><input className={inputCls} value={v.pan} onChange={set("pan")} autoCapitalize="characters" maxLength={10} autoComplete="off" /></Field>
      </Grid>
      <div><button className={primaryCls} disabled={busy}>{complete ? "Save and continue" : "Save profile"}</button></div>
    </form>
  );
}

export function ProfileScreen({ d }: { d: Data<"profile"> }) {
  const { run, busy, toast } = useRun();
  const [card, setCard] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const p = d.p;
  const pick = (f: File | undefined) => {
    if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 160;
      const s = Math.min(img.width, img.height), ctx = c.getContext("2d")!;
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      run(() => savePhoto(c.toDataURL("image/jpeg", 0.8)));
    };
    img.onerror = () => toast("That file isn’t an image.", "red");
    img.src = url;
  };
  return (
    <>
      <Card pad>
        <div className="flex items-center gap-4 flex-wrap">
          <Avatar name={p.name} photo={p.photo} size={72} />
          <div className="flex-1 min-w-[200px]"><h2 className="text-[20px] font-bold">{p.name}</h2><p className="text-[13px] text-[#64748B]">{p.designation || "—"} · {p.dept || "—"} · {p.empNo}</p><p className="text-[12.5px] text-[#64748B]">{p.email}</p></div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <button className={btnCls} onClick={() => setCard(true)}>ID card</button><button className={btnCls} onClick={() => file.current?.click()}>Change photo</button>{p.photo ? <button className={btnCls} onClick={() => run(() => savePhoto(null))}>Remove</button> : null}
        </div>
        <Grid n={4} className="mt-4">
          <Stat l="Joined" v={p.joinDate ? dayLong(p.joinDate) : "—"} /><Stat l="Type" v={p.empType} /><Stat l="Location" v={p.location || "—"} /><Stat l="Reports to" v={p.manager || "—"} />
        </Grid>
        <p className="text-[12px] text-[#64748B] mt-3">Joining documents {p.docsAccepted ? `accepted on ${dayLabel(p.docsAcceptedAt!)}` : "not yet accepted"} · Authenticator app {p.totp ? "on" : "off"}</p>
      </Card>
      <Card title="My documents" sub="Your offer letter, appointment letter and non-disclosure agreement, written from your HR record" pad><MyLetters /></Card>
      <Card title="Personal & bank details" sub="Only you and HR can see these. Salary is paid to this account." pad><ProfileForm key={JSON.stringify(p)} initial={p} busy={busy} onSave={(v) => run(() => saveProfile(v))} /></Card>
      {card ? <Modal title="Employee ID card" onClose={() => setCard(false)}>
        <div className="print-area mx-auto w-[300px] rounded-2xl overflow-hidden border border-[#CBD5E1] bg-white text-center shadow">
          <div className="bg-[#0B5E5B] text-white py-3"><div className="text-[18px] font-bold">Medoro</div><div className="text-[10px] tracking-[.12em] text-white/70">PHARMACY SOFTWARE</div></div>
          <div className="pt-5 flex justify-center"><Avatar name={p.name} photo={p.photo} size={88} /></div>
          <div className="px-5 pb-5 pt-3"><div className="text-[17px] font-bold">{p.name}</div><div className="text-[12.5px] text-[#64748B]">{p.designation || "—"}{p.dept ? ` · ${p.dept}` : ""}</div>
            <div className="mt-3 inline-block bg-[#D6F3EF] text-[#0B5E5B] font-bold text-[14px] rounded-lg px-3 py-1">{p.empNo}</div>
            <div className="mt-3 text-[11.5px] text-[#475569] leading-5">{p.email}<br />Joined {p.joinDate ? dayLabel(p.joinDate) : "—"}{p.bloodGroup ? ` · Blood group ${p.bloodGroup}` : ""}{p.emergencyPhone ? <><br />Emergency: {p.emergencyName} {p.emergencyPhone}</> : null}</div></div>
          <div className="bg-[#F1F5F9] text-[10px] text-[#64748B] py-1.5">Property of Medoro · medoro.in</div></div>
        <button className={primaryCls} onClick={() => window.print()}>Print ID card</button></Modal> : null}
    </>
  );
}

// ── Home
export function HomeScreen({ d, sh }: { d: Data<"home"> } & P) {
  const [tab, setTab] = useState<"tasks" | "assigned" | "reminders">("tasks");
  const [show, setShow] = useState(false), [rem, setRem] = useState(""), [ann, setAnn] = useState(false), [custom, setCustom] = useState(false), [hid, setHid] = useState<string[]>([]);
  const { run, busy } = useRun();
  // Which home sections to show is a per-person, per-browser choice.
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("hrms.home.hide") ?? "[]"); if (Array.isArray(v)) setHid(v.filter((x) => typeof x === "string")); } catch { /* none saved */ } }, []);
  const toggleSection = (id: string) => setHid((h) => { const n = h.includes(id) ? h.filter((x) => x !== id) : [...h, id]; try { localStorage.setItem("hrms.home.hide", JSON.stringify(n)); } catch { /* private window */ } return n; });
  const open = d.tasks.filter((t) => t.kind === "task" && !t.done), rems = d.tasks.filter((t) => t.kind === "reminder" && !t.done);
  const doneToday = d.tasks.filter((t) => t.kind === "task" && t.done && t.doneAt && t.doneAt.slice(0, 10) === sh.today).length;
  const total = open.length + doneToday;
  const left = (() => { const n = new Date(); const ms = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime(); return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m left`; })();
  return (
    <>
      <div className="flex justify-end -mb-1"><button className={btnCls} onClick={() => setCustom(true)}>⚙️ Customize home</button></div>
      <div className="rounded-[20px] px-8 py-6 text-white flex flex-wrap items-center gap-4" style={{ background: "linear-gradient(135deg,#0B5E5B,#14907F)" }}>
        <div className="flex-1 min-w-[240px]">
          <div className="text-[11px] tracking-[.12em] font-semibold text-white/70 uppercase">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <div className="text-[26px] font-bold mt-1">{new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, {sh.me.first} 👋</div>
          <div className="text-[13px] text-white/80 mt-1.5 max-w-[460px]">Here’s your day at a glance. Helping Indian pharmacies bill faster and waste less stock.</div>
          <div className="flex gap-2 mt-4 flex-wrap"><Link href="/staff/hrms/mytasks" className="bg-white text-[#0B5E5B] px-4 py-2 rounded-[10px] font-semibold text-[13px]">View my tasks</Link><button onClick={() => window.dispatchEvent(new Event("hrms:ally"))} className="bg-white/15 border border-white/30 text-white px-4 py-2 rounded-[10px] font-semibold text-[13px] cursor-pointer">✦ Ask Ally</button></div>
        </div>
        <div className="text-right"><div className="text-[40px] font-bold leading-none" suppressHydrationWarning>{new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div><div className="text-[12px] text-white/70">Local time · India</div></div>
      </div>
      {!hid.includes("today") ? <><Card title="Today" sub="Task-based day · due 11:59 PM" right={<Tabs value={tab} onChange={setTab} options={[["tasks", "Tasks"], ["assigned", `Assigned · ${open.length}`], ["reminders", `Reminders · ${rems.length}`]]} />}>
        <div className="px-5 pb-4">
          {tab === "tasks" ? (
            <div className="flex items-center gap-4 flex-wrap"><div className="flex-1 min-w-[220px]"><div className="font-bold text-[15px]">{doneToday} of {total} tasks done today</div><div className="h-1.5 bg-[#E2E8F0] rounded-full mt-2 overflow-hidden"><div className="h-full bg-[#14B8A6]" style={{ width: `${total ? (doneToday * 100) / total : 0}%` }} /></div><div className="text-[12px] text-[#64748B] mt-1.5">{open.length} remaining · finish before midnight, at your own pace</div></div><div className="text-[24px] font-bold">{left}</div><Link href="/staff/hrms/mytasks" className={primaryCls}>Open my tasks →</Link></div>
          ) : tab === "assigned" ? (open.length ? open.slice(0, 6).map((t) => <div key={t.id} className="flex items-center gap-2.5 py-2 border-t border-[#F1F5F9] first:border-0 text-[13.5px]"><input type="checkbox" aria-label={`Done: ${t.title}`} onChange={() => run(() => setTaskDone(t.id, true))} /><span className="flex-1">{t.title}</span><span className="text-[12px] text-[#64748B]">{t.by ? `by ${t.by}` : ""}{t.due ? ` · due ${dayLabel(t.due)}` : ""}</span></div>) : <Empty>Nothing assigned to you.</Empty>)
            : <div>{rems.map((t) => <div key={t.id} className="flex items-center gap-2.5 py-2 border-t border-[#F1F5F9] first:border-0 text-[13.5px]"><input type="checkbox" aria-label={`Done: ${t.title}`} onChange={() => run(() => setTaskDone(t.id, true))} /><span className="flex-1">{t.title}</span><button className={dangerCls} onClick={() => run(() => deleteTask(t.id))}>Remove</button></div>)}
              <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); if (rem.trim()) run(() => addReminder({ title: rem }), () => { setRem(""); }); }}><input className={inputCls} placeholder="Add a reminder for today" value={rem} onChange={(e) => setRem(e.target.value)} /><button className={primaryCls} disabled={busy}>Add</button></form></div>}
        </div>
      </Card></> : null}
      <Grid n={3}>
      {!hid.includes("leave") ? <><Card title="Leave balance" pad><div className="flex gap-5">{d.bal.filter((b) => b.total > 0).map((b) => <div key={b.id}><div className="text-[22px] font-bold">{b.left}</div><div className="text-[11.5px] text-[#64748B]">{b.label}</div></div>)}</div><Link href="/staff/hrms/leave" className="text-[13px] font-semibold text-[#0B5E5B] mt-3 inline-block">Apply leave →</Link></Card></> : null}
      {!hid.includes("payslip") ? <><Card title="Last payslip" pad>{d.slip ? <><div className="text-[20px] font-bold">{d.slip.label}</div><div className="text-[12px] text-[#64748B]">Credited {d.slip.paidOn ? dayLabel(d.slip.paidOn) : "—"} · <button className="text-[#0B5E5B] font-semibold cursor-pointer bg-transparent border-0 p-0" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"} amount</button></div><div className="text-[18px] font-bold mt-1"><Hide n={d.slip.net} show={show} /></div></> : <div className="text-[13px] text-[#64748B]">No payslip yet.</div>}<Link href="/staff/hrms/payslips" className="text-[13px] font-semibold text-[#0B5E5B] mt-3 inline-block">View payslips →</Link></Card></> : null}
      {!hid.includes("today") ? <Card title="Assigned to me" pad>{open.length ? open.slice(0, 3).map((t) => <div key={t.id} className="text-[13px] py-1 flex gap-2"><span aria-hidden>☐</span>{t.title}</div>) : <div className="text-[12.5px] text-[#64748B] py-1">Nothing assigned right now.</div>}<Link href="/staff/hrms/mytasks" className="inline-block mt-2 text-[12px] text-[#0B5E5B] font-semibold">View my tasks →</Link></Card> : null}
      {!hid.includes("projects") && d.proj.length ? <><Card title="Projects" pad>{d.proj.length ? d.proj.map((p) => <div key={p.id} className="text-[13px] mb-2"><div className="flex justify-between"><strong>{p.name}</strong><span className="text-[#64748B]">{p.progress}%</span></div><div className="h-1.5 bg-[#E2E8F0] rounded-full mt-1"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${p.progress}%` }} /></div></div>) : <div className="text-[13px] text-[#64748B]">You’re not on a project yet.</div>}</Card></> : null}
      </Grid>
      {d.meets.length && !hid.includes("meetings") ? <Card title="Meetings today" pad>{d.meets.map((m) => <div key={m.id} className="flex items-center gap-3 py-1.5 text-[13.5px]"><strong>{timeLabel(m.at)}</strong><span className="flex-1">{m.title}</span>{m.link ? <a className={btnCls} href={m.link} target="_blank" rel="noreferrer">Join</a> : null}</div>)}</Card> : null}
      <Grid n={2}>
      {!hid.includes("announcements") ? <><Card title="Announcements" right={d.canPost ? <button className={btnCls} onClick={() => setAnn(true)}>+ Post</button> : null} pad>
          {d.ann.length ? d.ann.map((a) => <div key={a.id} className="flex gap-3 py-2.5 border-t border-[#F1F5F9] first:border-0"><span className="size-9 rounded-lg border border-[#E2E8F0] flex items-center justify-center">{a.emoji}</span><div className="flex-1"><div className="flex gap-2 text-[13.5px] font-semibold"><span className="flex-1">{a.title}</span><span className="text-[11.5px] font-normal text-[#94A3B8]">{ago(a.at)}</span></div><div className="text-[12.5px] text-[#64748B]">{a.body}</div>{d.canPost ? <button className="text-[11.5px] text-[#B3261E] cursor-pointer bg-transparent border-0 p-0 mt-1" onClick={() => run(() => deleteAnnouncement(a.id))}>Remove</button> : null}</div></div>) : <Empty>No announcements yet.</Empty>}
        </Card></> : null}
      {!hid.includes("holidays") ? <><Card title="Upcoming holidays" pad>{d.hols.length ? d.hols.map((h) => <div key={h.id} className="flex items-center gap-3 py-2 border-t border-[#F1F5F9] first:border-0"><div className="flex-1"><div className="text-[13.5px] font-semibold">{h.name}</div><div className="text-[12px] text-[#64748B]">{h.kind}</div></div><div className="text-right font-bold text-[#0B5E5B]">{dayLabel(h.day)}</div></div>) : <Empty>HR hasn’t added holidays yet.</Empty>}</Card></> : null}
      </Grid>
      {custom ? <Modal title="Customize home" onClose={() => setCustom(false)}><p className="text-[13px] text-[#64748B]">Choose what shows on your home screen. This is saved in this browser.</p>
        {[["today", "Today and tasks"], ["leave", "Leave balance"], ["payslip", "Last payslip"], ["projects", "Projects"], ["meetings", "Meetings today"], ["announcements", "Announcements"], ["holidays", "Upcoming holidays"]].map(([id, label]) => <label key={id} className="flex items-center gap-2 text-[13.5px] py-1 cursor-pointer"><input type="checkbox" checked={!hid.includes(id)} onChange={() => toggleSection(id)} />{label}</label>)}</Modal> : null}
      {ann ? <AnnounceModal onClose={() => setAnn(false)} /> : null}
    </>
  );
}
export function AnnounceModal({ onClose }: { onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ emoji: "📢", title: "", body: "" });
  return <Modal title="Post an announcement" onClose={onClose}>
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => postAnnouncement(v), () => { onClose(); }); }}>
      <div className="flex gap-2"><input className={cx(inputCls, "!w-16 text-center")} value={v.emoji} onChange={(e) => setV({ ...v, emoji: e.target.value })} maxLength={4} aria-label="Emoji" /><input className={inputCls} placeholder="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required /></div>
      <textarea className={inputCls} rows={3} placeholder="What should everyone know?" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} required />
      <button className={primaryCls} disabled={busy}>Post to everyone</button>
    </form></Modal>;
}

// ── My tasks (with a board for projects)
export function MyTasksScreen({ d }: { d: Data<"mytasks"> }) {
  const { run, busy } = useRun();
  const [done, setDone] = useState<string | null>(null), [comment, setComment] = useState("");
  const open = d.tasks.filter((t) => !t.done), fin = d.tasks.filter((t) => t.done);
  const [rem, setRem] = useState("");
  return (
    <>
      <Card title={`Tasks assigned to me · ${open.filter((t) => t.kind === "task").length} open`} pad>
        {open.length ? open.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 mb-2">
            <input type="checkbox" aria-label={`Mark done: ${t.title}`} onChange={() => (t.kind === "task" ? (setDone(t.id), setComment("")) : run(() => setTaskDone(t.id, true)))} />
            <div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold">{t.title}</div><div className="text-[12px] text-[#64748B]">{t.kind === "reminder" ? "Reminder" : `Assigned by ${t.by}`}{t.due ? ` · due ${dayLabel(t.due)}` : ""}{t.project ? ` · ${t.project}` : ""}</div></div>
            {t.overdue ? <Pill tone="red">Overdue</Pill> : null}<Pill tone={t.priority === "High" ? "red" : t.priority === "Medium" ? "amber" : "gray"}>{t.priority}</Pill>
            {t.projectId ? <select className="border border-[#CDD2D7] rounded-lg px-2 py-1 text-[12px]" value={t.col} onChange={(e) => run(() => moveTask(t.id, e.target.value))} aria-label="Board column">{BOARD_COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select> : null}
          </div>
        )) : <Empty>Nothing waiting. Enjoy the quiet.</Empty>}
        <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); if (rem.trim()) run(() => addReminder({ title: rem }), () => { setRem(""); }); }}><input className={inputCls} placeholder="Add a personal reminder" value={rem} onChange={(e) => setRem(e.target.value)} /><button className={btnCls} disabled={busy}>Add</button></form>
      </Card>
      {fin.length ? <Card title="Finished in the last 2 weeks" pad>{fin.map((t) => <div key={t.id} className="flex items-center gap-3 py-1.5 text-[13px] text-[#64748B] border-t border-[#F1F5F9] first:border-0"><span className="flex-1 line-through">{t.title}</span>{t.comment ? <em className="text-[12px]">{t.comment}</em> : null}<button className={btnCls} onClick={() => run(() => setTaskDone(t.id, false))}>Reopen</button></div>)}</Card> : null}
      {done ? <Modal title="Mark task done" onClose={() => setDone(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => setTaskDone(done, true, comment), () => { setDone(null); }); }}><Field label="Any comment for whoever assigned it? (optional)"><textarea className={inputCls} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field><button className={primaryCls} disabled={busy}>Done</button></form></Modal> : null}
    </>
  );
}

// ── Calendar
export function CalendarScreen({ d, sh }: { d: Data<"calendar"> } & P) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [sel, setSel] = useState<string | null>(null), [meet, setMeet] = useState(false), [notes, setNotes] = useState<{ id: string; text: string } | null>(null), [hol, setHol] = useState({ day: "", name: "" });
  const [y, m] = d.month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = first.getUTCDay();
  const nav = (n: number) => { const t = new Date(Date.UTC(y, m - 1 + n, 1)); router.push(`/staff/hrms/calendar?m=${t.toISOString().slice(0, 7)}`); };
  const cells = Array.from({ length: lead + dim }, (_, i) => (i < lead ? null : `${d.month}-${String(i - lead + 1).padStart(2, "0")}`));
  const ist = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  // A Google event belongs to every day it covers (all-day ends are exclusive).
  const gOn = (day: string) => d.google.events.filter((e) => (e.allDay ? e.start.slice(0, 10) <= day && day < e.end.slice(0, 10) : ist(e.start) <= day && day <= ist(e.end)));
  const on = (day: string) => ({ h: d.hols.find((x) => x.day === day), o: d.out.filter((x) => x.from <= day && x.to >= day), mt: d.meets.filter((x) => x.at.slice(0, 10) === day || ist(x.at) === day), g: gOn(day) });
  const dayInfo = sel ? on(sel) : null;
  return (
    <>
      <Card title={first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} right={<><button className={btnCls} onClick={() => nav(-1)} aria-label="Previous month">‹</button><button className={btnCls} onClick={() => nav(1)} aria-label="Next month">›</button><button className={primaryCls} onClick={() => setMeet(true)}>+ Schedule meeting</button></>} pad>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[#64748B] mb-1">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => <div key={x}>{x}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => { if (!day) return <div key={i} />; const { h, o, mt, g } = on(day), wk = [0, 6].includes(new Date(day + "T00:00:00Z").getUTCDay());
            return <button key={day} onClick={() => setSel(day)} className={cx("min-h-[64px] rounded-lg border text-left p-1.5 cursor-pointer text-[12px] flex flex-col gap-0.5", h ? "bg-[#FFFBEB] border-[#FCD34D]" : wk ? "bg-[#F8FAFC] border-[#F1F5F9] text-[#94A3B8]" : "bg-white border-[#F1F5F9]", day === sh.today && "outline outline-2 outline-[#14B8A6] -outline-offset-2")}>
              <span className="font-semibold">{Number(day.slice(8))}</span>{h ? <span className="text-[10px] text-[#92400E] leading-tight">{h.name}</span> : null}{mt.length ? <span className="text-[10px] text-[#5B45B0]">● {mt.length} meeting{mt.length > 1 ? "s" : ""}</span> : null}{g.length ? <span className="text-[10px] text-[#1A73E8]">▪ {g.length} Google</span> : null}{o.length ? <span className="text-[10px] text-[#B45309]">{o.length} out</span> : null}</button>; })}
        </div>
      </Card>
      <Card title="Google Calendar" sub={d.google.connected ? `Connected as ${d.google.email || "your Google account"}. Your Google events show in the calendar above.` : "Connect your Google account to see your Google Calendar here and send meeting invites with a Google Meet link."} right={d.google.connected ? <button className={dangerCls} disabled={busy} onClick={() => run(() => disconnectGoogle())}>Disconnect</button> : d.google.configured ? <GoogleConnect /> : null} pad>
        {d.google.notice ? <p className="text-[13px] rounded-lg bg-[#F2F9F8] border border-[#CFE6E3] px-3 py-2 mb-2">{d.google.notice}</p> : null}
        {d.google.error ? <p className="text-[13px] rounded-lg bg-[#FEF3C7] text-[#92400E] px-3 py-2 mb-2">{d.google.error}</p> : null}
        {!d.google.configured && !d.google.connected ? <p className="text-[13px] text-[#64748B]">Not set up on this server yet. The super admin needs to add the Google client and enable the Calendar API (see docs/HRMS.md).</p> : null}
        {d.google.connected && !d.google.error ? <p className="text-[12.5px] text-[#64748B]">{d.google.events.length} event{d.google.events.length === 1 ? "" : "s"} this month.</p> : null}
      </Card>
      <Grid n={2}>
        <Card title="Upcoming meetings" pad>{d.upcoming.length ? d.upcoming.map((x) => (
          <div key={x.id} className="py-2 border-t border-[#F1F5F9] first:border-0 text-[13px]"><div className="flex gap-2 items-center"><strong className="flex-1">{x.title}</strong><span className="text-[12px] text-[#64748B]">{dayLabel(x.at)} · {timeLabel(x.at)}</span></div><div className="text-[12px] text-[#64748B]">With {x.attendees.join(", ")}</div>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">{x.link ? <a className={btnCls} href={x.link} target="_blank" rel="noreferrer">Join</a> : null}<button className={btnCls} onClick={() => setNotes({ id: x.id, text: x.notes })}>Minutes</button>{x.mine ? <button className={dangerCls} onClick={() => run(() => cancelMeeting(x.id))}>Cancel</button> : null}</div></div>
        )) : <Empty>No meetings coming up.</Empty>}</Card>
        <Card title="Holidays" right={d.canHolidays ? <button className={btnCls} disabled={busy} onClick={() => run(() => addNationalHolidays(Number(d.month.slice(0, 4))), (r) => (r.festivals ? `${r.added} official holiday${r.added === 1 ? "" : "s"} added. Festival dates follow the moon and can shift by a day: check them.` : `${r.added} fixed-date holiday${r.added === 1 ? "" : "s"} added. Add this year’s festival dates below.`))}>Add official holidays {d.month.slice(0, 4)}</button> : null} pad>
          {d.nextHols.length ? d.nextHols.map((h) => <div key={h.id} className="flex items-center gap-2 py-1.5 text-[13px] border-t border-[#F1F5F9] first:border-0"><span className="flex-1">{h.name}</span><strong className="text-[#0B5E5B]">{dayLabel(h.day)}</strong>{d.canHolidays ? <button className={dangerCls} onClick={() => run(() => removeHoliday(h.id))}>×</button> : null}</div>) : <Empty>No holidays added.</Empty>}
          {d.canHolidays ? <form className="flex gap-2 mt-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => addHoliday(hol), () => { setHol({ day: "", name: "" }); }); }}><input className={cx(inputCls, "!w-40")} type="date" value={hol.day} onChange={(e) => setHol({ ...hol, day: e.target.value })} required /><input className={cx(inputCls, "flex-1 min-w-[140px]")} placeholder="Holiday name" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} required /><button className={primaryCls} disabled={busy}>Add</button></form> : null}</Card>
      </Grid>
      {dayInfo && sel ? <Modal title={dayLong(sel)} onClose={() => setSel(null)}>
        {dayInfo.h ? <p className="text-[13.5px]">🎉 {dayInfo.h.name} · {dayInfo.h.kind}</p> : null}
        {dayInfo.mt.map((x) => <p key={x.id} className="text-[13.5px]">🗓 {timeLabel(x.at)} · {x.title}</p>)}
        {dayInfo.g.map((x) => <p key={x.id} className="text-[13.5px]"><span className="text-[#1A73E8]">G</span> {x.allDay ? "All day" : timeLabel(x.start)} · {x.title}{x.meet ? <> · <a className="text-[#0B5E5B] font-semibold" href={x.meet} target="_blank" rel="noreferrer">Meet</a></> : null}{x.link ? <> · <a className="text-[#0B5E5B] font-semibold" href={x.link} target="_blank" rel="noreferrer">open</a></> : null}</p>)}
        {dayInfo.o.length ? <div><strong className="text-[13px]">Out of office</strong>{dayInfo.o.map((x) => <p key={x.id} className="text-[13px]">{x.name} · {leaveLabel(x.type)}</p>)}</div> : null}
        {!dayInfo.h && !dayInfo.mt.length && !dayInfo.o.length && !dayInfo.g.length ? <p className="text-[13.5px] text-[#64748B]">Nothing on this day.</p> : null}
      </Modal> : null}
      
      {meet ? <MeetingModal people={d.people.filter((p) => p.id !== sh.me.id)} google={d.google.connected} onClose={() => setMeet(false)} /> : null}
      {notes ? <Modal title="Meeting minutes" onClose={() => setNotes(null)}><textarea className={inputCls} rows={8} value={notes.text} onChange={(e) => setNotes({ ...notes, text: e.target.value })} placeholder="Decisions, action items…" /><button className={primaryCls} disabled={busy} onClick={() => run(() => saveMeetingNotes(notes.id, notes.text), () => { setNotes(null); })}>Save minutes</button></Modal> : null}
    </>
  );
}
function MeetingModal({ people, google, onClose }: { people: { id: string; name: string }[]; google: boolean; onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ title: "", day: "", time: "10:00", minutes: 30, link: "", attendees: [] as string[], google: google });
  return <Modal title="Schedule a meeting" onClose={onClose}>
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => scheduleMeeting(v), (r) => { onClose(); return r.google === "added" ? "Meeting scheduled and added to Google Calendar. Invitations were sent." : r.google === "failed" ? "Meeting scheduled, but it couldn’t be added to Google Calendar. Try Disconnect and Connect again." : "Meeting scheduled. Attendees were notified."; }); }}>
      <Field label="Title"><input className={inputCls} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required /></Field>
      <div className="grid grid-cols-3 gap-2"><Field label="Date"><input className={inputCls} type="date" value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })} required /></Field><Field label="Time (IST)"><input className={inputCls} type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} required /></Field><Field label="Minutes"><input className={inputCls} type="number" min={5} value={v.minutes} onChange={(e) => setV({ ...v, minutes: Number(e.target.value) })} /></Field></div>
      <Field label="Meeting link (optional)"><input className={inputCls} value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} placeholder="https://meet.google.com/…" /></Field>
      <Field label="Who should join?"><select multiple className={cx(inputCls, "h-32")} value={v.attendees} onChange={(e) => setV({ ...v, attendees: [...e.target.selectedOptions].map((o) => o.value) })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      {google ? <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.google} onChange={(e) => setV({ ...v, google: e.target.checked })} />Add to my Google Calendar, create a Meet link and email invitations</label> : null}
      <button className={primaryCls} disabled={busy}>Schedule</button>
    </form></Modal>;
}

// ── Attendance
const CELL: Record<string, string> = { present: "bg-[#D6F3EF] text-[#0B5E5B] border-[#A8E4DC]", late: "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]", absent: "bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]", leave: "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]", holiday: "bg-[#FFFBEB] text-[#92400E] border-[#FCD34D]", weekend: "bg-[#F8FAFC] text-[#94A3B8] border-[#F1F5F9]", upcoming: "bg-white text-[#CBD5E1] border-[#F1F5F9]", today: "bg-white text-[#0f172a] border-[#14B8A6]", before: "bg-[#F8FAFC] text-[#CBD5E1] border-[#F1F5F9]" };
export function AttendanceScreen({ d, sh }: { d: Data<"attendance"> } & P) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [shot, setShot] = useState<"in" | "out" | null>(null);
  const [sel, setSel] = useState<Data<"attendance">["cells"][number] | null>(null), [reason, setReason] = useState(""), [corr, setCorr] = useState<{ day: string; reason: string } | null>(null);
  const lead = new Date(d.cells[0].day + "T00:00:00Z").getUTCDay();
  const doIn = (selfie?: string) => run(() => checkIn(selfie), (x) => { setShot(null); return x.status === "late" ? `Checked in (late: after ${d.lateAfter}).` : "Checked in. Have a great day."; });
  const label = new Date(d.ym + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const inn = sh.att.inAt, out = sh.att.outAt;
  return (
    <>
      <Card pad>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[220px]"><div className="text-[11px] tracking-[.1em] font-semibold text-[#64748B]">TODAY</div><div className="flex gap-8 mt-1 text-[13px]"><span>Check-in<br /><strong className="text-[16px]">{inn ? timeLabel(inn) : "—"}</strong></span><span>Check-out<br /><strong className="text-[16px]">{out ? timeLabel(out) : "—"}</strong></span></div></div>
          {!d.checkin ? <Pill tone="gray">Check-in is switched off by the super admin</Pill> : null}
          {d.checkin ? <button className="border border-[#0B5E5B] text-[#0B5E5B] bg-white rounded-xl px-4 py-3 text-[12.5px] font-semibold cursor-pointer hover:bg-[#F0FDFA]" onClick={() => setCorr({ day: d.cells.filter((c) => c.day < sh.today).at(-1)?.day ?? sh.today, reason: "" })}>Request correction</button> : null}
          {d.checkin && !inn ? <button disabled={busy} onClick={() => (d.selfie ? setShot("in") : doIn())} className="size-[84px] rounded-full bg-[#0B5E5B] text-white font-bold cursor-pointer border-0 disabled:opacity-60">Check in</button> : null}
          {d.checkin && inn && !out ? <button disabled={busy} onClick={() => (d.selfie ? setShot("out") : run(() => checkOut()))} className="size-[84px] rounded-full bg-[#B45309] text-white font-bold cursor-pointer border-0 disabled:opacity-60">Check out</button> : null}
        </div>
      </Card>
      {d.selfie || d.monitor ? <Card pad><p className="text-[12.5px] text-[#475569]">{d.selfie ? "📷 Selfie check-in is on: you take a photo when you check in and out. It is kept for 30 days and only you and HR can see it. " : ""}{d.monitor ? `⏱ Idle-time tracking is on: while you are checked in and not on a break, inactivity in this HRMS tab of ${d.monitor}+ minutes is recorded. Nothing you type is captured, and no other app or window is watched.` : ""}</p></Card> : null}
      <Grid n={5}><Stat l="Present" v={d.counts.present} /><Stat l="Late" v={d.counts.late} c="#B45309" /><Stat l="Absent" v={d.counts.absent} c="#DC2626" /><Stat l="Holidays" v={d.counts.holidays} c="#92400E" /><Stat l="Overtime" v={`${Math.floor(d.counts.overtimeMin / 60)}h`} c="#0f172a" /></Grid>
      <Card title={<span className="flex items-center gap-3"><button className={btnCls} aria-label="Previous month" onClick={() => router.push(`/staff/hrms/attendance?m=${d.prev}`)}>‹</button>{label}<button className={btnCls} aria-label="Next month" disabled={d.isCurrent} onClick={() => router.push(`/staff/hrms/attendance?m=${d.next}`)}>›</button></span>} right={<div className="flex gap-3 flex-wrap text-[11px] text-[#475569]">{[["present", "Present", "#14B8A6"], ["late", "Late", "#F59E0B"], ["absent", "Absent", "#DC2626"], ["leave", "Leave", "#3B82F6"], ["holiday", "Holiday", "#D97706"], ["weekend", "Weekend", "#64748B"]].map(([k, l, c]) => <span key={k} className="flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: c }} />{l}</span>)}</div>} pad>
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-[#64748B] mb-1.5">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => <div key={x}>{x}</div>)}</div>
        <div className="grid grid-cols-7 gap-1.5">{Array.from({ length: lead }, (_, i) => <div key={"e" + i} />)}{d.cells.map((c) => <button key={c.day} title={c.label} onClick={() => { setSel(c); setReason(""); }} className={cx("border rounded-lg py-2.5 text-[12.5px] font-semibold cursor-pointer", CELL[c.kind], c.day === sh.today && "outline outline-2 outline-[#14B8A6] -outline-offset-2")}>{Number(c.day.slice(8))}</button>)}</div>
      </Card>
      {corr ? <Modal title="Request an attendance correction" onClose={() => setCorr(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => requestCorrection({ day: corr.day, reason: corr.reason }), () => { setCorr(null); }); }}>
          <Field label="Which day?"><input className={inputCls} type="date" max={sh.today} value={corr.day} onChange={(e) => setCorr({ ...corr, day: e.target.value })} required /></Field>
          <Field label="What should HR correct?"><textarea className={inputCls} rows={3} value={corr.reason} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} placeholder="e.g. I forgot to check in; I was at the client site." required /></Field>
          <button className={primaryCls} disabled={busy}>Send to HR</button>
        </form>
      </Modal> : null}
      {shot ? <SelfieModal title={shot === "in" ? "Check in: take a selfie" : "Check out: take a selfie"} busy={busy} onClose={() => setShot(null)} onDone={(img) => (shot === "in" ? doIn(img) : run(() => checkOut(img), () => { setShot(null); }))} /> : null}
      {sel ? <Modal title={dayLong(sel.day)} onClose={() => setSel(null)}>
        <p className="text-[14px]">{sel.label}</p>
        {d.selfies[sel.day] ? <div className="flex gap-3">{(["in", "out"] as const).map((k) => (d.selfies[sel.day][k] ? <Selfie key={k} id={d.selfies[sel.day][k]!} label={`Check-${k}`} /> : null))}</div> : null}
        {sel.correctable ? <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => requestCorrection({ day: sel.day, reason }), () => { setSel(null); }); }}><Field label="Ask HR to correct this day"><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to check in, I was at the pharmacy site" required minLength={5} /></Field><button className={primaryCls} disabled={busy}>Request correction</button></form> : null}
      </Modal> : null}
    </>
  );
}

// ── Leave & claims
export function LeaveScreen({ d }: { d: Data<"leave"> }) {
  const { run, busy, toast } = useRun();
  const [form, setForm] = useState(false), [v, setV] = useState({ type: "casual", from: "", to: "", reason: "" });
  const [claim, setClaim] = useState({ type: CLAIM_TYPES[0] as string, amount: "", note: "" });
  const bill = useRef<HTMLInputElement>(null);
  const sendClaim = (e: React.FormEvent) => {
    e.preventDefault();
    const f = new FormData(); f.set("type", claim.type); f.set("amount", claim.amount); f.set("note", claim.note);
    const file = bill.current?.files?.[0]; if (file) f.set("bill", file);
    run(() => submitClaim(f), () => { setClaim({ ...claim, amount: "", note: "" }); if (bill.current) bill.current.value = ""; });
  };
  return (
    <>
      <Grid n={4}>{d.bal.map((b) => <Stat key={b.id} l={b.label} v={b.left} sub={`days left of ${b.total}${b.pending ? ` · ${b.pending} pending` : ""}`} />)}</Grid>
      <Grid n={2}>
        <Card title="My requests" right={<button className={primaryCls} onClick={() => setForm(true)}>+ Apply leave</button>}>
          <Table head={["Type", "Dates", "Days", "Status", ""]} empty={d.mine.length ? undefined : "No leave requests yet."}>
            {d.mine.map((l) => <tr key={l.id}><td className={tdCls}>{leaveLabel(l.type)}</td><td className={tdCls}>{dayLabel(l.from)}{l.to !== l.from ? ` – ${dayLabel(l.to)}` : ""}</td><td className={tdCls}>{l.days}</td><td className={tdCls}><Pill tone={statusTone(l.status)}>{l.status}</Pill></td><td className={tdCls}>{l.canCancel ? <button className={dangerCls} onClick={() => run(() => cancelLeave(l.id))}>Cancel</button> : null}</td></tr>)}
          </Table>
        </Card>
        <Card title="Who’s out" sub="Next 2 weeks" pad>{d.out.length ? d.out.map((o) => <div key={o.id} className="flex items-center gap-2.5 py-1.5 text-[13px]"><Avatar name={o.name} size={28} /><span className="flex-1"><strong>{o.name}</strong><br /><span className="text-[12px] text-[#64748B]">{dayLabel(o.from)}{o.to !== o.from ? ` – ${dayLabel(o.to)}` : ""} · {leaveLabel(o.type)}</span></span></div>) : <Empty>Everyone is in.</Empty>}</Card>
      </Grid>
      <Card title="Reimbursement & approvals" sub="HR reviews, the super admin gives the final sign-off, then it is paid with your salary." pad>
        <form className="flex gap-2 flex-wrap items-end" onSubmit={sendClaim}>
          <Field label="Type"><select className={inputCls} value={claim.type} onChange={(e) => setClaim({ ...claim, type: e.target.value })}>{CLAIM_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Amount (₹)"><input className={cx(inputCls, "!w-32")} inputMode="numeric" value={claim.amount} onChange={(e) => setClaim({ ...claim, amount: e.target.value.replace(/\D/g, "") })} required /></Field>
          <Field label="Note"><input className={cx(inputCls, "!w-56")} value={claim.note} onChange={(e) => setClaim({ ...claim, note: e.target.value })} /></Field>
          <Field label="Bill (PDF, JPG, PNG)"><input ref={bill} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-[12.5px]" /></Field>
          <button className={primaryCls} disabled={busy}>Submit claim</button>
        </form>
        {d.claims.length ? <div className="mt-4"><Table head={["Date", "Type", "Amount", "Note", "Bill", "Status"]}>{d.claims.map((c) => <tr key={c.id}><td className={tdCls}>{dayLabel(c.at)}</td><td className={tdCls}>{c.type}</td><td className={tdCls}>{inr(c.amount)}</td><td className={tdCls}>{c.note}</td><td className={tdCls}>{c.hasBill ? <a className="text-[#0B5E5B] font-semibold" href={`/staff/hrms/bill/${c.id}`} target="_blank" rel="noreferrer">view</a> : "—"}</td><td className={tdCls}><Pill tone={statusTone(c.status)}>{CLAIM_STATUS[c.status]}{c.paidMonth ? ` · paid ${c.paidMonth}` : ""}</Pill></td></tr>)}</Table></div> : null}
      </Card>
      {form ? <Modal title="Apply for leave" onClose={() => setForm(false)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!v.from || !v.to) return toast("Pick both dates.", "red"); run(() => applyLeave(v), (days) => { setForm(false); return `Leave requested for ${days} day${days > 1 ? "s" : ""}. HR will decide.`; }); }}>
          <Field label="Type"><select className={inputCls} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{LEAVE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="From"><input className={inputCls} type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: v.to && v.to >= e.target.value ? v.to : e.target.value })} required /></Field><Field label="To"><input className={inputCls} type="date" min={v.from} value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} required /></Field></div>
          <Field label="Reason"><textarea className={inputCls} rows={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
          <p className="text-[12px] text-[#64748B]">Weekends and holidays aren’t counted.</p>
          <button className={primaryCls} disabled={busy}>Send request</button>
        </form></Modal> : null}
    </>
  );
}

// ── Payslips (printable)
type Slip = NonNullable<Extract<Awaited<ReturnType<typeof openPayslip>>, { ok: true }>["data"]>;
export function PayslipView({ s }: { s: Slip }) {
  const rows: [string, number][] = [["Basic", s.basic], ["House rent allowance", s.hra], ["Special allowance", s.special], ["Incentive", s.incentive]];
  const ded: [string, number][] = [["Provident fund", s.pf], ["ESI", s.esi], ["Professional tax", s.pt], ["Income tax (TDS)", s.tds], ["Loss of pay", s.lop]];
  return (
    <div id="payslip" className="print-area bg-white text-[#0f172a] text-[12.5px] p-6 border border-[#E2E8F0] rounded-xl">
      <div className="flex justify-between border-b border-[#E2E8F0] pb-3"><div><div className="text-[18px] font-bold">{s.company.name}</div><div className="text-[#64748B] whitespace-pre-line">{s.company.address}</div></div><div className="text-right"><div className="font-bold">Payslip · {s.label}</div>{s.paidOn ? <div className="text-[#64748B]">Paid {dayLabel(s.paidOn)}</div> : null}</div></div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 py-3 border-b border-[#E2E8F0]">{[["Employee", s.emp.name], ["Employee ID", s.emp.empNo], ["Designation", s.emp.designation || "—"], ["Department", s.emp.dept || "—"], ["Date of joining", s.emp.joinDate ? dayLabel(s.emp.joinDate) : "—"], ["PAN", s.emp.pan || "—"], ["UAN", s.emp.uan || "—"], ["Bank", s.emp.bank || "—"], ["Paid days", `${s.workDays - s.lopDays} of ${s.workDays}`], ["Loss-of-pay days", String(s.lopDays)]].map(([k, v]) => <div key={k} className="flex justify-between gap-2"><span className="text-[#64748B]">{k}</span><strong>{v}</strong></div>)}</div>
      <div className="grid grid-cols-2 gap-6 py-3"><div><div className="font-bold mb-1">Earnings</div>{rows.map(([k, n]) => <div key={k} className="flex justify-between py-0.5"><span>{k}</span><span>{inr(n)}</span></div>)}<div className="flex justify-between border-t border-[#E2E8F0] mt-1 pt-1 font-bold"><span>Gross</span><span>{inr(s.gross)}</span></div></div><div><div className="font-bold mb-1">Deductions</div>{ded.map(([k, n]) => <div key={k} className="flex justify-between py-0.5"><span>{k}</span><span>{inr(n)}</span></div>)}{s.reimburse ? <div className="flex justify-between py-0.5 text-[#0B5E5B]"><span>Reimbursements (added)</span><span>+{inr(s.reimburse)}</span></div> : null}</div></div>
      <div className="flex justify-between bg-[#D6F3EF] rounded-lg px-4 py-3 text-[15px] font-bold text-[#0B5E5B]"><span>Net pay</span><span>{inr(s.net)}</span></div>
      <p className="text-[11px] text-[#94A3B8] mt-3">This is a computer-generated payslip. Tax shown is an estimate under the new regime.</p>
    </div>
  );
}
export function PayslipsScreen({ d }: { d: Data<"payslips"> }) {
  const { run } = useRun();
  const [show, setShow] = useState(false), [slip, setSlip] = useState<Slip | null>(null), [q, setQ] = useState("");
  const total = d.slips.reduce((a, s) => a + s.net, 0), tds = d.slips.reduce((a, s) => a + s.tds, 0);
  const view = (id: string, print = false) => run(() => openPayslip(id), (s) => { setSlip(s); if (print) setTimeout(() => window.print(), 250); });
  const list = d.slips.filter((s) => s.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Grid n={4}><Stat l="Latest net pay" v={d.slips[0] ? <Hide n={d.slips[0].net} show={show} /> : "—"} sub={d.slips[0]?.label} /><Stat l="Payslips" v={d.slips.length} c="#0f172a" /><Stat l="Net paid so far" v={<Hide n={total} show={show} />} /><Stat l="TDS deducted" v={<Hide n={tds} show={show} />} c="#0f172a" /></Grid>
      <Card title="Salary history" right={<><input className={cx(inputCls, "!w-44")} placeholder="Search month…" value={q} onChange={(e) => setQ(e.target.value)} /><button className={btnCls} onClick={() => setShow(!show)}>{show ? "Hide amounts" : "Show amounts"}</button></>}>
        <Table head={["Month", "Paid on", "Net pay", ""]} empty={list.length ? undefined : "No payslips yet. They appear here once payroll is processed."}>
          {list.map((s) => <tr key={s.id}><td className={tdCls}><strong>{s.label}</strong></td><td className={tdCls}>{s.paidOn ? dayLabel(s.paidOn) : "—"}</td><td className={tdCls}><Hide n={s.net} show={show} /></td><td className={tdCls}><div className="flex gap-1.5"><button className={btnCls} onClick={() => view(s.id)}>View</button><button className={btnCls} onClick={() => view(s.id, true)}>↓ PDF</button></div></td></tr>)}
        </Table>
      </Card>
      {slip ? <Modal title={`Payslip · ${slip.label}`} onClose={() => setSlip(null)} wide><PayslipView s={slip} /><div className="flex gap-2 print:hidden"><button className={primaryCls} onClick={() => window.print()}>Print / save as PDF</button></div></Modal> : null}
    </>
  );
}

// ── Work at Medoro, Support
export function JobsScreen({ d }: { d: Data<"jobs"> }) {
  const { run, busy } = useRun();
  const [ref, setRef] = useState<{ id: string; title: string } | null>(null), [v, setV] = useState({ name: "", email: "", phone: "", note: "" });
  return (
    <>
      <Card title={`Open roles · ${d.jobs.length}`} sub="Know someone great? Refer them. HR gets it straight away." pad>
        {d.jobs.length ? d.jobs.map((j) => <div key={j.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-4 py-3 mb-2"><div className="flex-1"><strong className="text-[14px]">{j.title}</strong><div className="text-[12px] text-[#64748B]">{j.dept} · {j.location} · {j.type}</div></div><button className={btnCls} onClick={() => { setRef({ id: j.id, title: j.title }); setV({ name: "", email: "", phone: "", note: "" }); }}>Refer someone</button></div>) : <Empty>No open roles right now.</Empty>}
      </Card>
      {ref ? <Modal title={`Refer someone for ${ref.title}`} onClose={() => setRef(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => referCandidate({ jobId: ref.id, ...v }), () => { setRef(null); }); }}>
          <Field label="Name"><input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Email"><input className={inputCls} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field><Field label="Phone"><input className={inputCls} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field></div>
          <Field label="Why are they a good fit?"><textarea className={inputCls} rows={3} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <button className={primaryCls} disabled={busy}>Send referral</button>
        </form></Modal> : null}
    </>
  );
}
export function SupportScreen({ d }: { d: Data<"support"> }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ category: TICKET_TOPICS[0] as string, subject: "", body: "" }), [reply, setReply] = useState<Record<string, string>>({});
  return (
    <>
      <Card title="Raise a ticket" sub="HR replies here and notifies you." pad>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => raiseTicket(v), (code) => { setV({ ...v, subject: "", body: "" }); return `Ticket ${code} raised.`; }); }}>
          <div className="grid grid-cols-[180px_1fr] gap-2 max-[600px]:grid-cols-1"><Field label="Topic"><select className={inputCls} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{TICKET_TOPICS.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Subject"><input className={inputCls} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} required /></Field></div>
          <Field label="What’s the problem?"><textarea className={inputCls} rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} required /></Field>
          <div><button className={primaryCls} disabled={busy}>Raise ticket</button></div>
        </form>
      </Card>
      <Card title={d.canResolve ? "All tickets" : "My tickets"} pad>
        {d.tickets.length ? d.tickets.map((t) => (
          <div key={t.id} className="border border-[#E2E8F0] rounded-xl p-3.5 mb-2 text-[13px]">
            <div className="flex gap-2 items-center flex-wrap"><strong>{t.code}</strong><span className="flex-1">{t.subject}</span><Pill tone="gray">{t.category}</Pill><Pill tone={statusTone(t.status)}>{t.status}</Pill></div>
            <div className="text-[12px] text-[#64748B] mt-1">{d.canResolve ? `${t.by} · ` : ""}{ago(t.at)}</div><p className="mt-1.5">{t.body}</p>
            {t.reply ? <p className="mt-2 bg-[#F2F9F8] rounded-lg px-3 py-2"><strong>HR:</strong> {t.reply}</p> : null}
            {d.canResolve && t.status === "open" ? <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); run(() => resolveTicket(t.id, reply[t.id] ?? "")); }}><input className={inputCls} placeholder="Reply and resolve" value={reply[t.id] ?? ""} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} /><button className={primaryCls} disabled={busy}>Resolve</button></form> : null}
          </div>
        )) : <Empty>No tickets.</Empty>}
      </Card>
    </>
  );
}


// ── My Projects
export function MyProjectsScreen({ d }: { d: Data<"myprojects"> }) {
  const { run } = useRun();
  return d.projects.length ? <>{d.projects.map((p) => (
    <Card key={p.id} pad>
      <div className="flex items-center gap-3 flex-wrap"><div className="flex-1 min-w-[220px]"><h3 className="text-[16px] font-bold">{p.name}</h3><p className="text-[12.5px] text-[#64748B]">{p.client} · Lead: {p.lead || "—"} · {p.deadline ? `Deadline ${dayLabel(p.deadline)}` : "No deadline"} · Team: {p.team.join(", ")}</p></div><Pill tone={statusTone(p.status)}>{p.status}</Pill><div className="w-40"><div className="h-2 bg-[#E2E8F0] rounded-full"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${p.progress}%` }} /></div><div className="text-[11.5px] text-[#64748B] mt-1">{p.progress}% done</div></div></div>
      <div className="mt-3 text-[12px] font-semibold text-[#64748B] uppercase tracking-wide">Your tasks</div>
      {p.mine.length ? p.mine.map((t) => <div key={t.id} className="flex items-center gap-3 py-2 border-t border-[#F1F5F9] text-[13.5px]"><input type="checkbox" checked={t.done} aria-label={`Done: ${t.title}`} onChange={(e) => run(() => setTaskDone(t.id, e.target.checked))} /><span className={cx("flex-1", t.done && "line-through text-[#94A3B8]")}>{t.title}</span>{t.overdue ? <Pill tone="red">Overdue</Pill> : null}{t.due ? <span className="text-[12px] text-[#64748B]">due {dayLabel(t.due)}</span> : null}<select aria-label={`Stage of ${t.title}`} className="border border-[#CDD2D7] rounded px-1 py-1 text-[12px] bg-white" value={t.col} onChange={(e) => run(() => moveTask(t.id, e.target.value))}>{BOARD_COLS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>) : <p className="text-[13px] text-[#64748B] py-2">No tasks for you here yet.</p>}
      {p.others ? <p className="text-[12px] text-[#94A3B8] mt-1">{p.others} more task{p.others > 1 ? "s" : ""} assigned to teammates.</p> : null}
    </Card>))}</> : <Card pad><Empty>You’re not on any project yet. HR adds people to projects.</Empty></Card>;
}

// ── Assets
const ASSET_ST: Record<string, [string, "green" | "amber" | "red" | "gray"]> = { in_use: ["In use", "green"], in_stock: ["In stock", "gray"], repair: ["In repair", "amber"], lost: ["Lost", "red"] };
const ASSET_ICON: Record<string, string> = { Laptop: "💻", Monitor: "🖥", Phone: "📱", "Access card": "🪪", "Keyboard & mouse": "⌨️", Headset: "🎧", Other: "📦" };
export function AssetsScreen({ d }: { d: Data<"assets"> }) {
  const { run, busy } = useRun();
  const [issue, setIssue] = useState<{ id: string; name: string } | null>(null), [note, setNote] = useState("");
  const [f, setF] = useState({ name: "", kind: ASSET_KINDS[0] as string, assigneeId: "", note: "" }), [q, setQ] = useState(""), [give, setGive] = useState<{ id: string; name: string; who: string } | null>(null);
  const all = d.all?.filter((a) => `${a.tag} ${a.name} ${a.assignee}`.toLowerCase().includes(q.toLowerCase()));
  return <>
    <Card title="Assets assigned to me" pad>{d.mine.length ? d.mine.map((a) => (
      <div key={a.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 mb-2"><span className="size-10 rounded-lg bg-[#F1F5F9] flex items-center justify-center text-[18px]">{ASSET_ICON[a.kind] ?? "📦"}</span><div className="flex-1"><div className="text-[13.5px] font-semibold">{a.name}</div><div className="text-[12px] text-[#64748B]">{a.tag}{a.issuedOn ? ` · issued ${dayLabel(a.issuedOn)}` : ""}</div></div>
        <Pill tone={ASSET_ST[a.status]?.[1] ?? "gray"}>{ASSET_ST[a.status]?.[0] ?? a.status}</Pill><button className={btnCls} onClick={() => { setIssue({ id: a.id, name: a.name }); setNote(""); }}>Report issue</button></div>)) : <Empty>Nothing is assigned to you yet.</Empty>}</Card>
    {d.all ? <>
      <Card title="Add an item" sub="Leave “Issue to” empty to keep it in stock" pad><form className="flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); run(() => addAsset({ name: f.name, kind: f.kind as "Laptop", note: f.note, assigneeId: f.assigneeId || null }), (tag) => { setF({ ...f, name: "", note: "" }); return `${tag} added.`; }); }}>
        <Field label="Item"><input className={cx(inputCls, "!w-64")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="MacBook Pro 14 inch" required /></Field>
        <Field label="Type"><select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{ASSET_KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Issue to"><select className={inputCls} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}><option value="">In stock</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Note"><input className={cx(inputCls, "!w-52")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field><button className={primaryCls} disabled={busy}>Add</button></form></Card>
      <Card title={`Asset register · ${d.all.length}`} right={<input className={cx(inputCls, "!w-52")} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <Table head={["Tag", "Item", "With", "Status", ""]} empty={all?.length ? undefined : "No items yet."}>
          {all?.map((a) => <tr key={a.id}><td className={tdCls}>{a.tag}</td><td className={tdCls}><strong>{a.name}</strong><div className="text-[11.5px] text-[#94A3B8]">{a.kind}{a.note ? ` · ${a.note}` : ""}</div></td><td className={tdCls}>{a.assignee || "—"}{a.issuedOn ? <div className="text-[11.5px] text-[#94A3B8]">since {dayLabel(a.issuedOn)}</div> : null}</td>
            <td className={tdCls}><select aria-label={`Status of ${a.tag}`} className="border border-[#CDD2D7] rounded px-1 py-1 text-[12px] bg-white" value={a.status} onChange={(e) => run(() => setAssetStatus(a.id, e.target.value))}>{Object.entries(ASSET_ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></td>
            <td className={tdCls}>{a.assigneeId ? <button className={btnCls} onClick={() => run(() => returnAsset(a.id))}>Take back</button> : a.status !== "lost" ? <button className={btnCls} onClick={() => setGive({ id: a.id, name: a.name, who: "" })}>Issue</button> : null}</td></tr>)}
        </Table></Card></> : null}
    {issue ? <Modal title={`Report an issue · ${issue.name}`} onClose={() => setIssue(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => reportAssetIssue(issue.id, note), (code) => { setIssue(null); return `Ticket ${code} raised for HR.`; }); }}><Field label="What is wrong?"><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} /></Field><button className={primaryCls} disabled={busy}>Send to HR</button></form></Modal> : null}
    {give && d.all ? <Modal title={`Issue ${give.name}`} onClose={() => setGive(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => issueAsset(give.id, give.who), () => { setGive(null); }); }}><Field label="To"><select className={inputCls} value={give.who} onChange={(e) => setGive({ ...give, who: e.target.value })} required><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><button className={primaryCls} disabled={busy}>Issue</button></form></Modal> : null}
  </>;
}
