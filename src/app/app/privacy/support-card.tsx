"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Headset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { grantSupportAction, revokeSupportAction } from "./actions";

type Grant = { id: string; reason: string; minutes: number; createdBy: string; createdAt: string; expiresAt: string; usedAt: string | null; usedIp: string | null; revokedAt: string | null; revokedBy: string | null; active: boolean };
const t = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Lets the owner give Medoro support a single-use, read-only, time-limited login. */
export function SupportCard({ grants }: { grants: Grant[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [hours, setHours] = useState(2);
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<{ url: string; until: string } | null>(null);
  const active = grants.find((g) => g.active);

  const grant = () => start(async () => {
    const r = await grantSupportAction(hours * 60, reason);
    if (!r.ok) return toast(r.error, "red");
    setLink({ url: r.data.link, until: r.data.expiresAt }); setReason(""); router.refresh();
  });
  const revoke = () => start(async () => { const r = await revokeSupportAction(); toast(r.ok ? r.message ?? "Ended." : r.error, r.ok ? "green" : "red"); setLink(null); router.refresh(); });

  return (
    <section className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3 max-w-[1300px]">
      <div className="flex items-center gap-2 font-semibold text-[15px]"><Headset size={18} className="text-teal" />Medoro support access</div>
      <p className="m-0 text-[13.5px] text-ink-2">Medoro staff can’t see your data. If support needs to look at something, give them a link here. It signs them in as <strong>Medoro support</strong>, can only look (no changes, no downloads), works once, and ends when the time is up or you revoke it. Everything they open is in your audit trail.</p>

      {active ? (
        <div className="flex gap-3 items-center flex-wrap bg-[#FDF2E1] rounded-lg px-3 py-2.5 text-[13.5px] text-[#6B4A0E]">
          <Badge tone="amber">{active.usedAt ? "Support signed in" : "Link not used yet"}</Badge>
          <span className="flex-1 min-w-[200px]">Read-only until {t(active.expiresAt)} · {active.reason}{active.usedAt ? ` · opened ${t(active.usedAt)}${active.usedIp ? ` from ${active.usedIp}` : ""}` : ""}</span>
          <Button variant="danger-outline" disabled={busy} onClick={revoke}>End access now</Button>
        </div>
      ) : null}

      {link ? (
        <div className="flex flex-col gap-2 bg-teal-soft border border-teal-line rounded-lg p-3">
          <strong className="text-[13.5px]">Send this link to Medoro support (it’s shown only once)</strong>
          <div className="flex gap-2 items-center"><code className="flex-1 min-w-0 truncate bg-white border border-line rounded-md px-2.5 py-1.5 text-[12.5px]">{link.url}</code>
            <Button onClick={() => { navigator.clipboard?.writeText(link.url); toast("Link copied.", "green"); }}><Copy size={14} />Copy</Button></div>
          <span className="text-[12.5px] text-muted">Works once, until {t(link.until)}. Support opens it in a browser that can reach this server. On a shop-only network they can’t reach it; share your screen instead.</span>
        </div>
      ) : null}

      <form onSubmit={(e) => { e.preventDefault(); grant(); }} className="flex gap-2 flex-wrap items-end">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted flex-1 min-w-[220px]">Reason or ticket number
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="TK-1182 · printer cuts receipts" className="border border-input rounded-lg px-3 py-2 text-[14px] outline-none focus:border-teal bg-white" />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">For
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="border border-input rounded-lg px-3 py-2 text-[14px] bg-white">
            <option value={1}>1 hour</option><option value={2}>2 hours</option><option value={4}>4 hours</option>
          </select>
        </label>
        <Button variant="primary" type="submit" disabled={busy}>{active ? "Replace with a new link" : "Give support access"}</Button>
      </form>

      {grants.length ? (
        <div className="flex flex-col text-[12.5px]">
          <span className="text-muted font-medium mb-1">Recent</span>
          {grants.map((g) => (
            <div key={g.id} className="flex gap-2 flex-wrap py-1.5 border-t border-row">
              <span className="min-w-[110px]">{t(g.createdAt)}</span>
              <span className="flex-1 min-w-[160px] text-ink-2">{g.reason} · {g.minutes / 60} h · by {g.createdBy}</span>
              <span className="text-muted">{g.active ? (g.usedAt ? "in use" : "waiting") : g.revokedAt ? `ended by ${g.revokedBy}` : g.usedAt ? "used, expired" : "expired unused"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
