"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BarChart3, Boxes, Building2, ClipboardList, CreditCard, FileText, Gauge, Landmark, LogOut, Menu, Package, PackageCheck, Percent, Receipt, RotateCcw, Settings, ShieldCheck, ShoppingCart, Sparkles, Store, Truck, Undo2, Users, Warehouse, X, MapPinned, CalendarClock, Smartphone, BadgeIndianRupee, Network } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useT } from "@/lib/i18n-client";
import { setBranch, setLang } from "@/app/app/actions";
import { signOut } from "@/app/(auth)/actions";

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; perms: string[]; badge?: number };
type Group = { title: string; items: Item[] };

export function DistShell({ children, tenant, user, role, perms, branches, branchId, lang, badges, banner }: {
  children: React.ReactNode; tenant: string; user: string; role: string; perms: string[]; branches: { id: string; name: string }[]; branchId: string; lang: "en" | "hi";
  badges: Record<string, number>; banner: { text: string; tone: "amber" | "red" } | null;
}) {
  const t = useT();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  useEffect(() => setOpen(false), [path]);
  // Keyboard: "/" focuses the page's search box; g then a letter jumps to a screen.
  useEffect(() => {
    let g = false, timer: ReturnType<typeof setTimeout> | undefined;
    const go: Record<string, string> = { d: "/dist", o: "/dist/orders", b: "/dist/billing", i: "/dist/invoices", w: "/dist/warehouse", p: "/dist/products", c: "/dist/chemists", r: "/dist/reports", s: "/dist/stock", m: "/dist/collections" };
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { const s = document.querySelector<HTMLInputElement>("input[data-search]"); if (s) { e.preventDefault(); s.focus(); } return; }
      if (g && go[e.key]) { e.preventDefault(); g = false; router.push(go[e.key]); return; }
      g = e.key === "g"; clearTimeout(timer); timer = setTimeout(() => (g = false), 900);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [router]);

  const groups: Group[] = [
    { title: "Overview", items: [
      { href: "/dist", label: "Dashboard", icon: Gauge, perms: [] },
      { href: "/dist/insights", label: "Business intelligence", icon: Sparkles, perms: ["insights"] },
    ] },
    { title: "Sales", items: [
      { href: "/dist/orders", label: "Orders", icon: ClipboardList, perms: ["order", "approve"], badge: badges.orders },
      { href: "/dist/billing", label: "New invoice", icon: Receipt, perms: ["bill"] },
      { href: "/dist/invoices", label: "Invoices", icon: FileText, perms: ["bill", "reports", "payments"] },
      { href: "/dist/returns", label: "Credit notes", icon: Undo2, perms: ["bill"] },
      { href: "/dist/field", label: "Field app", icon: Smartphone, perms: ["order"] },
    ] },
    { title: "Warehouse", items: [
      { href: "/dist/warehouse", label: "Pick & pack", icon: PackageCheck, perms: ["warehouse"], badge: badges.picks },
      { href: "/dist/dispatch", label: "Dispatch", icon: Truck, perms: ["dispatch"], badge: badges.dispatch },
      { href: "/dist/deliveries", label: "My deliveries", icon: MapPinned, perms: ["delivery"] },
      { href: "/dist/stock", label: "Stock & transfers", icon: Boxes, perms: ["adjust", "warehouse", "purchase"] },
      { href: "/dist/expiry", label: "Expiry & claims", icon: CalendarClock, perms: ["purchase"], badge: badges.expiry },
    ] },
    { title: "Purchase", items: [
      { href: "/dist/purchases", label: "Purchases & GRN", icon: ShoppingCart, perms: ["purchase"] },
    ] },
    { title: "Finance", items: [
      { href: "/dist/collections", label: "Collections", icon: BadgeIndianRupee, perms: ["payments"] },
      { href: "/dist/credit", label: "Credit control", icon: CreditCard, perms: ["payments", "approve", "reports"] },
      { href: "/dist/accounts", label: "Accounts & bank", icon: Landmark, perms: ["reports"] },
      { href: "/dist/gst", label: "GST returns", icon: Percent, perms: ["reports"] },
      { href: "/dist/reports", label: "MIS reports", icon: BarChart3, perms: ["reports"] },
    ] },
    { title: "Masters", items: [
      { href: "/dist/products", label: "Products", icon: Package, perms: ["masters"] },
      { href: "/dist/chemists", label: "Chemists", icon: Store, perms: ["masters"] },
      { href: "/dist/companies", label: "Companies & principals", icon: Building2, perms: ["masters"] },
      { href: "/dist/schemes", label: "Schemes", icon: RotateCcw, perms: ["masters"] },
      { href: "/dist/territories", label: "Territories & salesmen", icon: Network, perms: ["masters"] },
      { href: "/dist/godowns", label: "Godowns & racks", icon: Warehouse, perms: ["masters", "adjust"] },
    ] },
    { title: "Administration", items: [
      { href: "/dist/portal-admin", label: "Chemist portal", icon: Store, perms: ["portal"], badge: badges.portal },
      { href: "/dist/users", label: "Users & roles", icon: Users, perms: ["users"] },
      { href: "/dist/plan", label: "Subscription", icon: ShieldCheck, perms: ["users"] },
      { href: "/dist/settings", label: "Settings", icon: Settings, perms: ["users", "integrations"] },
    ] },
  ];
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.perms.length || i.perms.some((p) => perms.includes(p))) })).filter((g) => g.items.length);
  const active = (href: string) => (href === "/dist" ? path === "/dist" : path === href || path.startsWith(href + "/"));

  const nav = (
    <nav className="flex flex-col gap-4 py-4 px-3">
      {visible.map((g) => (
        <div key={g.title}>
          <div className="px-2 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#8A9BB4]">{t(g.title)}</div>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} className={cn("flex items-center gap-2.5 h-8 px-2 rounded-md text-[13px] font-medium", active(i.href) ? "bg-white/10 text-white" : "text-[#C3CFDF] hover:text-white hover:bg-white/5")}>
              <i.icon size={15} /><span className="flex-1 truncate">{t(i.label)}</span>
              {i.badge ? <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#F2B544] text-[#0B2545] text-[11px] font-bold inline-flex items-center justify-center">{i.badge}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-[#F4F6F9] text-[#0B2545]">
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-[248px] bg-[#0B2545] flex flex-col transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-white/10">
          <span className="size-8 rounded-md bg-white text-[#0B2545] font-bold flex items-center justify-center text-[13px]">MD</span>
          <div className="min-w-0">
            <div className="text-white text-[13.5px] font-semibold leading-tight">MEDORO</div>
            <div className="text-[#8FA6C6] text-[11px] leading-tight tracking-[0.08em] uppercase">{t("Distribution")}</div>
          </div>
          <button className="ml-auto lg:hidden text-white p-2" onClick={() => setOpen(false)} aria-label={t("Close")}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-white/10 p-3 text-[12px] text-[#8FA6C6]">{t("Keys")}: <kbd className="text-white">/</kbd> {t("search")} · <kbd className="text-white">g</kbd> + <kbd className="text-white">o</kbd> {t("orders")}</div>
      </aside>
      {open ? <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} /> : null}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-[#E3E7ED] flex items-center gap-3 px-4">
          <button className="lg:hidden p-2 -ml-2" onClick={() => setOpen(true)} aria-label={t("Menu")}><Menu size={20} /></button>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold truncate">{tenant}</div>
          </div>
          {branches.length > 1 ? (
            <select aria-label={t("Godown")} value={branchId} onChange={(e) => start(async () => { await setBranch(e.target.value); router.refresh(); })} className="h-9 rounded-md border border-[#C9D2DE] px-2 text-[13px] bg-white max-w-[160px]">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : <span className="hidden sm:inline text-[12.5px] text-[#5B6B82]">{branches[0]?.name}</span>}
          <button onClick={() => start(async () => { await setLang(lang === "hi" ? "en" : "hi"); router.refresh(); })} className="h-9 px-2.5 rounded-md border border-[#C9D2DE] text-[13px] font-semibold" aria-label="Language">{lang === "hi" ? "EN" : "हिं"}</button>
          <div className="hidden md:flex flex-col items-end leading-tight">
            <span className="text-[13px] font-semibold">{user}</span>
            <span className="text-[11.5px] text-[#5B6B82]">{t(role)}</span>
          </div>
          <button onClick={() => start(() => signOut())} className="p-2 text-[#5B6B82] hover:text-[#B3261E]" aria-label={t("Sign out")} title={t("Sign out")}><LogOut size={18} /></button>
        </header>
        {banner ? <div className={cn("px-4 py-2 text-[13px] font-medium", banner.tone === "red" ? "bg-[#FBEAE8] text-[#B3261E]" : "bg-[#FDF2E1] text-[#94570A]")}>{t(banner.text)}</div> : null}
        <main className="p-4 md:p-6 max-w-[1440px]">{children}</main>
      </div>
    </div>
  );
}
