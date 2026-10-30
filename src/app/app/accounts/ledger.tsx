import Link from "next/link";
import { inr } from "@/lib/money";
import { dayMonth } from "@/lib/dates";
import type { accountLedger, trialBalance } from "@/domain/accounting/service";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2 border-b border-row align-top";
const inp = "border border-input rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink bg-white";
const drcr = (n: number) => `${inr(Math.abs(n))} ${n < 0 ? "Cr" : n > 0 ? "Dr" : ""}`.trim();

export function AccountsTabs({ view }: { view: "overview" | "tb" | "ledger" | "h1" }) {
  const tab = (v: string, label: string, href: string) => (
    <Link key={v} href={href} className={"rounded-full px-3 py-1.5 text-[13px] font-medium border no-underline " + (view === v ? "bg-teal text-white border-teal" : "bg-white text-ink-2 border-input")}>{label}</Link>
  );
  return <div className="flex gap-1.5 mb-3.5">{tab("overview", "Overview", "/app/accounts")}{tab("tb", "Trial balance", "/app/accounts?view=tb")}{tab("ledger", "Account ledger", "/app/accounts?view=ledger")}{tab("h1", "H1 register", "/app/accounts?view=h1")}</div>;
}

export function TrialBalanceView({ tb }: { tb: Awaited<ReturnType<typeof trialBalance>> }) {
  return (
    <div className="flex flex-col gap-3.5 max-w-[900px]">
      <form className={card + " flex gap-2.5 items-end px-4 py-3"}>
        <input type="hidden" name="view" value="tb" />
        <label className="flex flex-col gap-1 text-[12px] text-muted">As on<input type="date" name="asof" defaultValue={tb.asOf} className={inp} /></label>
        <button type="submit" className="bg-teal text-white rounded-lg px-3.5 py-[7px] text-[13.5px] font-semibold cursor-pointer">Show</button>
        <span className={"ml-auto text-[13px] " + (tb.dr === tb.cr ? "text-ok" : "text-bad")}>{tb.dr === tb.cr ? "Debits equal credits" : `Out of balance by ${inr(Math.abs(tb.dr - tb.cr))}`}</span>
      </form>
      <div className={card + " overflow-auto"}>
        <table className="w-full border-collapse text-[13.5px]">
          <thead><tr className="bg-subtle"><th className={th}>Account</th><th className={th + " text-right"}>Debit</th><th className={th + " text-right"}>Credit</th><th className={th} /></tr></thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.account}>
                <td className={td}>{r.account}</td><td className={td + " text-right tnum"}>{r.dr ? inr(r.dr) : ""}</td><td className={td + " text-right tnum"}>{r.cr ? inr(r.cr) : ""}</td>
                <td className={td + " text-right"}><Link href={`/app/accounts?view=ledger&account=${encodeURIComponent(r.account)}&to=${tb.asOf}`} className="text-[12.5px] text-teal">Ledger</Link></td>
              </tr>
            ))}
            {!tb.rows.length ? <tr><td className={td + " text-fainter"} colSpan={4}>Nothing posted yet.</td></tr> : null}
            <tr className="bg-subtle font-semibold"><td className={td}>Total</td><td className={td + " text-right tnum"}>{inr(tb.dr)}</td><td className={td + " text-right tnum"}>{inr(tb.cr)}</td><td className={td} /></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LedgerView({ led, accounts }: { led: Awaited<ReturnType<typeof accountLedger>>; accounts: string[] }) {
  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <form className={card + " flex gap-2.5 items-end flex-wrap px-4 py-3"}>
        <input type="hidden" name="view" value="ledger" />
        <label className="flex flex-col gap-1 text-[12px] text-muted">Account<select name="account" defaultValue={led.account} className={inp}>{accounts.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">From<input type="date" name="from" defaultValue={led.fromDay} className={inp} /></label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">To<input type="date" name="to" defaultValue={led.toDay} className={inp} /></label>
        <button type="submit" className="bg-teal text-white rounded-lg px-3.5 py-[7px] text-[13.5px] font-semibold cursor-pointer">Show</button>
        <div className="ml-auto flex gap-5 text-[13.5px]"><span>Opening <strong className="tnum">{drcr(led.opening)}</strong></span><span>Closing <strong className="tnum">{drcr(led.closing)}</strong></span></div>
      </form>
      <div className={card + " overflow-auto"}>
        <table className="w-full border-collapse min-w-[900px] text-[13.5px]">
          <thead><tr className="bg-subtle"><th className={th}>Date</th><th className={th}>Voucher</th><th className={th}>Narration</th><th className={th}>Party</th><th className={th + " text-right"}>Debit</th><th className={th + " text-right"}>Credit</th><th className={th + " text-right"}>Balance</th></tr></thead>
          <tbody>
            <tr><td className={td} colSpan={6}><strong>Opening balance</strong> <span className="text-faint">as on {led.fromDay}</span></td><td className={td + " text-right tnum font-semibold"}>{drcr(led.opening)}</td></tr>
            {led.rows.map((r) => (
              <tr key={r.id}>
                <td className={td + " whitespace-nowrap"}>{dayMonth(new Date(r.date), true)}</td>
                <td className={td + " whitespace-nowrap"}><div className="font-mono text-[12.5px]">{r.no}</div><div className="text-[12px] text-faint">{r.type.replace("_", " ")}</div></td>
                <td className={td + " text-ink-2"}>{r.narration}</td><td className={td}>{r.party}</td>
                <td className={td + " text-right tnum"}>{r.dr ? inr(r.dr) : ""}</td><td className={td + " text-right tnum"}>{r.cr ? inr(r.cr) : ""}</td><td className={td + " text-right tnum"}>{drcr(r.balance)}</td>
              </tr>
            ))}
            {!led.rows.length ? <tr><td className={td + " text-fainter"} colSpan={7}>No postings in this range.</td></tr> : null}
            <tr className="bg-subtle font-semibold"><td className={td} colSpan={4}>Closing balance <span className="text-faint font-normal">as on {led.toDay}</span></td><td className={td + " text-right tnum"}>{inr(led.totalDr)}</td><td className={td + " text-right tnum"}>{inr(led.totalCr)}</td><td className={td + " text-right tnum"}>{drcr(led.closing)}</td></tr>
          </tbody>
        </table>
        {led.truncated ? <div className="px-4 py-2 text-[12.5px] text-warn">Showing the first 5,000 postings. Narrow the dates to see the rest.</div> : null}
      </div>
    </div>
  );
}
