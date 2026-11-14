"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Shell, ScreenId } from "@/staff/hrms/screens";
import { HR_ROLE_LABEL, NO_TITLE_SCREENS, ONBOARD_STEPS, BREAKS, toMin } from "@/staff/hrms/constants";
import { JOINING_LETTERS, letterLabel, type LetterType } from "@/staff/hrms/letters";
import { acceptDocuments, askAlly, endBreak, getLetter, hrChangePassword, hrSignOut, openStaffConsole, readNotifications, saveProfile, startBreak } from "../actions";
import { Avatar, Card, Field, Modal, ago, btnCls, cx, inputCls, presenceColor, primaryCls, useRun } from "./kit";
import { LetterModal, useLetterView } from "./letters";
import { ProfileForm } from "./screens-me";
import { KycStep } from "./kyc";
import { IdleWatcher, PhotoCheckin } from "./monitor";
import { ChatNotifier } from "./chat-notify";
import { Screen } from "./screens";
import { Check, FileSignature, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { IdBadge, SideIcons } from "../../employee/art";

const ICONS: Record<string, string> = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  rupee: '<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  cal: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  briefcase: '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
};
const Ico = ({ n, s = 16 }: { n: string; s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: ICONS[n] ?? "" }} />;

export function Frame({ sh, screen, title, sub, data, gate }: { sh: Shell; screen: ScreenId; title: string; sub: string; data: unknown; gate: "password" | "profile" | "kyc" | "docs" | null }) {
  const [menu, setMenu] = useState(false), [bell, setBell] = useState(false), [brk, setBrk] = useState(false), [ally, setAlly] = useState(false), [pw, setPw] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const router = useRouter();
  const { run } = useRun();
  const [night, setNight] = useState(false);
  useEffect(() => { try { setNight(localStorage.getItem("hrms.night") === "1"); } catch { /* default light */ } }, []);
  // Night mode inverts the page (and turns pictures back) like the design does; it is a per-browser choice.
  useEffect(() => {
    const el = document.documentElement;
    el.style.filter = night ? "invert(.93) hue-rotate(180deg)" : "";
    el.style.background = night ? "#e9eef5" : "";
    let st = document.getElementById("hrms-night-style");
    if (!st) { st = document.createElement("style"); st.id = "hrms-night-style"; document.head.appendChild(st); }
    st.textContent = night ? "html img{filter:invert(1.075) hue-rotate(180deg)} @media print{html{filter:none !important}}" : "";
    return () => { el.style.filter = ""; el.style.background = ""; };
  }, [night]);
  const toggleNight = () => setNight((n) => { try { localStorage.setItem("hrms.night", n ? "0" : "1"); } catch { /* private window */ } return !n; });
  // Keep presence fresh and pick up new notifications.
  useEffect(() => { const t = setInterval(() => router.refresh(), 60_000); return () => clearInterval(t); }, [router]);
  useEffect(() => { const open = () => setAlly(true); window.addEventListener("hrms:ally", open); return () => window.removeEventListener("hrms:ally", open); }, []);
  if (gate) return <Gate gate={gate} sh={sh} />;
  const unread = sh.notes.filter((n) => n.unread).length;
  const lunchNow = (() => { const ist = new Date(Date.now() + 5.5 * 3600_000), m = ist.getUTCHours() * 60 + ist.getUTCMinutes(); return m >= toMin(sh.lunch.from) && m < toMin(sh.lunch.to); })();
  const to12 = (hhmm: string) => { const h = Number(hhmm.slice(0, 2)); return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`; };
  const groups: [string, typeof sh.nav][] = [];
  for (const n of sh.nav) { const g = groups.find((x) => x[0] === n.group); if (g) g[1].push(n); else groups.push([n.group, [n]]); }
  const greet = screen === sh.home && screen === "slhome" ? `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, ${sh.me.first}` : title;
  const subtitle = screen === sh.home && screen === "slhome" ? `${HR_ROLE_LABEL[sh.me.role]} · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}` : sub;
  return (
    <div className="flex min-h-screen print:block">
      <aside className={cx("w-[210px] flex-none bg-[#0B5E5B] text-white flex-col px-3 py-5 sticky top-0 h-screen print:hidden", navOpen ? "flex fixed z-40 left-0 top-0" : "hidden min-[860px]:flex")}>
        <div className="flex items-center gap-2.5 px-1.5 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/medoro-mark.png" alt="" className="size-9 rounded-[9px] bg-white p-[2px]" />
          <div><div className="text-[18px] font-bold leading-none">Medoro</div><div className="text-[9.5px] tracking-[.1em] uppercase text-white/50 mt-1">HRMS · Pharmacy software</div></div>
        </div>
        <nav className="flex flex-col gap-px flex-1 min-h-0 overflow-y-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Main">
          {groups.map(([g, items]) => (
            <div key={g} className="flex flex-col gap-px">
              {g ? <div className="text-[10px] tracking-[.12em] font-bold text-white/40 px-2.5 pt-3 pb-1">{g}</div> : null}
              {items.map((n) => (
                <Link key={n.id} href={`/staff/hrms/${n.id}`} onClick={() => setNavOpen(false)} aria-current={n.id === screen ? "page" : undefined}
                  className={cx("flex items-center gap-2.5 px-2.5 py-[7px] rounded-[9px] text-[12.5px] font-medium", n.id === screen ? "bg-white/[.16] text-white font-semibold shadow-[inset_3px_0_0_#14B8A6]" : "text-white/70 hover:bg-white/10 hover:text-white")}>
                  <Ico n={n.icon} s={15} />{n.label}{n.id === "chat" && sh.chatUnread ? <span className="ml-auto bg-[#14B8A6] text-white text-[10px] font-bold rounded-full min-w-[17px] h-[17px] px-1 flex items-center justify-center" aria-label={`${sh.chatUnread} unread`}>{sh.chatUnread}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <button onClick={() => { setAlly(true); setNavOpen(false); }} className="mt-2 flex-none flex items-center gap-2.5 bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 cursor-pointer text-left text-white">
          <span className="size-8 rounded-full bg-[#14B8A6] flex items-center justify-center"><Ico n="sparkle" s={16} /></span>
          <span><span className="block text-[13px] font-bold leading-tight">Chat with Ally</span><span className="block text-[11px] text-white/60">Your work bestie</span></span>
        </button>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-2.5 px-6 max-[560px]:px-3 pt-5 pb-1 flex-wrap print:hidden">
          <button className="min-[860px]:hidden border border-[#CDD2D7] bg-white rounded-lg size-9 cursor-pointer" aria-label="Menu" onClick={() => setNavOpen((o) => !o)}>☰</button>
          {NO_TITLE_SCREENS.includes(screen) ? <div className="mr-auto" /> : <div className="min-w-0 mr-auto"><h1 className="text-[19px] font-bold truncate">{greet}</h1>{subtitle ? <p className="text-[12.5px] text-[#334155] truncate">{subtitle}</p> : null}</div>}
          {sh.onBreak
            ? <button onClick={() => run(() => endBreak())} className="rounded-full bg-[#FEF3C7] text-[#B45309] px-3.5 py-1.5 text-[12.5px] font-semibold cursor-pointer border-0">On break: {sh.onBreak.kind} · end break</button>
            : lunchNow ? <span className="rounded-full bg-[#FEF3C7] text-[#B45309] px-3 py-1.5 text-[12px] font-semibold flex items-center gap-1.5">🍽 Lunch break · back at {to12(sh.lunch.to)}</span> : <span className="rounded-full bg-[#D6F3EF] text-[#0B5E5B] px-3 py-1.5 text-[12px] font-semibold flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#0B5E5B]" />Active</span>}
          <div className="relative">
            <button className={btnCls} onClick={() => setBrk((o) => !o)} disabled={!!sh.onBreak}>☕ Take a break</button>
            {brk ? <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-[#E2E8F0] rounded-xl shadow-xl p-1.5 w-[210px]">
              {BREAKS.map((b) => <button key={b} className="block w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-[#F1F5F9] cursor-pointer bg-transparent border-0" onClick={() => { setBrk(false); run(() => startBreak(b), () => `Enjoy your break: ${b}.`); }}>{b}</button>)}
            </div> : null}
          </div>
          <button className={btnCls} aria-label={night ? "Switch to day mode" : "Switch to night mode"} aria-pressed={night} onClick={toggleNight}>{night ? "☀️" : "🌙"}</button>
          <div className="relative">
            <button className={cx(btnCls, "relative")} aria-label="Notifications" onClick={() => { setBell((o) => !o); if (!bell && unread) void readNotifications().then(() => router.refresh()); }}>
              <Ico n="bell" />{unread ? <span className="absolute -top-1 -right-1 bg-[#DC2626] text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center">{unread}</span> : null}
            </button>
            {bell ? <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-[#E2E8F0] rounded-xl shadow-xl w-[320px] max-h-[420px] overflow-auto">
              <div className="px-4 py-2.5 text-[13px] font-bold border-b border-[#F1F5F9]">Notifications</div>
              {sh.notes.length ? sh.notes.map((n) => (
                <Link key={n.id} href={n.screen ? `/staff/hrms/${n.screen}` : `/staff/hrms/${sh.home}`} onClick={() => setBell(false)} className={cx("block px-4 py-2.5 text-[12.5px] border-b border-[#F8FAFC] hover:bg-[#F8FAFC]", n.unread && "bg-[#F2F9F8]")}>
                  {n.text}<span className="block text-[11px] text-[#94A3B8] mt-0.5">{ago(n.at)}</span>
                </Link>
              )) : <div className="px-4 py-6 text-center text-[13px] text-[#64748B]">You’re all caught up.</div>}
            </div> : null}
          </div>
          <div className="relative">
            <button className="flex items-center gap-1.5 cursor-pointer bg-transparent border-0 p-0" onClick={() => setMenu((o) => !o)} aria-label="Account menu"><Avatar name={sh.me.name} photo={sh.me.photo} size={36} dot={presenceColor(sh.onBreak ? "break" : "active")} />▾</button>
            {menu ? <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-[#E2E8F0] rounded-xl shadow-xl w-[240px] p-1.5">
              <div className="px-3 py-2 border-b border-[#F1F5F9] mb-1"><div className="text-[13.5px] font-bold">{sh.me.name}</div><div className="text-[11.5px] text-[#64748B]">{sh.me.empNo} · {sh.me.designation || HR_ROLE_LABEL[sh.me.role]}</div></div>
              <Link href="/staff/hrms/profile" onClick={() => setMenu(false)} className="block px-3 py-2 rounded-lg text-[13px] hover:bg-[#F1F5F9]">My profile</Link>
              {sh.more.length ? <><div className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-[.1em] text-[#94A3B8] border-t border-[#F1F5F9] mt-1">MORE</div><div className="max-h-[240px] overflow-y-auto">{sh.more.map((m) => <Link key={m.id} href={`/staff/hrms/${m.id}`} onClick={() => setMenu(false)} className="block px-3 py-1.5 rounded-lg text-[12.5px] hover:bg-[#F1F5F9]">{m.label}</Link>)}</div></> : null}
              <button className="block w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-[#F1F5F9] cursor-pointer bg-transparent border-0" onClick={() => { setMenu(false); setPw(true); }}>Change password</button>
              {sh.me.growth ? <Link href="/staff/growth/my-work" className="block px-3 py-2 rounded-lg text-[13px] hover:bg-[#F1F5F9]">Open lead tools</Link> : null}
              {sh.me.console ? <button className="block w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-[#F1F5F9] cursor-pointer bg-transparent border-0" onClick={() => void openStaffConsole().then((to) => { window.location.href = to; })}>Open staff console</button> : null}
              <button className="block w-full text-left px-3 py-2 rounded-lg text-[13px] text-[#B3261E] hover:bg-[#FDECEA] cursor-pointer bg-transparent border-0" onClick={() => void hrSignOut()}>Sign out</button>
            </div> : null}
          </div>
        </header>
        <main className="flex flex-col gap-4 px-6 max-[560px]:px-3 py-4 pb-12"><Screen screen={screen} data={data} sh={sh} /></main>
      </div>
      <ChatNotifier screen={screen} />
      <IdleWatcher minutes={sh.monitor} active={!!sh.att.inAt && !sh.att.outAt && !sh.onBreak} lunch={sh.lunch} />
      {sh.needsPhoto ? <PhotoCheckin lateAfter={sh.lateAfter} /> : null}
      {ally ? <AllyChat first={sh.me.first} onClose={() => setAlly(false)} /> : null}
      {pw ? <PasswordModal onClose={() => setPw(false)} /> : null}
    </div>
  );
}

function PasswordForm({ forced, onDone }: { forced: boolean; onDone: () => void }) {
  const { run, busy, toast } = useRun();
  const [cur, setCur] = useState(""), [a, setA] = useState(""), [b, setB] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (a !== b) return toast("The two passwords don’t match.", "red");
    run(() => hrChangePassword(a, cur), () => { onDone(); });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {forced ? null : <Field label="Current password"><input className={inputCls} type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>}
      <Field label="New password" hint="At least 12 characters."><input className={inputCls} type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" required minLength={12} /></Field>
      <Field label="Confirm new password"><input className={inputCls} type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" required /></Field>
      <button className={primaryCls} disabled={busy}>Save password</button>
    </form>
  );
}
const PasswordModal = ({ onClose }: { onClose: () => void }) => <Modal title="Change password" onClose={onClose}><PasswordForm forced={false} onDone={onClose} /></Modal>;

/** First sign-in: set your own password, fill in your details, accept the joining documents. */
function Gate({ gate, sh }: { gate: "password" | "profile" | "kyc" | "docs"; sh: Shell }) {
  const steps = ["Set your password", "Your details", "Aadhaar & PAN", "Joining documents"];
  const at = gate === "password" ? 0 : gate === "profile" ? 1 : gate === "kyc" ? 2 : 3;
  const { run, busy } = useRun();
  const [agree, setAgree] = useState([false, false, false]);
  const docs: [LetterType, string][] = JOINING_LETTERS.map((t) => [t, letterLabel(t)]);
  const v = useLetterView();
  const icons = [KeyRound, UserRound, ShieldCheck, FileSignature];
  const StepIcon = icons[at];
  const cheer = ["Let’s start with a password only you know.", "Nice. Now a few details for HR and your salary.", "Halfway there. A quick identity check.", "Last step. Read and accept, and you’re in."][at];
  return (
    <div className="hr-motion relative min-h-screen overflow-hidden bg-[#F8FAFC]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="site-blob site-blob-a bg-[#14B8A6]/12" />
        <div className="site-blob site-blob-b bg-[#F5C451]/12" />
        <div className="site-blob site-blob-c bg-[#8FD3C6]/20" />
      </div>
      <SideIcons />
    <div className="relative max-w-[760px] mx-auto px-4 py-10 flex flex-col gap-5">
      <div className="hr-up flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/medoro-mark.png" alt="" className="hr-breathe size-10 rounded-lg" /><div><h1 className="text-[22px] font-bold">Welcome to Medoro, {sh.me.first} <span aria-hidden className="hr-wave inline-block">👋</span></h1><p className="text-[13px] text-[#64748B]">{sh.me.empNo} · four quick steps before you start.</p></div>
        <button onClick={() => void hrSignOut()} className={cx(btnCls, "ml-auto")}>Sign out</button>
      </div>
      {/* Stepper: done steps get a tick, the current one pulses, the line fills as you go. */}
      <ol aria-label={`Step ${at + 1} of ${steps.length}`} className="hr-up [--d:1] relative m-0 p-0 list-none grid grid-cols-4 gap-2">
        <span aria-hidden className="absolute left-[12.5%] right-[12.5%] top-[19px] h-[3px] rounded-full bg-[#E2E8F0]" />
        <span aria-hidden className="hr-fill absolute left-[12.5%] top-[19px] h-[3px] rounded-full bg-gradient-to-r from-[#14B8A6] to-[#0B5E5B]" style={{ width: `${(at / (steps.length - 1)) * 75}%` }} />
        {steps.map((s, i) => {
          const Icon = icons[i];
          return (
            <li key={s} aria-current={i === at ? "step" : undefined} className="relative flex flex-col items-center gap-1.5 text-center">
              <span className={cx("size-10 rounded-full flex items-center justify-center border-2 transition-colors", i < at ? "bg-[#0B5E5B] border-[#0B5E5B] text-white" : i === at ? "hr-current bg-white border-[#0B5E5B] text-[#0B5E5B]" : "bg-white border-[#E2E8F0] text-[#94A3B8]")}>
                {i < at ? <Check size={18} strokeWidth={3} aria-hidden /> : <Icon size={18} aria-hidden />}
              </span>
              <span className={cx("text-[12.5px] font-semibold leading-tight", i <= at ? "text-[#0B5E5B]" : "text-[#64748B]")}>{s}</span>
            </li>
          );
        })}
      </ol>
      <div key={gate} className="hr-up [--d:2] flex items-center gap-3 rounded-xl bg-gradient-to-r from-[#0B5E5B] to-[#0E7C77] text-white px-4 py-3 shadow-[0_14px_30px_-18px_rgba(11,94,91,.7)]">
        <span className="hr-bob size-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center flex-none"><StepIcon size={20} aria-hidden /></span>
        <span className="flex flex-col leading-tight"><strong className="text-[14.5px]">Step {at + 1} of {steps.length} · {steps[at]}</strong><span className="text-[13px] text-white/80">{cheer}</span></span>
        {at === 2 ? <IdBadge className="hr-badge ml-auto w-[44px] h-auto max-[560px]:hidden" /> : null}
      </div>
      <div key={`card-${gate}`} className="hr-up [--d:3] hr-glow relative rounded-xl">
      {gate === "password" ? <Card title="Set your own password" sub="The password HR gave you was temporary." pad><PasswordForm forced onDone={() => {}} /></Card> : null}
      {gate === "profile" ? <Card title="Your details" sub="Needed for HR records and to pay your salary. Bank account and PAN are stored encrypted." pad><ProfileForm initial={{ phone: sh.me.phone, personalEmail: sh.me.personalEmail }} complete onSave={(v) => run(() => saveProfile(v, true))} busy={busy} /></Card> : null}
      {gate === "kyc" ? <KycStep /> : null}
      {gate === "docs" ? (
        <Card title="Joining documents" sub="Read each one, then accept." pad>
          <div className="flex flex-col gap-3">
            {docs.map(([t, d], i) => (
              <div key={t} className={cx("flex items-start gap-3 border rounded-xl p-3.5 transition-[background-color,border-color,transform] duration-300 hover:-translate-y-0.5", agree[i] ? "bg-[#F0FBF6] border-[#9FDBBE]" : "border-[#E2E8F0]")}>
                <input type="checkbox" className="mt-1" aria-label={`I have read and accept the ${d.toLowerCase()}`} checked={agree[i]} onChange={(e) => setAgree(agree.map((x, j) => (j === i ? e.target.checked : x)))} />
                <span><strong className="text-[13.5px]">{d}</strong><span className="block text-[12.5px] text-[#64748B]">{i === 0 ? "Your role, pay and joining date as agreed." : i === 1 ? "Terms of your employment at Medoro, including notice period and leave policy." : "You agree to keep Medoro and pharmacy customer data confidential."} HR can share the signed copies on request.</span></span>
                <button type="button" className={cx(btnCls, "ml-auto")} disabled={v.busy} onClick={() => void v.show(() => getLetter("me", t), `/staff/hrms/letter/me/${t}`)}>Read</button>
              </div>
            ))}
            <p className="text-[12px] text-[#64748B]">Accepting is recorded with today’s date. Steps: {ONBOARD_STEPS.length} onboarding tasks follow with HR.</p>
            <button className={primaryCls} disabled={busy || !agree.every(Boolean)} onClick={() => run(() => acceptDocuments())}>Accept and enter the HRMS</button>
            {v.open ? <LetterModal letter={v.open.letter} pdf={v.open.pdf} onClose={v.close} /> : null}
          </div>
        </Card>
      ) : null}
      </div>
    </div>
    </div>
  );
}

function AllyChat({ first, onClose }: { first: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<{ who: "me" | "ai"; text: string }[]>([{ who: "ai", text: `Hi ${first}! Ask me about your leave, payslip, attendance, tasks or holidays, or say “draft my leave letter”.` }]);
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);
  const send = async (text: string) => {
    const t = text.trim(); if (!t || busy) return;
    const next = [...msgs, { who: "me" as const, text: t }];
    setMsgs(next); setQ(""); setBusy(true);
    const r = await askAlly(t, next.slice(0, -1).slice(1));
    setMsgs([...next, { who: "ai", text: r.ok ? r.data.text : r.error }]); setBusy(false);
  };
  return (
    <Modal title="Ally · your work bestie" onClose={onClose}>
      <div className="h-[340px] overflow-auto flex flex-col gap-2 pr-1">
        {msgs.map((m, i) => <div key={i} className={cx("max-w-[85%] px-3 py-2 rounded-2xl text-[13.5px] whitespace-pre-wrap", m.who === "me" ? "self-end bg-[#0B5E5B] text-white" : "self-start bg-[#F1F5F9]")}>{m.text}</div>)}
        {busy ? <div className="self-start text-[12.5px] text-[#64748B]">Ally is thinking…</div> : null}
        <div ref={end} />
      </div>
      <div className="flex gap-1.5 flex-wrap">{["My leave balance", "Last payslip", "My tasks", "Upcoming holidays"].map((s) => <button key={s} className={btnCls} onClick={() => void send(s)}>{s}</button>)}</div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(q); }}>
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Ally…" autoFocus /><button className={primaryCls} disabled={busy}>Send</button>
      </form>
    </Modal>
  );
}
