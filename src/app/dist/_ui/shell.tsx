"use client";
// MEDORO Distribution shell. Same look, motion and behaviour as the MEDORO Pharmacy shell
// (src/components/shell/shell.tsx): teal sidebar with the Medoro mark, "Find a screen", collapsible groups,
// rail on narrow screens and a drawer on phones, the animated header (tint, dots, sliding line), the same
// account menu, language toggle and notification bell, and the floating dashboard backdrop on every screen.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  BadgeIndianRupee, BarChart3, Bell, Boxes, Building2, CalendarClock, ChevronDown, ChevronRight, ClipboardList, CreditCard, Ellipsis, FileText, Gauge,
  Keyboard, Landmark, Languages, LogOut, MapPin, MapPinned, Menu, Network, Package, PackageCheck, Percent, Receipt, RotateCcw, Search, Settings,
  ShieldCheck, ShoppingCart, Smartphone, Sparkles, Store, Truck, Undo2, Users, Warehouse, X,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { DashBackdrop } from "@/components/welcome-banner";
import { useT } from "@/lib/i18n-client";
import type { Lang } from "@/lib/i18n";
import { setBranch, setLang } from "@/app/app/actions";
import { signOut } from "@/app/(auth)/actions";
import { useOnChange } from "@/lib/react-state";

type Icon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>;
type Item = { href: string; label: string; abbr: string; icon: Icon; perms: string[]; group: string; badge?: string };

const NAV: Item[] = [
  { href: "/dist", label: "Dashboard", abbr: "Home", icon: Gauge, perms: [], group: "Overview" },
  { href: "/dist/insights", label: "Business intelligence", abbr: "Insights", icon: Sparkles, perms: ["insights"], group: "Overview" },
  { href: "/dist/orders", label: "Orders", abbr: "Orders", icon: ClipboardList, perms: ["order", "approve"], group: "Sales", badge: "orders" },
  { href: "/dist/billing", label: "New invoice", abbr: "Bill", icon: Receipt, perms: ["bill"], group: "Sales" },
  { href: "/dist/invoices", label: "Invoices", abbr: "Invoices", icon: FileText, perms: ["bill", "reports", "payments"], group: "Sales" },
  { href: "/dist/returns", label: "Credit notes", abbr: "Returns", icon: Undo2, perms: ["bill"], group: "Sales" },
  { href: "/dist/field", label: "Field app", abbr: "Field", icon: Smartphone, perms: ["order"], group: "Sales" },
  { href: "/dist/warehouse", label: "Pick & pack", abbr: "Pick", icon: PackageCheck, perms: ["warehouse"], group: "Warehouse", badge: "picks" },
  { href: "/dist/dispatch", label: "Dispatch", abbr: "Dispatch", icon: Truck, perms: ["dispatch"], group: "Warehouse", badge: "dispatch" },
  { href: "/dist/deliveries", label: "My deliveries", abbr: "Deliver", icon: MapPinned, perms: ["delivery"], group: "Warehouse" },
  { href: "/dist/stock", label: "Stock & transfers", abbr: "Stock", icon: Boxes, perms: ["adjust", "warehouse", "purchase"], group: "Warehouse" },
  { href: "/dist/expiry", label: "Expiry & claims", abbr: "Expiry", icon: CalendarClock, perms: ["purchase"], group: "Warehouse", badge: "expiry" },
  { href: "/dist/purchases", label: "Purchases & GRN", abbr: "Buy", icon: ShoppingCart, perms: ["purchase"], group: "Purchase" },
  { href: "/dist/collections", label: "Collections", abbr: "Collect", icon: BadgeIndianRupee, perms: ["payments"], group: "Finance" },
  { href: "/dist/credit", label: "Credit control", abbr: "Credit", icon: CreditCard, perms: ["payments", "approve", "reports"], group: "Finance" },
  { href: "/dist/accounts", label: "Accounts & bank", abbr: "A/c", icon: Landmark, perms: ["reports"], group: "Finance" },
  { href: "/dist/gst", label: "GST returns", abbr: "GST", icon: Percent, perms: ["reports"], group: "Finance" },
  { href: "/dist/reports", label: "MIS reports", abbr: "MIS", icon: BarChart3, perms: ["reports"], group: "Finance" },
  { href: "/dist/products", label: "Products", abbr: "Products", icon: Package, perms: ["masters"], group: "Masters" },
  { href: "/dist/chemists", label: "Chemists", abbr: "Chemists", icon: Store, perms: ["masters"], group: "Masters" },
  { href: "/dist/companies", label: "Companies & principals", abbr: "Cos.", icon: Building2, perms: ["masters"], group: "Masters" },
  { href: "/dist/schemes", label: "Schemes", abbr: "Schemes", icon: RotateCcw, perms: ["masters"], group: "Masters" },
  { href: "/dist/territories", label: "Territories & salesmen", abbr: "Areas", icon: Network, perms: ["masters"], group: "Masters" },
  { href: "/dist/godowns", label: "Godowns & racks", abbr: "Godowns", icon: Warehouse, perms: ["masters", "adjust"], group: "Masters" },
  { href: "/dist/portal-admin", label: "Chemist portal", abbr: "Portal", icon: Store, perms: ["portal"], group: "System", badge: "portal" },
  { href: "/dist/users", label: "Users & roles", abbr: "Users", icon: Users, perms: ["users"], group: "System" },
  { href: "/dist/plan", label: "Subscription", abbr: "Plan", icon: ShieldCheck, perms: ["users"], group: "System" },
  { href: "/dist/settings", label: "Settings", abbr: "Settings", icon: Settings, perms: ["users", "integrations"], group: "System" },
];

const BADGE = { amber: ["#FDF2E1", "#94570A"], red: ["#FDECEC", "#C0362C"] } as const;

export type DistShellProps = {
  children: React.ReactNode; tenant: string; user: string; email: string; role: string; perms: string[]; branches: { id: string; name: string }[]; branchId: string; lang: Lang;
  badges: Record<string, number>; alerts: string[]; banner: { text: string; tone: "amber" | "red" } | null;
};

export function DistShell(p: DistShellProps) {
  return <ToastProvider><Inner {...p} /></ToastProvider>;
}

function Inner(p: DistShellProps) {
  const t = useT();
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [narrow, setNarrow] = useState(false);
  const [phone, setPhone] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [find, setFind] = useState("");
  const [menu, setMenu] = useState(false);
  const [, start] = useTransition();
  const rail = narrow && !phone;

  const shortcuts = () => { setMenu(false); toast("/ search · g then o orders, b new invoice, i invoices, w pick & pack, s stock, c chemists, p products, m collections, r reports · ? shortcuts", "gray"); };
  useEffect(() => {
    const on = () => { setNarrow(window.innerWidth < 1180); setPhone(window.innerWidth < 768); };
    on(); window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  useOnChange([path], () => { setDrawer(false); setMenu(false); });
  // "/" focuses the screen's search box; "g" then a letter jumps to a screen; "?" lists the shortcuts.
  useEffect(() => {
    let g = false, timer: ReturnType<typeof setTimeout> | undefined;
    const go: Record<string, string> = { d: "/dist", o: "/dist/orders", b: "/dist/billing", i: "/dist/invoices", w: "/dist/warehouse", p: "/dist/products", c: "/dist/chemists", r: "/dist/reports", s: "/dist/stock", m: "/dist/collections" };
    const k = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.key === "Escape" && drawer) { setDrawer(false); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); shortcuts(); return; }
      if (e.key === "/") { const s = document.querySelector<HTMLInputElement>("input[data-search]"); if (s) { e.preventDefault(); s.focus(); } return; }
      if (g && go[e.key]) { e.preventDefault(); g = false; router.push(go[e.key]); return; }
      g = e.key === "g"; clearTimeout(timer); timer = setTimeout(() => (g = false), 900);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const allowed = NAV.filter((n) => !n.perms.length || n.perms.some((x) => p.perms.includes(x)));
  const finding = find.trim().toLowerCase();
  const shown = finding ? allowed.filter((n) => `${t(n.label)} ${n.label}`.toLowerCase().includes(finding)) : allowed;
  const isActive = (href: string) => (href === "/dist" ? path === "/dist" : path === href || path.startsWith(href + "/"));
  const cur = [...allowed].sort((a, b) => b.href.length - a.href.length).find((n) => isActive(n.href));
  const title = cur ? t(cur.label) : "";
  const initials = p.user.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="grid h-dvh w-full overflow-hidden bg-bg text-[14px]" style={{ gridTemplateColumns: (phone ? "" : rail ? "76px " : "232px ") + "minmax(0,1fr)" }}>
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
                <span className="text-[14px] font-bold text-white truncate">{p.tenant}</span>
                <span className="text-[10px] tracking-[.08em] uppercase text-white/50 whitespace-nowrap">{t("Distribution")} · {t(p.branches.length === 1 ? "{n} godown" : "{n} godowns", { n: p.branches.length })}</span>
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
            const a = cur?.href === n.href;
            const head = !rail && !finding && (i === 0 || shown[i - 1].group !== n.group);
            const hidden = !rail && !finding && closed[n.group] && !a;
            const count = n.badge ? p.badges[n.badge] ?? 0 : 0;
            return (
              <div key={n.href} className="contents">
                {head ? (
                  <button onClick={() => setClosed((x) => ({ ...x, [n.group]: !x[n.group] }))} aria-expanded={!closed[n.group]}
                    className={cn("group/head flex items-center justify-between gap-1 px-2 pb-1 text-[10.5px] font-bold uppercase tracking-[.12em] text-white/45 hover:text-white/80 cursor-pointer text-left", i === 0 ? "pt-2" : "mt-1.5 pt-3")}>
                    <span>{t(n.group)}</span>
                    {closed[n.group] ? <ChevronRight size={12} className="opacity-60 group-hover/head:opacity-100" /> : <ChevronDown size={12} className="opacity-60 group-hover/head:opacity-100" />}
                  </button>
                ) : null}
                {!hidden ? (
                  <Link href={n.href} prefetch={false} title={t(n.label)} aria-current={a ? "page" : undefined} className={cn("relative flex flex-none items-center rounded-lg text-[13.5px] no-underline transition-colors", phone ? "min-h-[44px]" : "min-h-[34px]",
                    rail ? "flex-col gap-1 px-1 py-[7px]" : "gap-[11px] px-2.5 py-1.5",
                    a ? "bg-white/[.16] text-white font-semibold shadow-[inset_3px_0_0_#14B8A6]" : "text-white/75 font-medium hover:bg-white/10 hover:text-white")}>
                    <n.icon size={17} strokeWidth={a ? 2.1 : 1.8} className="flex-none" />
                    {!rail ? <span className="flex-1 truncate">{t(n.label)}</span> : <span className="text-[10px] leading-none whitespace-nowrap">{t(n.abbr)}</span>}
                    {!rail && count ? <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center tnum" style={{ background: BADGE[n.badge === "expiry" ? "red" : "amber"][0], color: BADGE[n.badge === "expiry" ? "red" : "amber"][1] }}>{count}</span> : null}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </nav>
        {!rail ? (
          <Link href={p.perms.includes("users") ? "/dist/settings" : "/dist"} title={t("Your distribution records stay in your own database. Integrations show their real status under Settings.")} className="mx-2.5 mb-2 mt-1 flex items-center gap-2 h-9 px-2.5 rounded-xl bg-white/10 border border-white/15 text-[12px] text-white/85 no-underline transition-colors hover:bg-white/[.14] hover:text-white">
            <ShieldCheck size={14} style={{ color: "#5EEAD4" }} /><span className="truncate">{t("Data stays in your database")}</span>
          </Link>
        ) : null}
        <div className="relative border-t border-white/10 px-2.5 py-2 flex-none">
          {menu ? (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setMenu(false)} />
              <div className="absolute left-2 bottom-[calc(100%+6px)] w-64 bg-white border border-line rounded-[10px] shadow-pop z-[71] p-1 flex flex-col">
                <div className="flex items-center gap-2.5 p-2.5">
                  <Avatar initials={initials} size={34} />
                  <div className="flex flex-col min-w-0 leading-tight"><span className="text-[13.5px] font-semibold text-ink-strong truncate">{p.user}</span><span className="text-[12px] text-faint truncate">{p.email}</span></div>
                </div>
                <div className="flex gap-1 flex-wrap px-2.5 pb-2.5">
                  <Chip bg="#E1F1EF" fg="#0B5E5B" strong>{t(p.role)}</Chip>
                  <Chip bg="#F2F4F5" fg="#3D454D"><MapPin size={11} />{p.branches.find((b) => b.id === p.branchId)?.name}</Chip>
                </div>
                <div className="h-px bg-line-soft -mx-1 mb-1" />
                {p.perms.includes("users") ? <MenuItem icon={CreditCard} onClick={() => { setMenu(false); router.push("/dist/plan"); }}>{t("Subscription")}</MenuItem> : null}
                <div className="flex items-center gap-2.5 h-[34px] pl-2.5 pr-1.5 text-[13px]">
                  <Languages size={15} className="text-faint" /><span className="flex-1">{t("Language")}</span>
                  <LangToggle lang={p.lang} small onChange={(l) => start(async () => { await setLang(l); router.refresh(); })} />
                </div>
                <div className="h-px bg-line-soft -mx-1 my-1" />
                <MenuItem icon={Keyboard} kbd="?" onClick={shortcuts}>{t("Keyboard shortcuts")}</MenuItem>
                <div className="h-px bg-line-soft -mx-1 my-1" />
                <MenuItem icon={LogOut} danger onClick={() => start(() => signOut())}>{t("Sign out")}</MenuItem>
                <div className="px-3.5 py-1.5 text-[11px] text-[#A3AAB1] border-t border-line-soft -mx-1 mt-1">Medoro Distribution 0.1.0</div>
              </div>
            </>
          ) : null}
          <button onClick={() => setMenu((x) => !x)} title={t("Account menu")} className={cn("flex items-center gap-[10px] p-1.5 w-full rounded-lg cursor-pointer text-left transition-colors hover:bg-white/10", menu && "bg-white/10")}>
            <Avatar initials={initials} size={28} ring="#0B5E5B" />
            {!rail ? (
              <>
                <div className="flex flex-col min-w-0 flex-1 leading-tight"><div className="text-[13px] font-semibold truncate text-white">{p.user}</div><div className="text-[11.5px] text-white/60">{t(p.role)} · {p.branches.find((b) => b.id === p.branchId)?.name}</div></div>
                <Ellipsis size={16} className="text-white/60" />
              </>
            ) : null}
          </button>
        </div>
      </aside>

      <div className="flex flex-col min-w-0 min-h-0">
        {p.banner ? (
          <div role="status" className={cn("flex-none text-[13px] px-5 py-2 flex items-center gap-2 flex-wrap", p.banner.tone === "red" ? "bg-[#FBEAE8] text-[#8C1D18]" : "bg-[#FDF2E1] text-[#6B4A0E]")}>
            <CreditCard size={15} /><span>{t(p.banner.text)}</span>
          </div>
        ) : null}
        <header className={cn("app-head relative flex items-center h-14 bg-white border-b border-line flex-none", phone ? "gap-1 px-2" : "gap-2.5 px-5")}>
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="site-head-tint absolute inset-0 opacity-70" />
            <div className="site-head-dots absolute inset-y-0 right-0 w-[24%] [transform:scaleX(-1)]" />
            <div className="site-head-line absolute inset-x-0 -bottom-px h-[2px] opacity-60" />
          </div>
          <div className={cn("relative flex items-center gap-1.5 text-[13.5px] min-w-0", phone ? "flex-1" : "flex-none")}>
            {!narrow ? <><span className="text-faint whitespace-nowrap max-w-[160px] truncate">{p.tenant.split(" ")[0]}</span><ChevronRight size={14} className="text-[#A3AAB1]" /></> : null}
            {phone ? <button onClick={() => setDrawer(true)} aria-label={t("Open menu")} aria-expanded={drawer} className="size-10 -ml-1 rounded-lg flex items-center justify-center text-ink-2 cursor-pointer hover:bg-chip flex-none"><Menu size={20} /></button> : (
              <>
                <div className="relative flex items-center">
                  <select value={p.branchId} onChange={(e) => start(async () => { await setBranch(e.target.value); router.refresh(); })} aria-label={t("Godown")} className="appearance-none border-0 bg-transparent py-1 pl-1.5 pr-5 rounded-md text-[13.5px] text-ink-2 font-medium cursor-pointer outline-none hover:bg-chip">
                    {p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-1 text-fainter pointer-events-none" />
                </div>
                <ChevronRight size={14} className="text-[#A3AAB1]" />
              </>
            )}
            <span key={title} className="app-title font-semibold whitespace-nowrap truncate">{title}</span>
          </div>
          {p.perms.includes("bill") && !phone ? (
            <Link href="/dist/billing" className="app-search group relative ml-4 mr-auto flex items-center gap-2 w-[min(380px,32vw)] min-w-[140px] h-[34px] px-2.5 border border-line bg-page/90 rounded-lg text-fainter text-[13px] no-underline transition-[border-color,background-color,box-shadow] duration-300 hover:border-teal-border hover:bg-white hover:text-fainter hover:shadow-[0_0_0_3px_rgba(20,184,166,.12)]">
              <Search size={15} className="transition-transform duration-300 group-hover:scale-110 group-hover:text-teal" /><span className="flex-1 truncate">{t("Bill a chemist…")}</span><span className="font-mono text-[11px] border border-[#E3E6E9] bg-white rounded px-[5px] text-faint">g b</span>
            </Link>
          ) : phone ? null : <div className="mx-auto" />}
          <div className="relative flex items-center gap-1.5 flex-none">
            {!phone ? <><LangToggle lang={p.lang} onChange={(l) => start(async () => { await setLang(l); router.refresh(); })} /><div className="w-px h-5 bg-line" /></> : null}
            <button onClick={() => toast(p.alerts.length ? p.alerts.map((a) => t(a)).join(" · ") : "No alerts right now.", p.alerts.length ? "amber" : "gray")} title={t("Notifications")} className="group relative size-10 sm:size-8 rounded-[7px] text-muted cursor-pointer flex items-center justify-center hover:bg-chip">
              <Bell size={17} className={cn("transition-transform", p.alerts.length ? "app-ring" : "group-hover:rotate-12")} />{p.alerts.length ? <span className="app-ping absolute top-[7px] right-2 size-[7px] rounded-full bg-[#D64545] border-[1.5px] border-white" /> : null}
            </button>
            {p.perms.includes("insights") ? (
              <Link href="/dist/insights" title={t("Business intelligence")} className="app-ai relative overflow-hidden flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-[7px] text-white text-[13px] font-semibold no-underline whitespace-nowrap bg-teal shadow-[0_1px_2px_rgba(16,24,40,.08)] transition-[filter,transform,box-shadow] duration-300 hover:text-white hover:brightness-110 hover:-translate-y-px hover:shadow-[0_8px_18px_-10px_rgba(11,94,91,.8)]">
                <Sparkles size={15} className="site-sparkle" />{!narrow ? t("Insights") : null}
              </Link>
            ) : null}
          </div>
        </header>
        <div className="relative flex-1 min-h-0 flex flex-col bg-page">
          <DashBackdrop />
          <main className="app-motion relative flex-1 overflow-auto px-7 pt-6 pb-12 min-h-0 max-[640px]:px-4">{p.children}</main>
        </div>
      </div>
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

function MenuItem({ icon: Icon, children, onClick, kbd, danger }: { icon: Icon; children: React.ReactNode; onClick: () => void; kbd?: string; danger?: boolean }) {
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
