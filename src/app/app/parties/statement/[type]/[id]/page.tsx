import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { UserError } from "@/server/action";
import { partyStatement, type PartyType } from "@/domain/parties/statement";
import { PageHead } from "@/components/page-head";
import { inr } from "@/lib/money";
import { dayMonth } from "@/lib/dates";
import { tFor } from "@/lib/tr";

export const metadata = { title: "Party statement" };

const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2 border-b border-row align-top";
const btn = "flex items-center gap-1.5 border border-input rounded-lg px-3 py-[7px] text-[13px] text-ink bg-white hover:border-teal no-underline";

export default async function Page({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireCtx();
  const { type, id } = await params;
  if (type !== "supplier" && type !== "customer") notFound();
  if (!can(ctx, "payments") && !can(ctx, "reports") && !(type === "supplier" && can(ctx, "purchase"))) redirect("/app");
  const sp = await searchParams;
  let s;
  try { s = await partyStatement(ctx, type as PartyType, id, sp.from, sp.to); } catch (e) { if (e instanceof UserError) notFound(); throw e; }
  const t = tFor(ctx.lang);
  const q = `from=${s.fromDay}&to=${s.toDay}`;
  const owes = t(type === "supplier" ? "you owe" : "they owe");
  return (
    <>
      <PageHead title={t("Statement · {name}", { name: s.party.name })} sub={`${t(type === "supplier" ? "Supplier ledger" : "Customer ledger")}${s.party.gstin ? ` · GSTIN ${s.party.gstin}` : ""}${s.party.phone ? ` · ${s.party.phone}` : ""}`}
        right={<div className="flex gap-2"><Link href={`/app/parties${type === "customer" ? "?tab=cus" : ""}`} className={btn}><ArrowLeft size={14} />{t("Parties")}</Link><a href={`/print/statement/${type}/${id}?${q}`} target="_blank" rel="noopener" className={btn}><Printer size={14} />{t("Print")}</a><a href={`/api/statements/${type}/${id}?${q}`} className={btn}><Download size={14} />CSV</a></div>} />
      <div className="flex flex-col gap-3.5 max-w-[1400px]">
        <form className="flex gap-2.5 items-end flex-wrap bg-white border border-line rounded-xl px-4 py-3">
          <label className="flex flex-col gap-1 text-[12px] text-muted">{t("From")}<input type="date" name="from" defaultValue={s.fromDay} className="border border-input rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink" /></label>
          <label className="flex flex-col gap-1 text-[12px] text-muted">{t("To")}<input type="date" name="to" defaultValue={s.toDay} className="border border-input rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink" /></label>
          <button type="submit" className="bg-teal text-white rounded-lg px-3.5 py-[7px] text-[13.5px] font-semibold cursor-pointer">{t("Show")}</button>
          <div className="ml-auto flex gap-5 text-[13.5px]">
            <span>{t("Opening")} <strong className="tnum">{inr(s.opening)}</strong></span>
            <span>{t("Closing ({owes})", { owes })} <strong className="tnum">{inr(s.closing)}</strong></span>
          </div>
        </form>
        <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto">
          <table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-subtle"><th className={th}>{t("Date")}</th><th className={th}>{t("Voucher")}</th><th className={th}>{t("Type")}</th><th className={th}>{t("Particulars")}</th><th className={th + " text-right"}>{t("Debit", { ctx: "ledger" })}</th><th className={th + " text-right"}>{t("Credit", { ctx: "ledger" })}</th><th className={th + " text-right"}>{t("Balance")}</th></tr></thead>
            <tbody>
              <tr><td className={td} colSpan={6}><strong>{t("Opening balance")}</strong> <span className="text-faint">{t("as on {date}", { date: s.fromDay })}</span></td><td className={td + " text-right tnum font-semibold"}>{inr(s.opening)}</td></tr>
              {s.rows.map((r) => (
                <tr key={r.id}>
                  <td className={td + " whitespace-nowrap"}>{dayMonth(new Date(r.date), true)}</td><td className={td + " font-mono text-[12.5px]"}>{r.no}</td><td className={td}>{t(r.kind)}</td>
                  <td className={td + " text-ink-2"}>{r.narration}</td>
                  <td className={td + " text-right tnum"}>{r.debit ? inr(r.debit) : ""}</td><td className={td + " text-right tnum"}>{r.credit ? inr(r.credit) : ""}</td>
                  <td className={td + " text-right tnum"}>{inr(r.balance)}</td>
                </tr>
              ))}
              {!s.rows.length ? <tr><td className={td + " text-fainter"} colSpan={7}>{t("No entries in this period.")}</td></tr> : null}
              <tr className="bg-subtle"><td className={td} colSpan={4}><strong>{t("Closing balance")}</strong> <span className="text-faint">{t("as on {date}", { date: s.toDay })} · {owes}</span></td><td className={td + " text-right tnum"}>{inr(s.debit)}</td><td className={td + " text-right tnum"}>{inr(s.credit)}</td><td className={td + " text-right tnum font-semibold"}>{inr(s.closing)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="text-[12px] text-faint">{t(type === "supplier" ? "Built from posted vouchers on the Sundry creditors ledger. Balance is what you owe the supplier; a negative balance is an advance." : "Built from posted vouchers on the Sundry debtors ledger. Balance is what the customer owes you; a negative balance is an advance.")}</div>
      </div>
    </>
  );
}
