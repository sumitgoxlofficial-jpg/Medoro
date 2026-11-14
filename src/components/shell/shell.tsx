"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { useLang, useT } from "@/lib/i18n-client";
import { localeOf } from "@/lib/tr";
import { DRIVE_TAB, NAV, READY, driveNav, screenOf, type NavDef, type ScreenId } from "@/lib/nav";
import { NAV_ICONS } from "./icons";
import { DashBackdrop } from "@/components/welcome-banner";
import {
  changePasswordAction, changePinAction, disconnectGoogleAction, listSessions, regenerateCodesAction, revokeOtherSessions, revokeSession, securityInfo, setBranch, setLang, setViewAs,
} from "@/app/app/actions";
import { Input } from "@/components/ui/field";
import { signOut } from "@/app/(auth)/actions";

export type ShellProps = {
  tenantName: string; branchCount: number; userName: string; userEmail: string; role: string; realRole: string; canViewAs: boolean;
  perms: string[]; branchId: string; branchName: string; branches: { id: string; name: string }[]; lang: Lang;
  /** The pharmacy's records live on its counters (Drive): screens open the matching Billing (device) tab. */
  driveNav?: boolean;
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
  const d = DICT[p.lang];
  const t = useT();
  const [narrow, setNarrow] = useState(false);
  // Phones: the menu is a drawer opened from the header instead of a column that takes a fifth of the screen.
  const [phone, setPhone] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const rail = narrow && !phone;
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [find, setFind] = useState("");
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
    // The AI drawer starts closed on every screen size; it opens only from Ask AI, Ctrl+J or a "medoro:ai" event.
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

  const search = useSearchParams();
  const base = NAV.filter((n) => READY.has(n.id) && (!n.perm || p.perms.includes(n.perm)));
  // Records on the counters (Drive): each screen opens the matching tab of Billing (device).
  const allowed = p.driveNav ? base.map(driveNav).filter((n): n is NavDef => !!n) : base;
  // "Find a screen": typing narrows the menu to matching screens (label or description), across every group.
  const finding = find.trim().toLowerCase();
  const shown = finding ? allowed.filter((n) => `${d[n.id] ?? ""} ${n.sub ?? ""}`.toLowerCase().includes(finding)) : allowed;
  const tab = search.get("tab") ?? "bill";
  const cur = p.driveNav && path === "/app/device-pos" ? allowed.find((n) => DRIVE_TAB[n.id] === tab) : screenOf(path);
  const title = path.startsWith("/app/owner/reports") ? t("Scheduled reports") : cur ? d[cur.id] : "";
  const initials = p.userName.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="grid h-dvh w-full overflow-hidden bg-bg text-[14px]" style={{ gridTemplateColumns: (phone ? "" : rail ? "76px " : "232px ") + "minmax(0,1fr)" + (aiOpen && showAi && !narrow ? " 380px" : "") }}>
      {phone && drawer ? <div className="fixed inset-0 z-[79] bg-[rgba(16,24,40,.35)]" onClick={() => setDrawer(false)} aria-hidden /> : null}
      <aside className={cn("bg-[#0B5E5B] text-white flex flex-col min-h-0", phone && "fixed inset-y-0 left-0 z-[80] w-[272px] max-w-[85vw] shadow-pop transition-transform duration-200", phone && !drawer && "-translate-x-full invisible")} aria-label={t("Menu")}>
        <div className="h-14 flex items-center px-2.5 border-b border-white/10 flex-none">
          <div className="flex items-center gap-[9px] w-full p-1.5 rounded-lg">
            <span className="size-8 rounded-[8px] bg-white flex items-center justify-center flex-none p-[2px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/medoro-mark.png" alt="Medoro" className="w-full h-auto rounded-[6px]" />
            </span>
            {!rail ? (
              <span className="flex flex-col min-w-0 flex-1 leading-tight">
                <span className="text-[14px] font-bold text-white truncate">{p.tenantName}</span>
                <span className="text-[10px] tracking-[.08em] uppercase text-white/50 whitespace-nowrap">{t(p.branchCount === 1 ? "{n} branch" : "{n} branches", { n: p.branchCount })}</span>
              </span>
            ) : null}
            {phone ? <button onClick={() => setDrawer(false)} aria-label={t("Close menu")} className="size-10 -mr-1 rounded-lg flex items-center justify-center text-white/70 cursor-pointer hover:bg-white/10 hover:text-white"><X size={18} /></button> : null}
          </div>
        </div>
        {!rail ? (
          <div className="px-2.5 pt-2.5 pb-1 flex-none">
            <label className="relative block">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" aria-hidden />
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("Find a screen")} aria-label={t("Find a screen")} autoComplete="off" spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setFind("");
                  if (e.key === "Enter" && shown[0]) { router.push(shown[0].href); setFind(""); setDrawer(false); }
                }}
                className="w-full h-8 pl-8 pr-2 rounded-lg bg-white/10 border border-white/10 text-[12.5px] text-white placeholder:text-white/50 transition-colors hover:bg-white/[.14] focus:outline-none! focus-visible:outline-none! focus:bg-white/[.16] focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/30" />
            </label>
          </div>
        ) : null}
        <nav className="side-scroll flex flex-col gap-0.5 px-2.5 pb-2 flex-1 overflow-y-auto overflow-x-hidden">
          {finding && shown.length === 0 ? <div className="px-2 py-6 text-center text-[12.5px] text-white/60">{t("No screen matches")} “{find.trim()}”</div> : null}
          {shown.map((n, i) => {
            const a = cur?.id === n.id;
            const head = !rail && !finding && (i === 0 || shown[i - 1].group !== n.group);
            const hidden = !rail && !finding && closed[n.group] && !a;
            const Icon = NAV_ICONS[n.icon as keyof typeof NAV_ICONS];
            const b = p.badges[n.id];
            return (
              <div key={n.id} className="contents">
                {head ? (
                  <button onClick={() => setClosed((x) => ({ ...x, [n.group]: !x[n.group] }))} aria-expanded={!closed[n.group]}
                    className={cn("group/head flex items-center justify-between gap-1 px-2 pb-1 text-[10.5px] font-bold uppercase tracking-[.12em] text-white/45 hover:text-white/80 cursor-pointer text-left", i === 0 ? "pt-2" : "mt-1.5 pt-3")}>
                    <span>{d[n.group]}</span>
                    {closed[n.group] ? <ChevronRight size={12} className="opacity-60 group-hover/head:opacity-100" /> : <ChevronDown size={12} className="opacity-60 group-hover/head:opacity-100" />}
                  </button>
                ) : null}
                {!hidden ? (
                  <Link href={n.href} title={d[n.id]} aria-current={a ? "page" : undefined} className={cn("relative flex flex-none items-center rounded-lg text-[13.5px] no-underline transition-colors", phone ? "min-h-[44px]" : "min-h-[34px]",
                    rail ? "flex-col gap-1 px-1 py-[7px]" : "gap-[11px] px-2.5 py-1.5",
                    a ? "bg-white/[.16] text-white font-semibold shadow-[inset_3px_0_0_#14B8A6]" : "text-white/75 font-medium hover:bg-white/10 hover:text-white")}>
                    <Icon size={17} strokeWidth={a ? 2.1 : 1.8} className="flex-none" />
                    {!rail ? <span className="flex-1 truncate">{d[n.id]}</span> : <span className="text-[10px] leading-none whitespace-nowrap">{t(n.abbr)}</span>}
                    {!rail && b && b[0] ? <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center tnum" style={{ background: BADGE[b[1]][0], color: BADGE[b[1]][1] }}>{b[0]}</span> : null}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </nav>
        {!rail ? (
          <Link href={p.perms.includes("users") ? "/app/privacy" : "/app/sync"} title={p.strict ? t("Strict mode on: your live database runs on infrastructure you control. Medoro only holds licence data.") : t("Strict mode is off. Open Privacy to see what leaves your server.")} className="mx-2.5 mb-2 mt-1 flex items-center gap-2 h-9 px-2.5 rounded-xl bg-white/10 border border-white/15 text-[12px] text-white/85 no-underline transition-colors hover:bg-white/[.14] hover:text-white">
            <ShieldCheck size={14} style={{ color: p.strict ? "#5EEAD4" : "#FCD34D" }} /><span className="truncate">{p.strict ? t("Strict mode on · data stays with you") : t("Strict mode off · see Privacy")}</span>
          </Link>
        ) : null}
        <div className="relative border-t border-white/10 px-2.5 py-2 flex-none">
          {menu ? (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setMenu(false)} />
              <div className="absolute left-2 bottom-[calc(100%+6px)] w-64 bg-white border border-line rounded-[10px] shadow-pop z-[71] p-1 flex flex-col">
                <div className="flex items-center gap-2.5 p-2.5">
                  <Avatar initials={initials} size={34} />
                  <div className="flex flex-col min-w-0 leading-tight"><span className="text-[13.5px] font-semibold text-ink-strong truncate">{p.userName}</span><span className="text-[12px] text-faint truncate">{p.userEmail}</span></div>
                </div>
                <div className="flex gap-1 flex-wrap px-2.5 pb-2.5">
                  <Chip bg="#E1F1EF" fg="#0B5E5B" strong>{t(p.role)}</Chip>
                  <Chip bg="#F2F4F5" fg="#3D454D"><MapPin size={11} />{p.branchName}</Chip>
                  {p.mfa ? <Chip bg="#E7F6EE" fg="#18794E"><ShieldCheck size={11} />MFA</Chip> : null}
                </div>
                <div className="h-px bg-line-soft -mx-1 mb-1" />
                <MenuItem icon={CircleUser} onClick={() => { setMenu(false); setProfile(true); }}>{t("Profile & sessions")}</MenuItem>
                {p.perms.includes("users") && READY.has("plan") ? <MenuItem icon={CreditCard} onClick={() => { setMenu(false); router.push("/app/plan"); }}>{t("Subscription")}</MenuItem> : null}
                <div className="flex items-center gap-2.5 h-[34px] pl-2.5 pr-1.5 text-[13px]">
                  <Languages size={15} className="text-faint" /><span className="flex-1">{t("Language")}</span>
                  <LangToggle lang={p.lang} small onChange={(l) => start(() => setLang(l))} />
                </div>
                <div className="h-px bg-line-soft -mx-1 my-1" />
                <MenuItem icon={Keyboard} kbd="?" onClick={showShortcuts}>{t("Keyboard shortcuts")}</MenuItem>
                <MenuItem icon={LifeBuoy} onClick={() => { setMenu(false); router.push("/app/help"); }}>{t("Help & support")}</MenuItem>
                <div className="h-px bg-line-soft -mx-1 my-1" />
                <MenuItem icon={LogOut} danger onClick={() => start(() => signOut())}>{t("Sign out")}</MenuItem>
                <div className="px-3.5 py-1.5 text-[11px] text-[#A3AAB1] border-t border-line-soft -mx-1 mt-1">Medoro 0.1.0 · {t(p.deployment)}</div>
              </div>
            </>
          ) : null}
          <button onClick={() => setMenu((x) => !x)} title={t("Account menu")} className={cn("flex items-center gap-[10px] p-1.5 w-full rounded-lg cursor-pointer text-left transition-colors hover:bg-white/10", menu && "bg-white/10")}>
            <Avatar initials={initials} size={28} ring="#0B5E5B" />
            {!rail ? (
              <>
                <div className="flex flex-col min-w-0 flex-1 leading-tight"><div className="text-[13px] font-semibold truncate text-white">{p.userName}</div><div className="text-[11.5px] text-white/60">{t(p.role)} · {p.branchName}</div></div>
                <Ellipsis size={16} className="text-white/60" />
              </>
            ) : null}
          </button>
        </div>
      </aside>

      <div className="flex flex-col min-w-0 min-h-0">
        {p.supportUntil ? (
          <div role="status" className="flex-none bg-[#0E1A1F] text-white text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap">
            <ShieldCheck size={15} className="text-[#5FD3BC]" /><strong>{t("Medoro support · read-only")}</strong>
            <span className="text-[#B8C7CC]">{t("Access granted by the pharmacy until {time}. Changes and downloads are blocked; everything you open is audited.", { time: p.supportUntil })}</span>
          </div>
        ) : null}
        {p.deletionOn ? (
          <div role="alert" className="flex-none text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap bg-[#FBEAE8] text-[#8C1D18]">
            <strong>{t("This pharmacy will be permanently deleted on {date}.", { date: p.deletionOn })}</strong>
            {p.perms.includes("users") ? <Link href="/app/privacy#delete-account" className="font-semibold text-teal underline">{t("Cancel deletion")}</Link> : <span>{t("Ask the owner if this is a mistake.")}</span>}
          </div>
        ) : null}
        {p.subscription ? (
          <div role="status" className={cn("flex-none text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap", p.subscription.tone === "red" ? "bg-[#FBEAE8] text-[#8C1D18]" : "bg-[#FDF2E1] text-[#6B4A0E]")}>
            <CreditCard size={15} /><span>{t(p.subscription.text)}</span>
            {p.subscription.renew ? <Link href="/app/plan" className="font-semibold text-teal underline">{t("Renew")}</Link> : <span>{t("Ask the owner to renew.")}</span>}
          </div>
        ) : null}
        {live === "offline" ? (
          <div role="status" className="flex-none bg-[#FDF2E1] text-[#6B4A0E] text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap">
            <strong>{t("No connection to your server.")}</strong>
            <span>{offlineReady ? t("This counter can keep billing offline; bills post when the connection is back.") : t("Screens can’t load until it’s back.")}</span>
            {offlineReady ? <a href="/offline" className="font-semibold text-teal underline">{t("Open offline billing")}</a> : null}
          </div>
        ) : null}
        <header className={cn("app-head relative flex items-center h-14 bg-white border-b border-line flex-none", phone ? "gap-1 px-2" : "gap-2.5 px-5")}>
          {/* Soft moving tint, a faint dot band and a gradient line sliding along the bottom (off with reduced motion). */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="site-head-tint absolute inset-0 opacity-70" />
            <div className="site-head-dots absolute inset-y-0 right-0 w-[24%] [transform:scaleX(-1)]" />
            <div className="site-head-line absolute inset-x-0 -bottom-px h-[2px] opacity-60" />
          </div>
          <div className={cn("relative flex items-center gap-1.5 text-[13.5px] min-w-0", phone ? "flex-1" : "flex-none")}>
            {!narrow ? <><span className="text-faint whitespace-nowrap max-w-[160px] truncate">{p.tenantName.split(" ")[0]}</span><ChevronRight size={14} className="text-[#A3AAB1]" /></> : null}
            {phone ? <button onClick={() => setDrawer(true)} aria-label={t("Open menu")} aria-expanded={drawer} className="size-10 -ml-1 rounded-lg flex items-center justify-center text-ink-2 cursor-pointer hover:bg-chip flex-none"><Menu size={20} /></button> : (
              <>
                <div className="relative flex items-center">
                  <select value={p.branchId} onChange={(e) => start(() => setBranch(e.target.value))} aria-label={t("Branch")} className="appearance-none border-0 bg-transparent py-1 pl-1.5 pr-5 rounded-md text-[13.5px] text-ink-2 font-medium cursor-pointer outline-none hover:bg-chip">
                    {p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-1 text-fainter pointer-events-none" />
                </div>
                <ChevronRight size={14} className="text-[#A3AAB1]" />
              </>
            )}
            <span key={title} className="app-title font-semibold whitespace-nowrap truncate">{title}</span>
          </div>
          {READY.has("pos") && p.perms.includes("sale") && phone ? (
            <Link href="/app/pos?focus=1" aria-label={t("Search medicines")} className="relative size-10 rounded-lg flex items-center justify-center text-muted no-underline hover:bg-chip hover:text-muted flex-none"><Search size={18} /></Link>
          ) : READY.has("pos") && p.perms.includes("sale") ? (
            <Link href="/app/pos?focus=1" className="app-search group relative ml-4 mr-auto flex items-center gap-2 w-[min(380px,32vw)] min-w-[140px] h-[34px] px-2.5 border border-line bg-page/90 rounded-lg text-fainter text-[13px] no-underline transition-[border-color,background-color,box-shadow] duration-300 hover:border-teal-border hover:bg-white hover:text-fainter hover:shadow-[0_0_0_3px_rgba(20,184,166,.12)]">
              <Search size={15} className="transition-transform duration-300 group-hover:scale-110 group-hover:text-teal" /><span className="flex-1 truncate">{t("Search medicines…")}</span><span className="font-mono text-[11px] border border-[#E3E6E9] bg-white rounded px-[5px] text-faint">F2</span>
            </Link>
          ) : phone ? null : <div className="mx-auto" />}
          <div className="relative flex items-center gap-1.5 flex-none">
            <div title={live === "live" ? t(p.liveDevices === 1 ? "Live: changes from other devices appear here automatically. {n} device active in the last 5 minutes." : "Live: changes from other devices appear here automatically. {n} devices active in the last 5 minutes.", { n: p.liveDevices }) : live === "offline" ? t("This device is offline.") : t("Connecting to your server for live updates…")}
              className={cn("flex items-center gap-1.5 h-[30px] px-[9px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap", live === "live" ? "text-ok" : live === "offline" ? "text-bad" : "text-[#94570A]")}>
              <span className={cn("size-[7px] rounded-full", live === "live" ? "bg-[#22A06B] shadow-[0_0_0_3px_#DCF2E7] animate-pulse-dot" : live === "offline" ? "bg-[#D64545]" : "app-connecting bg-[#E0A82E]")} />
              {!narrow ? (live === "live" ? t("Live") : live === "offline" ? t("Offline") : t("Connecting")) : null}
            </div>
            {!phone ? <><div className="w-px h-5 bg-line" /><LangToggle lang={p.lang} onChange={(l) => start(() => setLang(l))} /></> : null}
            {p.canViewAs && !phone ? (
              <div title={t("Preview the app as another role. Permissions can only narrow.")} className="relative flex items-center">
                <UserRoundCog size={14} className="absolute left-[9px] text-faint pointer-events-none" />
                <select value={p.role} aria-label={t("View as role")} onChange={(e) => { const r = e.target.value; start(async () => { await setViewAs(r); toast(r === p.realRole ? "Back to your own role." : t("Now viewing as {role}. Menus and actions follow that role.", { role: t(r) }), "blue"); }); }}
                  className="appearance-none h-[30px] border border-line rounded-[7px] pl-7 pr-6 text-[12.5px] bg-white text-ink-2 font-medium cursor-pointer outline-none hover:border-input">
                  {["Owner", "Manager", "Pharmacist", "Cashier", "Accountant"].map((r) => <option key={r} value={r}>{r === p.realRole ? t(r) : t("View as {role}", { role: t(r) })}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-[7px] text-fainter pointer-events-none" />
              </div>
            ) : null}
            <button onClick={() => toast(p.alerts.length ? p.alerts.map((a) => t(a)).join(" · ") : "No alerts right now.", p.alerts.length ? "amber" : "gray")} title={t("Notifications")} className="group relative size-10 sm:size-8 rounded-[7px] text-muted cursor-pointer flex items-center justify-center hover:bg-chip">
              <Bell size={17} className={cn("transition-transform", p.alerts.length ? "app-ring" : "group-hover:rotate-12")} />{p.alerts.length ? <span className="app-ping absolute top-[7px] right-2 size-[7px] rounded-full bg-[#D64545] border-[1.5px] border-white" /> : null}
            </button>
            {showAi ? <button onClick={() => setAiOpen((x) => !x)} title={t("Ask AI (Ctrl+J)")} aria-expanded={aiOpen} className={cn("app-ai relative overflow-hidden flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-[7px] text-white text-[13px] font-semibold cursor-pointer whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,.08)] transition-[filter,transform,box-shadow] duration-300 hover:brightness-110 hover:-translate-y-px hover:shadow-[0_8px_18px_-10px_rgba(11,94,91,.8)]", aiOpen ? "bg-[#094A48]" : "bg-teal")}>
              <Sparkles size={15} className="site-sparkle" />{!narrow ? d.ask : null}
            </button> : null}
          </div>
        </header>
        <div className="relative flex-1 min-h-0 flex flex-col bg-page">
          {/* Dashboards get a soft animated backdrop behind the cards. */}
          {path === "/app" || (path === "/app/device-pos" && search.get("tab") === "dash") ? <DashBackdrop /> : null}
          <main className="relative flex-1 overflow-auto px-7 pt-6 pb-12 min-h-0 max-[640px]:px-4">{p.children}</main>
        </div>
      </div>
      {showAi ? <AiDrawer open={aiOpen} floating={narrow} onClose={() => setAiOpen(false)} lang={p.lang} placeholder={d.aiPh} ai={p.ai} /> : null}
      <ProfileModal open={profile} onClose={() => setProfile(false)} name={p.userName} email={p.userEmail} role={p.role} initials={initials} />
    </div>
  );
}

function Avatar({ initials, size, ring = "#FFFFFF" }: { initials: string; size: number; ring?: string }) {
  return (
    <div className="relative rounded-full text-white flex items-center justify-center font-semibold flex-none" style={{ width: size, height: size, fontSize: size * 0.4, background: "linear-gradient(135deg,#2459C9,#0A9A80)" }}>
      {initials}<span className="absolute -right-px -bottom-px size-[9px] rounded-full bg-[#22A06B] border-2" style={{ borderColor: ring }} />
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
  const t = useT(), lang = useLang();
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listSessions>>>([]);
  const [, start] = useTransition();
  useEffect(() => { if (open) listSessions().then(setSessions); }, [open]);
  const fmt = (iso: string) => new Date(iso).toLocaleString(localeOf(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return (
    <Modal open={open} onClose={onClose} width={480}
      footer={<><Button onClick={() => start(async () => { await revokeOtherSessions(); setSessions(await listSessions()); toast("All other devices signed out.", "green"); })}>Sign out all other devices</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <div className="flex items-center gap-3 pt-5">
        <div className="size-11 rounded-full bg-blue-tint text-blue flex items-center justify-center font-semibold text-[16px]">{initials}</div>
        <div className="flex flex-col"><strong className="text-[17px]">{name}</strong><span className="text-[12.5px] text-muted">{t(role)} · {email}</span></div>
      </div>
      {open ? <SignInSecurity /> : null}
      <div className="flex flex-col">
        <div className="text-[12.5px] text-muted font-medium mb-1">{t("Active sessions")}</div>
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 py-2 border-b border-row text-[13.5px]">
            <Monitor size={16} className="text-muted" />
            <div className="flex flex-col flex-1 min-w-0"><span className="font-medium">{s.device}</span><span className="text-[12px] text-muted truncate">{t("signed in {when} · {ip} · last active {seen}", { when: fmt(s.created), ip: s.ip ?? t("local"), seen: fmt(s.lastSeen) })}</span></div>
            {s.isThis ? <span className="text-[12px] text-ok">{t("This device")}</span> : (
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
  const t = useT();
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
    if (next !== next2) return setErr(pin ? t("PINs do not match.") : t("Passwords do not match."));
    start(async () => {
      const r = pin ? await changePinAction(cur, next) : await changePasswordAction(cur, next);
      if (!r.ok) return setErr(t(r.error));
      toast(r.message ?? "Saved.", "green");
      setPanel(null); setCur(""); setNext(""); setNext2("");
    });
  };

  return (
    <div className="flex flex-col">
      <div className="text-[12.5px] text-muted font-medium mb-1">{t("Sign-in & security")}</div>
      {sec.hasPassword || sec.hasPin ? (
        <div className={row}>
          <KeyRound size={16} className="text-muted" />
          <span className="flex-1 font-medium">{pin ? "PIN" : t("Password")}</span>
          {panel !== "secret" ? <Button size="sm" onClick={() => { setPanel("secret"); setErr(""); }}>Change</Button> : null}
        </div>
      ) : null}
      {panel === "secret" ? (
        <div className="flex flex-col gap-2 py-2.5 border-b border-row">
          {pin ? (
            <>
              <Input type="password" inputMode="numeric" placeholder={t("Current PIN")} aria-label={t("Current PIN")} value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="off" />
              <Input type="password" inputMode="numeric" placeholder={t("New 4-digit PIN")} aria-label={t("New PIN")} value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="off" />
              <Input type="password" inputMode="numeric" placeholder={t("Confirm new PIN")} aria-label={t("Confirm new PIN")} value={next2} onChange={(e) => setNext2(e.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="off" />
            </>
          ) : (
            <>
              <Input type="password" placeholder={t("Current password")} aria-label={t("Current password")} value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
              <Input type="password" placeholder={t("New password (10+ characters)")} aria-label={t("New password")} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
              <Input type="password" placeholder={t("Confirm new password")} aria-label={t("Confirm new password")} value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" />
            </>
          )}
          {err ? <div role="alert" className="text-[12.5px] text-bad">{err}</div> : null}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setPanel(null); setErr(""); }}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={pending} onClick={saveSecret}>{pending ? t("Saving…") : pin ? t("Change PIN") : t("Change password")}</Button>
          </div>
        </div>
      ) : null}
      {sec.google.email || sec.google.available ? (
        <div className={row}>
          <span className="size-4 flex items-center justify-center font-bold text-[13px] text-muted">G</span>
          <div className="flex flex-col flex-1 min-w-0"><span className="font-medium">{t("Google sign-in")}</span><span className="text-[12px] text-muted truncate">{sec.google.email ? t("Connected · {email}", { email: sec.google.email }) : t("Not connected")}</span></div>
          {sec.google.email ? (
            <Button size="sm" variant="danger-outline" disabled={pending} onClick={() => { if (confirm(t("Disconnect Google? You’ll sign in with your password."))) start(async () => { const r = await disconnectGoogleAction(); toast(r.ok ? r.message ?? "Disconnected." : r.error, r.ok ? "green" : "red"); await load(); }); }}>Disconnect</Button>
          ) : <a href="/api/auth/google/start?intent=link" className="h-7 px-2.5 inline-flex items-center rounded-md border border-input bg-white text-[12.5px] font-medium text-ink no-underline hover:border-teal">{t("Connect Google")}</a>}
        </div>
      ) : null}
      {sec.mfa ? (
        <div className={row}>
          <ShieldCheck size={16} className="text-muted" />
          <div className="flex flex-col flex-1 min-w-0"><span className="font-medium">{t("Recovery codes")}</span><span className="text-[12px]" style={{ color: sec.recoveryLeft <= 3 ? "#B3261E" : "#6B737B" }}>{t("{n} of 10 left · each signs in once without your authenticator", { n: sec.recoveryLeft })}</span></div>
          <Button size="sm" disabled={pending} onClick={() => { if (confirm(t("Make 10 new recovery codes? Your old codes stop working."))) start(async () => { const r = await regenerateCodesAction(); if (!r.ok) return toast(r.error, "red"); setCodes(r.data); await load(); }); }}>Regenerate</Button>
        </div>
      ) : null}
      {codes ? (
        <div className="flex flex-col gap-2 py-2.5 border-b border-row">
          <span className="text-[12.5px] text-muted">{t("Save these now: they won’t be shown again.")}</span>
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
