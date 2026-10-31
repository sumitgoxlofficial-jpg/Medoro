"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { BadgeIndianRupee, Building2, Kanban, LayoutDashboard, LifeBuoy, Lock, LogOut, Percent, Ticket, Users, Wallet } from "lucide-react";
import { ToastProvider } from "@/components/ui/toast";
import { ROLE_LABEL, type StaffRoleId } from "@/staff/constants";
import { staffSignOut } from "../actions";
import { NAV, type View } from "./nav";

const ICON: Record<View, typeof Users> = { overview: LayoutDashboard, employees: Users, commission: Percent, leads: Kanban, sales: BadgeIndianRupee, payouts: Wallet, customers: Building2, tickets: LifeBuoy, coupons: Ticket };

export function ConsoleShell({ me, badges, children }: { me: { name: string; role: StaffRoleId; empNo: string }; badges: Record<string, number>; children: React.ReactNode }) {
  const path = usePathname();
  const [, start] = useTransition();
  const nav = NAV[me.role];
  const cur = nav.find(([v]) => path.startsWith(`/staff/${v}`)) ?? nav[0];
  const initials = me.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  return (
    <ToastProvider>
      <div className="h-dvh grid grid-cols-1 min-[900px]:grid-cols-[240px_minmax(0,1fr)] bg-[#F5F6F7] text-ink overflow-hidden leading-[1.45]">
        <aside className="hidden min-[900px]:flex flex-col min-h-0 bg-[#0E1A1F] text-[#DCE6E9]">
          <div className="h-16 flex items-center gap-2.5 px-4 border-b border-white/[.08]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/medoro-mark.png" alt="" className="w-7 h-auto" />
            <div className="flex flex-col leading-[1.2]"><span className="font-cond font-bold text-[18px] tracking-[.02em] uppercase text-white">Medoro</span><span className="text-[11px] text-[#7F9399] tracking-[.06em] uppercase">Staff console</span></div>
          </div>
          <nav className="flex flex-col gap-0.5 px-2 py-2.5 flex-1 overflow-auto">
            {nav.map(([v, label]) => {
              const Icon = ICON[v], a = cur[0] === v, b = badges[v] ?? 0;
              return (
                <Link key={v} href={`/staff/${v}`} className={`flex items-center gap-2.5 text-[13.5px] px-2.5 py-[9px] rounded-[7px] ${a ? "bg-[rgba(95,211,188,.14)] text-white font-semibold" : "text-[#B8C7CC] font-medium hover:bg-white/[.06] hover:text-white"}`}>
                  <Icon size={16} className="w-[18px]" /><span className="flex-1">{label}</span>
                  {b ? <span className="min-w-[18px] h-[18px] px-[5px] rounded-[9px] bg-[#5FD3BC] text-[#0E1A1F] text-[11px] font-bold flex items-center justify-center">{b}</span> : null}
                </Link>
              );
            })}
          </nav>
          <div className="m-2 px-3 py-2.5 border border-white/10 rounded-lg text-[11.5px] text-[#9DB0B5] flex gap-2"><Lock size={13} className="text-[#5FD3BC] mt-0.5 flex-none" /><span>Account data only. No access to any pharmacy’s database, invoices or backups.</span></div>
          <div className="flex items-center gap-2.5 px-3.5 py-3 border-t border-white/[.08]">
            <span className="size-[30px] rounded-full bg-teal text-white flex items-center justify-center text-[12px] font-semibold flex-none">{initials}</span>
            <div className="flex flex-col min-w-0 leading-[1.25] flex-1"><span className="text-[13px] font-semibold text-white truncate">{me.name}</span><span className="text-[11.5px] text-[#7F9399]">{ROLE_LABEL[me.role]} · {me.empNo}</span></div>
            <button onClick={() => start(() => staffSignOut())} title="Sign out" className="text-[#9DB0B5] hover:text-white cursor-pointer"><LogOut size={16} /></button>
          </div>
        </aside>
        <div className="flex flex-col min-w-0 min-h-0">
          <header className="h-16 flex-none bg-white border-b border-[#E6E8EB] flex items-center gap-3 px-5 max-[640px]:px-4">
            <strong className="text-[17px] whitespace-nowrap truncate">{cur[1]}</strong>
            <span className="ml-auto text-[12.5px] text-muted whitespace-nowrap max-[640px]:hidden">{me.name} · {ROLE_LABEL[me.role]}</span>
            <button onClick={() => start(() => staffSignOut())} className="min-[900px]:hidden ml-auto text-muted cursor-pointer flex items-center gap-1.5 text-[13px]"><LogOut size={16} />Sign out</button>
          </header>
          <nav className="min-[900px]:hidden flex gap-1 overflow-x-auto bg-[#0E1A1F] px-2 py-1.5 flex-none">
            {nav.map(([v, label]) => (
              <Link key={v} href={`/staff/${v}`} className={`whitespace-nowrap text-[13px] px-3 py-1.5 rounded-md ${cur[0] === v ? "bg-[rgba(95,211,188,.18)] text-white font-semibold" : "text-[#B8C7CC]"}`}>{label}{badges[v] ? ` · ${badges[v]}` : ""}</Link>
            ))}
          </nav>
          <main className="flex-1 overflow-auto p-5 grid auto-rows-max content-start gap-4 min-h-0 max-[640px]:p-3">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
