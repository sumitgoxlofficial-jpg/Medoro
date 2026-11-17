import Link from "next/link";
import { redirect } from "next/navigation";
import { BookMarked } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { catalogueDiff, linkSuggestions, myCorrections, searchCentral, syncStatus } from "@/domain/inventory/catalogue-sync";
import { PageHead } from "@/components/page-head";
import { AddFromCatalogue, ApplyForm, CorrectionForm, LinkButton, ReviewedButton } from "./forms";

export const metadata = { title: "Medicine catalogue" };
const card = "bg-white border border-line rounded-xl p-4";
const KIND: Record<string, string> = { barcode: "same verified barcode", exact: "identical brand, salt, strength, form, maker and pack", similar: "similar: please check" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx();
  if (!(can(ctx, "adjust") || can(ctx, "purchase") || can(ctx, "reports"))) redirect("/app");
  const q = (await searchParams).q ?? "";
  const [st, sug, diffs, results, mine] = await Promise.all([syncStatus(ctx), linkSuggestions(ctx), catalogueDiff(ctx), searchCentral(ctx, q), myCorrections(ctx)]);
  const manage = (can(ctx, "adjust") || can(ctx, "purchase")) && !ctx.readOnly && !ctx.moved;
  return (
    <>
      <PageHead icon={BookMarked} title="Medicine catalogue" sub="Medoro’s shared, verified list of medicines. It never changes your prices, MRP, racks or your own medicines." right={<Link href="/app/inventory" className="text-[13px] underline">Back to inventory</Link>} />
      <div className="max-w-[1400px] flex flex-col gap-4">
        <p className="m-0 text-[12.5px] text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="catalogue-note">
          Only entries Medoro staff have checked against a named source are shown. The catalogue is maintained by Medoro, may be incomplete, and is not connected to any government or manufacturer database. Check a pack before you rely on a tax rate or schedule from here. Nothing changes on your side unless you choose it.
        </p>

        <section className={card} data-testid="catalogue-status">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Your sync status</h2>
          <p className="m-0 text-[13px]">Catalogue version {st.catalogueVersion} · you last reviewed {st.reviewedVersion ? `version ${st.reviewedVersion}` : "none yet"} · {st.linked} linked medicine(s), {st.unlinked} not linked (your own records stay as they are) · {st.changedEntries} of your linked entries changed since you last reviewed.</p>
          {st.changes.length ? <ul className="m-0 mt-1 pl-5 text-[12.5px] text-slate-700">{[...new Map(st.changes.map((c) => [c.gid, c])).values()].slice(0, 10).map((c) => <li key={c.gid}>{c.gid}: {c.action.replace("_", " ")} on {c.at.slice(0, 10)}</li>)}</ul> : null}
          {manage ? <div className="mt-2"><ReviewedButton /></div> : null}
        </section>

        <section className={card} data-testid="catalogue-diffs">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Differences from the catalogue ({diffs.length})</h2>
          {diffs.length ? <div className="grid gap-3">{diffs.map((d) => (
            <article key={d.medicineId} className="border-t border-line pt-2">
              <div className="text-[14px] font-medium">{d.name} {d.strength} <span className="text-[12px] text-slate-500 font-normal">· {d.gid} v{d.centralVersion}</span></div>
              {d.withdrawn ? <p className="m-0 text-[13px] text-red-700">Medoro has withdrawn this entry{d.withdrawn.replacedBy ? `; it was replaced by ${d.withdrawn.replacedBy}` : ""}. Your medicine is unchanged.</p> : manage ? <ApplyForm medicineId={d.medicineId} diffs={d.diffs} /> : <ul className="m-0 pl-5 text-[13px]">{d.diffs.map((x) => <li key={x.field}>{x.field}: “{x.local}” vs “{x.central}”</li>)}</ul>}
            </article>))}</div> : <p className="m-0 text-[13px] text-slate-500">Your linked medicines match the catalogue.</p>}
        </section>

        <section className={card} data-testid="catalogue-links">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Link your medicines ({sug.length})</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">Linking only records which catalogue entry a medicine is. Nothing is linked automatically, and medicines with no match stay your own custom records.</p>
          {sug.length ? <ul className="m-0 p-0 list-none grid gap-2">{sug.map((s) => (
            <li key={s.medicineId} className="text-[13px]"><strong>{s.name} {s.strength}</strong>
              {s.matches.map((m) => <div key={m.entry.gid} className="ml-3 flex items-center gap-2 flex-wrap"><span className="font-mono text-[12px]">{m.entry.gid}</span> {m.entry.brand} {m.entry.strength}, {m.entry.manufacturer} <span className="text-slate-500 text-[12px]">({KIND[m.kind]})</span>{manage ? <LinkButton medicineId={s.medicineId} gid={m.entry.gid} /> : null}</div>)}</li>))}</ul> : <p className="m-0 text-[13px] text-slate-500">No suggested matches.</p>}
        </section>

        <section className={card} data-testid="catalogue-search">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Search the catalogue</h2>
          <form method="get" className="flex gap-2 mb-2"><input name="q" defaultValue={q} placeholder="Brand, generic, manufacturer or CM-…" aria-label="Search" className="border border-line rounded-lg px-2 py-1.5 text-[13px] bg-white w-72" /><button className="rounded-lg border border-line px-3 py-1.5 text-[13px]">Search</button></form>
          {q.trim().length >= 2 ? (results.length ? <ul className="m-0 p-0 list-none grid gap-3">{results.map((e) => (
            <li key={e.gid} className="text-[13px]"><span className="font-mono text-[12px]">{e.gid}</span> <strong>{e.brand} {e.strength}</strong> · {e.form} · {e.manufacturer} · pack {e.packSize}{e.packLabel ? ` (${e.packLabel})` : ""} · HSN {e.hsn} · GST {e.gstRate}%{e.schedule ? ` · Schedule ${e.schedule}` : ""}
              <div className="text-[12px] text-slate-500">{e.generic}{e.composition ? ` · ${e.composition}` : ""} · verified {e.verifiedOn}{e.barcodes.length ? ` · barcode ${e.barcodes.join(", ")}` : ""}</div>
              {manage ? <div className="mt-1 grid gap-1"><AddFromCatalogue gid={e.gid} /><CorrectionForm gid={e.gid} /></div> : null}</li>))}</ul> : <p className="m-0 text-[13px] text-slate-500">Nothing found. The catalogue is still growing.</p>) : <p className="m-0 text-[13px] text-slate-500">Type at least two letters.</p>}
        </section>

        <section className={card} data-testid="catalogue-corrections">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Your correction requests</h2>
          {mine.length ? <ul className="m-0 pl-5 text-[13px]">{mine.map((c) => <li key={c.id}>{c.gid} · {c.field} → {c.proposed} · <strong>{c.status}</strong>{c.note ? ` (${c.note})` : ""} · {c.at.slice(0, 10)}</li>)}</ul> : <p className="m-0 text-[13px] text-slate-500">You haven’t reported any mistakes.</p>}
        </section>
      </div>
    </>
  );
}
