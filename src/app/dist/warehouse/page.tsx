import Link from "next/link";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { pickQueue } from "@/domain/distribution/orders";
import { dateIN, PageHead, Pill } from "../_ui/ui";

export const metadata = { title: "Pick & pack" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "warehouse");
  const q = await pickQueue(ctx);
  const open = q.filter((p) => p.status === "open"), packed = q.filter((p) => p.status === "packed");
  return (
    <div className="max-w-[720px]">
      <PageHead title="Pick & pack" sub={`${ctx.branchName} · oldest first. Tap a pick list to start.`} />
      <ul className="list-none p-0 m-0 flex flex-col gap-2.5">
        {open.map((p) => (
          <li key={p.id}>
            <Link href={`/dist/warehouse/${p.id}`} className="block bg-white border border-line rounded-xl p-4 hover:border-teal text-inherit">
              <div className="flex items-center gap-2"><span className="text-[16px] font-semibold flex-1">{p.customer}</span><Pill tone={p.picked ? "blue" : "amber"}>{p.picked ? `${p.picked}/${p.lines.length} picked` : "To pick"}</Pill></div>
              <div className="text-[13px] text-muted mt-1">{p.no} · {p.orderNo} · {p.lines.length} batch lines · {dateIN(p.createdAt)}</div>
            </Link>
          </li>
        ))}
        {!open.length ? <li className="bg-white border border-line rounded-xl p-8 text-center text-muted">Nothing to pick. Approved orders appear here.</li> : null}
      </ul>
      {packed.length ? (
        <>
          <h2 className="text-[13px] uppercase tracking-[0.06em] text-muted mt-6 mb-2">Packed, waiting for invoice</h2>
          <ul className="list-none p-0 m-0 flex flex-col gap-2">{packed.map((p) => <li key={p.id} className="bg-white border border-line rounded-xl px-4 py-3 text-[14px] flex justify-between"><span>{p.customer} · {p.orderNo}</span><span className="text-muted">{p.boxes} box(es)</span></li>)}</ul>
        </>
      ) : null}
    </div>
  );
}
