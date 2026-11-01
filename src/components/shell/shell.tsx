"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  ChevronDown, ChevronRight, Search, Bell, ShieldCheck, Ellipsis, CircleUser, CreditCard, Languages,
  Keyboard, LifeBuoy, LogOut, MapPin, UserRoundCog, Monitor, Sparkles, KeyRound, Menu, X,
} from "lucide-react";
import { AiDrawer, type AiShell } from "./ai-drawer";
import { useLive } from "./use-live";
import { useOfflineAgent } from "./use-offline-agent";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { DICT, type Lang } from "@/lib/i18n";
import { NAV, READY, screenOf, type ScreenId } from "@/lib/nav";
import { NAV_ICONS } from "./icons";
import {
  changePasswordAction, changePinAction, disconnectGoogleAction, listSessions, regenerateCodesAction, revokeOtherSessions, revokeSession, securityInfo, setBranch, setLang, setViewAs,
} from "@/app/app/actions";
import { Input } from "@/components/ui/field";
import { signOut } from "@/app/(auth)/actions";

export type ShellProps = {
  tenantName: string; branchCount: number; userName: string; userEmail: string; role: string; realRole: string; canViewAs: boolean;
  perms: string[]; branchId: string; branchName: string; branches: { id: string; name: string }[]; lang: Lang;
  mfa: boolean; deployment: string; strict: boolean; liveDevices: number;
  badges: Partial<Record<ScreenId, [number, "amber" | "red"]>>; alerts: string[]; ai: AiShell; supportUntil: string | null;
  subscription: { tone: "amber" | "red"; text: string; renew: boolean } | null;
  deletionOn?: string | null;
  children: React.ReactNode;
};

const BADGE = { amber: ["#FDF2E1", "#94570A"], red: ["#FDECEC", "#C0362C"] } as const;

export function Shell(p: ShellProps) {
  return <ToastProvider><ShellInner {...p} /></ToastProvider>;
}

function ShellInner(p: ShellProps) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const t = DICT[p.lang];
  const [narrow, setNarrow] = useState(false);
  // Phones: the menu is a drawer opened from the header instead of a column that takes a fifth of the screen.
  const [phone, setPhone] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const rail = narrow && !phone;
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const showAi = !p.ai.globalOff && (p.ai.enabled || p.ai.canManage);
  const live = useLive();
  const offlineReady = useOfflineAgent(p.branchId);
  const [, start] = useTransition();

  useEffect(() => {
    const on = () => { setNarrow(window.innerWidth < 1180); setPhone(window.innerWidth < 768); };
    on(); window.addEventListener("resize", on);
    if (window.innerWidth >= 1500) setAiOpen(true);
    const ask = () => setAiOpen(true);
    window.addEventListener("medoro:ai", ask);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("medoro:ai", ask); };
  }, []);

  useEffect(() => { setDrawer(false); setMenu(false); }, [path]);

  // Result of Profile → Connect Google (the OAuth callback lands on /app?google=…).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = q.get("google");
    if (!g) return;
    const msg: Record<string, [string, "green" | "red" | "gray"]> = {
      linked: ["Google sign-in connected. Next time, use “Continue with Google”.", "green"],
      taken: ["That Google account is already connected to another Medoro user.", "red"],
      unsupported: ["Google sign-in is for owners and managers, who sign in with a password.", "red"],
      cancelled: ["Connecting Google was cancelled.", "gray"],
    };
    const [text, tone] = msg[g] ?? ["Couldn’t connect Google. Try again.", "red"];
    toast(text, tone);
    q.delete("google");
    window.history.replaceState(null, "", window.location.pathname + (q.size ? `?${q}` : ""));
  }, [toast]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.key === "F2" && READY.has("pos") && p.perms.includes("sale")) { e.preventDefault(); router.push("/app/pos?focus=1"); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j" && showAi) { e.preventDefault(); setAiOpen((x) => !x); }
      else if (e.key === "Escape" && drawer) setDrawer(false);
      else if (e.key === "Escape" && aiOpen && narrow) setAiOpen(false);
      else if (e.key === "?" && !typing) { e.preventDefault(); showShortcuts(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const showShortcuts = () => { setMenu(false); toast("F2 search · F4 hold · F9 complete sale · Ctrl+J Ask AI · Esc close · ? shortcuts", "gray"); };

  const allowed = NAV.filter((n) => READY.has(n.id) && (!n.perm || p.perms.includes(n.perm)));
  const cur = screenOf(path);
  const title = path.startsWith("/app/owner/reports") ? "Scheduled reports" : cur ? t[cur.id] : "";
  const initials = p.userName.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="grid h-dvh w-full overflow-hidden bg-bg text-[14px]" style={{ gridTemplateColumns: (phone ? "" : rail ? "76px " : "232px ") + "minmax(0,1fr)" + (aiOpen && showAi && !narrow ? " 380px" : "") }}>
      {phone && drawer ? <div className="fixed inset-0 z-[79] bg-[rgba(16,24,40,.35)]" onClick={() => setDrawer(false)} aria-hidden /> : null}
      <aside className={cn("bg-side border-r border-line flex flex-col min-h-0", phone && "fixed inset-y-0 left-0 z-[80] w-[272px] max-w-[85vw] shadow-pop transition-transform duration-200", phone && !drawer && "-translate-x-full invisible")} aria-label="Menu">
        <div className="h-14 flex items-center px-2.5 border-b border-line-soft flex-none">
          <div className="flex items-center gap-[9px] w-full p-1.5 rounded-lg">
            <span className="size-7 rounded-[7px] bg-white border border-line flex items-center justify-center flex-none shadow-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/medoro-mark.png" alt="Medoro" className="w-5 h-auto" />
            </span>
            {!rail ? (
              <span className="flex flex-col min-w-0 flex-1 leading-tight">
                <span className="text-[13.5px] font-semibold text-ink-strong truncate">{p.tenantName}</span>
                <span className="text-[11.5px] text-faint whitespace-nowrap">{p.branchCount} branch{p.branchCount === 1 ? "" : "es"}</span>
              </span>
            ) : null}
            {phone ? <button onClick={() => setDrawer(false)} aria-label="Close menu" className="size-10 -mr-1 rounded-lg flex items-center justify-center text-muted cursor-pointer hover:bg-hover"><X size={18} /></button> : null}
          </div>
        </div>
        <nav className="flex flex-col gap-px p-2 flex-1 overflow-y-auto overflow-x-hidden">
          {allowed.map((n, i) => {
            const a = cur?.id === n.id;
            const head = !rail && (i === 0 || allowed[i - 1].group !== n.group);
            const hidden = !rail && closed[n.group] && !a;
            const Icon = NAV_ICONS[n.icon as keyof typeof NAV_ICONS];
            const b = p.badges[n.id];
            return (
              <div key={n.id} className="contents">
                {head ? (
                  <button onClick={() => setClosed((x) => ({ ...x, [n.group]: !x[n.group] }))} className="flex items-center gap-1 px-2 pt-3.5 pb-[5px] text-[11px] font-semibold tracking-[.04em] text-fainter hover:text-ink-2 cursor-pointer text-left">
                    {closed[n.group] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}{t[n.group]}
                  </button>
                ) : null}
                {!hidden ? (
                  <Link href={n.href} title={t[n.id]} className={cn("relative flex flex-none items-center rounded-md text-[13px]", phone ? "min-h-[40px]" : "min-h-[30px]", "no-underline",
                    rail ? "flex-col gap-1 px-1 py-[7px]" : "gap-[11px] px-2 py-1.5",
                    a ? "bg-white text-ink-strong font-semibold shadow-[0_1px_2px_rgba(16,24,40,.08),0_0_0_1px_#E6E8EB]" : "text-ink-2 font-medium hover:bg-hover hover:text-ink-2")}>
                    <Icon size={16} className="flex-none" style={{ color: a ? "#0B5E5B" : "#6B737B" }} />
                    {!rail ? <span className="flex-1 truncate">{t[n.id]}</span> : <span className="text-[10px] leading-none whitespace-nowrap">{n.abbr}</span>}
                    {!rail && b && b[0] ? <span className="min-w-[18px] h-[18px] px-[5px] rounded-full text-[11px] font-semibold flex items-center justify-center tnum" style={{ background: BADGE[b[1]][0], color: BADGE[b[1]][1] }}>{b[0]}</span> : null}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </nav>
        {!rail ? (
          <Link href={p.perms.includes("users") ? "/app/privacy" : "/app/sync"} title={p.strict ? "Strict mode on: your live database runs on infrastructure you control. Medoro only holds licence data." : "Strict mode is off. Open Privacy to see what leaves your server."} className="mx-2 my-1.5 flex items-center gap-2 h-8 px-2.5 border border-line bg-white rounded-[7px] text-[12px] text-ink-2 no-underline hover:border-input hover:text-ink-2">
            <ShieldCheck size={14} style={{ color: p.strict ? "#18794E" : "#94570A" }} /><span className="truncate">{p.strict ? "Strict mode on · data stays with you" : "Strict mode off · see Privacy"}</span>
          </Link>
        ) : null}
        <div className="relative border-t border-line-soft px-2 py-1.5">
          {menu ? (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setMenu(false)} />
              <div className="absolute left-2 bottom-[calc(100%+6px)] w-64 bg-white border border-line rounded-[10px] shadow-pop z-[71] p-1 flex flex-col">
                <div className="flex items-center gap-2.5 p-2.5">
                  <Avatar initials={initials} size={34} />
                  <div className="flex flex-col min-w-0 leading-tight"><span className="text-[13.5px] font-semibold text-ink-strong truncate">{p.userName}</span><span className="text-[12px] text-faint truncate">{p.userEmail}</span></div>
                </div>
                <div className="flex gap-1 flex-wrap px-2.5 pb-2.5">
                  <Chip bg="#E1F1EF" fg="#0B5E5B" strong>{p.role}</Chip>
                  <Chip bg="#F2F4F5" fg="#3D454D"><MapPin size={11} />{p.branchName}</Chip>
                  {p.mfa ? <Chip bg="#E7F6EE" fg="#18794E"><ShieldCheck size={11} />MFA</Chip> : null}
                </div>
                <div className="h-px bg-line-soft -mx-1 mb-1" />
                <MenuItem icon={CircleUser} onClick={() => { setMenu(false); setProfile(true); }}>Profile & sessions</MenuItem>
                {p.perms.includes("users") && READY.has("plan") ? <MenuItem icon={CreditCard} onClick={() => { setMenu(false); router.push("/app/plan"); }}>Subscription</MenuItem> : null}
                <div className="flex items-center gap-2.5 h-[34px] pl-2.5 pr-1.5 text-[13px]">
                  <Languages size={15} className="text-faint" /><span className="flex-1">Language</span>
                  <LangToggle lang={p.lang} small onChange={(l) => start(() => setLang(l))} />
                </div>
                <div className="h-px bg-line-soft -mx-1 my-1" />
                <MenuItem icon={Keyboard} kbd="?" onClick={showShortcuts}>Keyboard shortcuts</MenuItem>
                <MenuItem icon={LifeBuoy} onClick={() => { setMenu(false); router.push("/app/help"); }}>Help & support</MenuItem>
                <div className="h-px bg-line-soft -mx-1 my-1" />
                <MenuItem icon={LogOut} danger onClick={() => start(() => signOut())}>Sign out</MenuItem>
                <div className="px-3.5 py-1.5 text-[11px] text-[#A3AAB1] border-t border-line-soft -mx-1 mt-1">Medoro 0.1.0 · {p.deployment}</div>
              </div>
            </>
          ) : null}
          <button onClick={() => setMenu((x) => !x)} title="Account menu" className={cn("flex items-center gap-[9px] p-1.5 w-full rounded-lg cursor-pointer text-left hover:bg-hover", menu && "bg-hover")}>
            <Avatar initials={initials} size={28} />
            {!rail ? (
              <>
                <div className="flex flex-col min-w-0 flex-1 leading-tight"><div className="text-[13px] font-semibold truncate text-ink-strong">{p.userName}</div><div className="text-[11.5px] text-faint">{p.role} · {p.branchName}</div></div>
                <Ellipsis size={16} className="text-fainter" />
              </>
            ) : null}
          </button>
        </div>
      </aside>

      <div className="flex flex-col min-w-0 min-h-0">
        {p.supportUntil ? (
          <div role="status" className="flex-none bg-[#0E1A1F] text-white text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap">
            <ShieldCheck size={15} className="text-[#5FD3BC]" /><strong>Medoro support · read-only</strong>
            <span className="text-[#B8C7CC]">Access granted by the pharmacy until {p.supportUntil}. Changes and downloads are blocked; everything you open is audited.</span>
          </div>
        ) : null}
        {p.deletionOn ? (
          <div role="alert" className="flex-none text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap bg-[#FBEAE8] text-[#8C1D18]">
            <strong>This pharmacy will be permanently deleted on {p.deletionOn}.</strong>
            {p.perms.includes("users") ? <Link href="/app/privacy#delete-account" className="font-semibold text-teal underline">Cancel deletion</Link> : <span>Ask the owner if this is a mistake.</span>}
          </div>
        ) : null}
        {p.subscription ? (
          <div role="status" className={cn("flex-none text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap", p.subscription.tone === "red" ? "bg-[#FBEAE8] text-[#8C1D18]" : "bg-[#FDF2E1] text-[#6B4A0E]")}>
            <CreditCard size={15} /><span>{p.subscription.text}</span>
            {p.subscription.renew ? <Link href="/app/plan" className="font-semibold text-teal underline">Renew</Link> : <span>Ask the owner to renew.</span>}
          </div>
        ) : null}
        {live === "offline" ? (
          <div role="status" className="flex-none bg-[#FDF2E1] text-[#6B4A0E] text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap">
            <strong>No connection to your server.</strong>
            <span>{offlineReady ? "This counter can keep billing offline; bills post when the connection is back." : "Screens can’t load until it’s back."}</span>
            {offlineReady ? <a href="/offline" className="font-semibold text-teal underline">Open offline billing</a> : null}
          </div>
        ) : null}
        <header className={cn("flex items-center h-14 bg-white border-b border-line flex-none", phone ? "gap-1 px-2" : "gap-2.5 px-5")}>
          <div className={cn("flex items-center gap-1.5 text-[13.5px] min-w-0", phone ? "flex-1" : "flex-none")}>
            {!narrow ? <><span className="text-faint whitespace-nowrap max-w-[160px] truncate">{p.tenantName.split(" ")[0]}</span><ChevronRight size={14} className="text-[#A3AAB1]" /></> : null}
            {phone ? <button onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} className="size-10 -ml-1 rounded-lg flex items-center justify-center text-ink-2 cursor-pointer hover:bg-chip flex-none"><Menu size={20} /></button> : (
              <>
                <div className="relative flex items-center">
                  <select value={p.branchId} onChange={(e) => start(() => setBranch(e.target.value))} aria-label="Branch" className="appearance-none border-0 bg-transparent py-1 pl-1.5 pr-5 rounded-md text-[13.5px] text-ink-2 font-medium cursor-pointer outline-none hover:bg-chip">
                    {p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-1 text-fainter pointer-events-none" />
                </div>
                <ChevronRight size={14} className="text-[#A3AAB1]" />
              </>
            )}
            <span className="font-semibold whitespace-nowrap truncate">{title}</span>
          </div>
          {READY.has("pos") && p.perms.includes("sale") && phone ? (
            <Link href="/app/pos?focus=1" aria-label="Search medicines" className="size-10 rounded-lg flex items-center justify-center text-muted no-underline hover:bg-chip hover:text-muted flex-none"><Search size={18} /></Link>
          ) : READY.has("pos") && p.perms.includes("sale") ? (
            <Link href="/app/pos?focus=1" className="ml-4 mr-auto flex items-center gap-2 w-[min(380px,32vw)] min-w-[140px] h-[34px] px-2.5 border border-line bg-page rounded-lg text-fainter text-[13px] no-underline hover:border-input hover:bg-white hover:text-fainter">
              <Search size={15} /><span className="flex-1 truncate">Search medicines…</span><span className="font-mono text-[11px] border border-[#E3E6E9] bg-white rounded px-[5px] text-faint">F2</span>
            </Link>
          ) : phone ? null : <div className="mx-auto" />}
          <div className="flex items-center gap-1.5 flex-none">
            <div title={live === "live" ? `Live: changes from other devices appear here automatically. ${p.liveDevices} device${p.liveDevices === 1 ? "" : "s"} active in the last 5 minutes.` : live === "offline" ? "This device is offline." : "Connecting to your server for live updates…"}
              className={cn("flex items-center gap-1.5 h-[30px] px-[9px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap", live === "live" ? "text-ok" : live === "offline" ? "text-bad" : "text-[#94570A]")}>
              <span className={cn("size-[7px] rounded-full", live === "live" ? "bg-[#22A06B] shadow-[0_0_0_3px_#DCF2E7] animate-pulse-dot" : live === "offline" ? "bg-[#D64545]" : "bg-[#E0A82E]")} />
              {!narrow ? (live === "live" ? "Live" : live === "offline" ? "Offline" : "Connecting") : null}
            </div>
            {!phone ? <><div className="w-px h-5 bg-line" /><LangToggle lang={p.lang} onChange={(l) => start(() => setLang(l))} /></> : null}
            {p.canViewAs && !phone ? (
              <div title="Preview the app as another role. Permissions can only narrow." className="relative flex items-center">
                <UserRoundCog size={14} className="absolute left-[9px] text-faint pointer-events-none" />
                <select value={p.role} aria-label="View as role" onChange={(e) => { const r = e.target.value; start(async () => { await setViewAs(r); toast(r === p.realRole ? "Back to your own role." : `Now viewing as ${r}. Menus and actions follow that role.`, "blue"); }); }}
                  className="appearance-none h-[30px] border border-line rounded-[7px] pl-7 pr-6 text-[12.5px] bg-white text-ink-2 font-medium cursor-pointer outline-none hover:border-input">
                  {["Owner", "Manager", "Pharmacist", "Cashier", "Accountant"].map((r) => <option key={r} value={r}>{r === p.realRole ? r : `View as ${r}`}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-[7px] text-fainter pointer-events-none" />
              </div>
            ) : null}
            <button onClick={() => toast(p.alerts.length ? p.alerts.join(" · ") : "No alerts right now.", p.alerts.length ? "amber" : "gray")} title="Notifications" className="relative size-10 sm:size-8 rounded-[7px] text-muted cursor-pointer flex items-center justify-center hover:bg-chip">
              <Bell size={17} />{p.alerts.length ? <span className="absolute top-[7px] right-2 size-[7px] rounded-full bg-[#D64545] border-[1.5px] border-white" /> : null}
            </button>
            {showAi ? <button onClick={() => setAiOpen((x) => !x)} title="Ask AI (Ctrl+J)" aria-expanded={aiOpen} className={cn("flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-[7px] text-white text-[13px] font-semibold cursor-pointer whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,.08)] hover:brightness-110", aiOpen ? "bg-[#094A48]" : "bg-teal")}>
              <Sparkles size={15} />{!narrow ? t.ask : null}
            </button> : null}
          </div>
        </header>
        <main className="flex-1 overflow-auto px-7 pt-6 pb-12 min-h-0 bg-page max-[640px]:px-4">{p.children}</main>
      </div>
      {showAi ? <AiDrawer open={aiOpen} floating={narrow} onClose={() => setAiOpen(false)} lang={p.lang} placeholder={t.aiPh} ai={p.ai} /> : null}
      <ProfileModal open={profile} onClose={() => setProfile(false)} name={p.userName} email={p.userEmail} role={p.role} initials={initials} />
    </div>
  );
}

function Avatar({ initials, size }: { initials: string; size: number }) {
  return (
    <div className="relative rounded-full text-white flex items-center justify-center font-semibold flex-none" style={{ width: size, height: size, fontSize: size * 0.4, background: "linear-gradient(135deg,#2459C9,#0A9A80)" }}>
      {initials}<span className="absolute -right-px -bottom-px size-[9px] rounded-full bg-[#22A06B] border-2 border-side" />
    </div>
  );
}

function Chip({ bg, fg, strong, children }: { bg: string; fg: string; strong?: boolean; children: React.ReactNode }) {
  return <span className="h-5 px-[7px] rounded-[5px] text-[11.5px] flex items-center gap-1" style={{ background: bg, color: fg, fontWeight: strong ? 600 : 500 }}>{children}</span>;
}

function MenuItem({ icon: Icon, children, onClick, kbd, danger }: { icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>; children: React.ReactNode; onClick: () => void; kbd?: string; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-2.5 h-[34px] px-2.5 rounded-md text-[13px] cursor-pointer text-left", danger ? "text-[#C0362C] hover:bg-[#FDECEC]" : "text-ink hover:bg-chip")}>
      <Icon size={15} style={{ color: danger ? "#C0362C" : "#6B737B" }} /><span className="flex-1">{children}</span>
      {kbd ? <span className="font-mono text-[11px] text-fainter border border-line rounded px-[5px] leading-[18px]">{kbd}</span> : null}
    </button>
  );
}

function LangToggle({ lang, onChange, small }: { lang: Lang; onChange: (l: Lang) => void; small?: boolean }) {
  const b = (l: Lang, label: string) => (
    <button key={l} onClick={() => onChange(l)} className={cn("rounded-[5px] font-semibold cursor-pointer text-ink", small ? "h-[22px] px-2 text-[11.5px]" : "w-[30px] h-[26px] text-[12px]", lang === l ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,.12)]" : "bg-transparent")}>{label}</button>
  );
  return <div className={cn("inline-flex gap-px bg-chip p-0.5", small ? "rounded-md" : "rounded-[7px]")}>{b("en", "EN")}{b("hi", small ? "हिंदी" : "हि")}</div>;
}

function ProfileModal({ open, onClose, name, email, role, initials }: { open: boolean; onClose: () => void; name: string; email: string; role: string; initials: string }) {
  const toast = useToast();
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listSessions>>>([]);
  const [, start] = useTransition();
  useEffect(() => { if (open) listSessions().then(setSessions); }, [open]);
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Modal open={open} onClose={onClose} width={480}
      footer={<><Button onClick={() => start(async () => { await revokeOtherSessions(); setSessions(await listSessions()); toast("All other devices signed out.", "green"); })}>Sign out all other devices</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <div className="flex items-center gap-3 pt-5">
        <div className="size-11 rounded-full bg-blue-tint text-blue flex items-center justify-center font-semibold text-[16px]">{initials}</div>
        <div className="flex flex-col"><strong className="text-[17px]">{name}</strong><span className="text-[12.5px] text-muted">{role} · {email}</span></div>
      </div>
      {open ? <SignInSecurity /> : null}
      <div className="flex flex-col">
        <div className="text-[12.5px] text-muted font-medium mb-1">Active sessions</div>
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 py-2 border-b border-row text-[13.5px]">
            <Monitor size={16} className="text-muted" />
            <div className="flex flex-col flex-1 min-w-0"><span className="font-medium">{s.device}</span><span className="text-[12px] text-muted truncate">signed in {fmt(s.created)} · {s.ip ?? "local"} · last active {fmt(s.lastSeen)}</span></div>
            {s.isThis ? <span className="text-[12px] text-ok">This device</span> : (
              <Button size="sm" variant="danger-outline" onClick={() => start(async () => { await revokeSession(s.id); setSessions(await listSessions()); toast("Session signed out.", "green"); })}>Revoke</Button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

type Security = Extract<Awaited<ReturnType<typeof securityInfo>>, { ok: true }>["data"];

/** Profile → password or PIN, Google sign-in and recovery codes for the signed-in user. */
function SignInSecurity() {
  const toast = useToast();
  const [sec, setSec] = useState<Security | null>(null);
  const [panel, setPanel] = useState<"secret" | null>(null);
  const [cur, setCur] = useState(""), [next, setNext] = useState(""), [next2, setNext2] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const load = () => securityInfo().then((r) => { if (r.ok) setSec(r.data); });
  useEffect(() => { securityInfo().then((r) => { if (r.ok) setSec(r.data); }); }, []);
  if (!sec) return null;
  const pin = !sec.hasPassword && sec.hasPin;
  const row = "flex items-center gap-2.5 py-2 border-b border-row text-[13.5px]";

  const saveSecret = () => {
    setErr("");
    if (next !== next2) return setErr(pin ? "PINs do not match." : "Passwords do not match.");
    start(async () => {
      const r = pin ? await changePinAction(cur, next) : await changePasswordAction(cur, next);
      if (!r.ok) return setErr(r.error);
      toast(r.message ?? "Saved.", "green");
      setPanel(null); setCur(""); setNext(""); setNext2("");
    });
  };

  return (
    <div className="flex flex-col">
      <div className="text-[12.5px] text-muted font-medium mb-1">Sign-in & security</div>
      {sec.hasPassword || sec.hasPin ? (
        <div className={row}>
          <KeyRound size={16} className="text-muted" />
          <span className="flex-1 font-medium">{pin ? "PIN" : "Password"}</span>
          {panel !== "secret" ? <Button size="sm" onClick={() => { setPanel("secret"); setErr(""); }}>Change</Button> : null}
        </div>
      ) : null}
      {panel === "secret" ? (
        <div className="flex flex-col gap-2 py-2.5 border-b border-row">
          {pin ? (
            <>
              <Input type="password" inputMode="numeric" placeholder="Current PIN" aria-label="Current PIN" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="off" />
              <Input type="password" inputMode="numeric" placeholder="New 4-digit PIN" aria-label="New PIN" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="off" />
              <Input type="password" inputMode="numeric" placeholder="Confirm new PIN" aria-label="Confirm new PIN" value={next2} onChange={(e) => setNext2(e.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="off" />
            </>
          ) : (
            <>
              <Input type="password" placeholder="Current password" aria-label="Current password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
              <Input type="password" placeholder="New password (10+ characters)" aria-label="New password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
              <Input type="password" placeholder="Confirm new password" aria-label="Confirm new password" value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" />
            </>
          )}
          {err ? <div role="alert" className="text-[12.5px] text-bad">{err}</div> : null}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setPanel(null); setErr(""); }}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={pending} onClick={saveSecret}>{pending ? "Saving…" : pin ? "Change PIN" : "Change password"}</Button>
          </div>
        </div>
      ) : null}
      {sec.google.email || sec.google.available ? (
        <div className={row}>
          <span className="size-4 flex items-center justify-center font-bold text-[13px] text-muted">G</span>
          <div className="flex flex-col flex-1 min-w-0"><span className="font-medium">Google sign-in</span><span className="text-[12px] text-muted truncate">{sec.google.email ? `Connected · ${sec.google.email}` : "Not connected"}</span></div>
          {sec.google.email ? (
            <Button size="sm" variant="danger-outline" disabled={pending} onClick={() => { if (confirm("Disconnect Google? You’ll sign in with your password.")) start(async () => { const r = await disconnectGoogleAction(); toast(r.ok ? r.message ?? "Disconnected." : r.error, r.ok ? "green" : "red"); await load(); }); }}>Disconnect</Button>
          ) : <a href="/api/auth/google/start?intent=link" className="h-7 px-2.5 inline-flex items-center rounded-md border border-input bg-white text-[12.5px] font-medium text-ink no-underline hover:border-teal">Connect Google</a>}
        </div>
      ) : null}
      {sec.mfa ? (
        <div className={row}>
          <ShieldCheck size={16} className="text-muted" />
          <div className="flex flex-col flex-1 min-w-0"><span className="font-medium">Recovery codes</span><span className="text-[12px]" style={{ color: sec.recoveryLeft <= 3 ? "#B3261E" : "#6B737B" }}>{sec.recoveryLeft} of 10 left · each signs in once without your authenticator</span></div>
          <Button size="sm" disabled={pending} onClick={() => { if (confirm("Make 10 new recovery codes? Your old codes stop working.")) start(async () => { const r = await regenerateCodesAction(); if (!r.ok) return toast(r.error, "red"); setCodes(r.data); await load(); }); }}>Regenerate</Button>
        </div>
      ) : null}
      {codes ? (
        <div className="flex flex-col gap-2 py-2.5 border-b border-row">
          <span className="text-[12.5px] text-muted">Save these now: they won’t be shown again.</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-chip rounded-lg p-3 font-mono text-[13.5px]">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" onClick={() => { navigator.clipboard.writeText(`Medoro recovery codes (each works once)\n\n${codes.join("\n")}\n`); toast("Copied.", "gray"); }}>Copy</Button>
            <Button size="sm" variant="primary" onClick={() => setCodes(null)}>I’ve saved them</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
