"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { dayMonth } from "@/lib/dates";
import { card, input, label, errText, type Who } from "./ui";

type Camp = { id: string; name: string; message: string; audience: number; at: string; delivered: number; read: number; sent: number; failed: number; optedOut: number; notOnWhatsApp: number; pending: number };
const BATCH = 25;

/**
 * Store updates on WhatsApp from a Drive counter (owner). The counter keeps the campaign and who agreed to offers;
 * each batch goes through Medoro, which checks STOP replies, sends and keeps nothing. A stopped send resumes with the
 * people not yet reached.
 */
export function StoreUpdates({ who, refresh }: { who: Who; refresh: number }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [list, setList] = useState<Camp[]>([]);
  const [audience, setAudience] = useState(0);
  const [f, setF] = useState({ name: "", message: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const load = useCallback(async () => {
    setList(await dev.call("listCampaigns"));
    setAudience(await dev.call("campaignAudienceCount"));
  }, [dev]);
  useEffect(() => { void load().catch(() => undefined); }, [load, refresh]);

  /** Sends to everyone not yet reached, in batches of 25, recording each result on this counter as it goes. */
  const run = async (id: string, message: string, first: boolean) => {
    if (!who.whatsapp) return;
    setBusy(id);
    let sent = 0, failed = 0, isFirst = first;
    const tried: string[] = [];
    try {
      for (;;) {
        const next = await dev.call("campaignPending", id, BATCH, tried);
        if (!next.length) break;
        tried.push(...next.map((p) => p.id));
        const r = await who.whatsapp.campaign({ campaignId: id, first: isFirst, message, recipients: next });
        if (!r.ok) throw new Error(r.error);
        isFirst = false;
        await dev.call("recordCampaignResults", id, r.data.results, who.userId);
        sent += r.data.results.filter((x) => x.status === "sent").length;
        failed += r.data.results.filter((x) => x.status === "failed").length;
        setProgress(`${sent} sent${failed ? ` · ${failed} failed` : ""}…`);
        // Every one failed (e.g. the phone link dropped): stop rather than run through the whole list.
        if (r.data.results.length && r.data.results.every((x) => x.status === "failed")) throw new Error(r.data.results[0].error || "WhatsApp couldn’t send this batch.");
      }
      toast(`Store update sent to ${sent} ${sent === 1 ? "customer" : "customers"}${failed ? `; ${failed} failed (Resume to try them again)` : ""}.`, failed ? "red" : "green");
    } catch (e) {
      toast(`${errText(e)} ${sent ? `${sent} were sent; ` : ""}Resume to continue.`, "red");
    } finally { setBusy(null); setProgress(""); void load(); }
  };

  const start = async () => {
    try {
      const id = await dev.call("createCampaign", { name: f.name, message: f.message, userId: who.userId });
      setF({ name: "", message: "" });
      await run(id, f.message.replace(/\s+/g, " ").trim(), true);
    } catch (e) { toast(errText(e), "red"); }
  };

  return (
    <div className={card}>
      <div className="font-semibold flex items-center gap-2"><Megaphone size={16} className="text-teal" />Store updates on WhatsApp</div>
      <div className="text-sm text-muted">
        Goes to the {audience} {audience === 1 ? "customer" : "customers"} who agreed to offers on WhatsApp (tick it on each customer below, after asking them).
        {who.whatsapp?.via === "phone" ? " Sent from your linked phone, a little at a time so WhatsApp doesn’t block it." : " Uses your approved “store_update” template: Hi {name}, {your text}."}
        {" "}Anyone who replies STOP isn’t messaged again.
      </div>
      <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto] items-end">
        <label className={label}>Name (for you)<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali timings" className={input} aria-label="Update name" /></label>
        <label className={label}>Update text ({f.message.length}/300)<input value={f.message} maxLength={300} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="We are open till 11 pm all this week." className={input} aria-label="Update text" /></label>
        <Button variant="primary" onClick={start} disabled={!!busy || !audience || f.name.trim().length < 3 || f.message.trim().length < 3}><Send size={16} /> {busy && !list.some((c) => c.id === busy) ? progress || "Sending…" : `Send to ${audience}`}</Button>
      </div>
      {list.length > 0 && (
        <table className="text-[13px] w-full">
          <thead><tr className="text-left text-muted"><th className="font-medium py-1">Update</th><th className="font-medium">Date</th><th className="font-medium text-right">Sent</th><th className="font-medium text-right">Delivered · read</th><th className="font-medium text-right">Not sent</th><th /></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="py-1.5">{c.name}<div className="text-xs text-muted truncate max-w-[340px]">{c.message}</div></td>
                <td>{dayMonth(new Date(c.at), true)}</td>
                <td className="text-right tabular-nums">{c.sent}</td>
                <td className="text-right tabular-nums">{c.delivered} · {c.read}</td>
                <td className="text-right tabular-nums text-muted" title="Failed · replied STOP · not on WhatsApp">{c.failed} · {c.optedOut} · {c.notOnWhatsApp}</td>
                <td className="text-right">{c.pending > 0 && <Button size="sm" onClick={() => run(c.id, c.message, false)} disabled={!!busy}>{busy === c.id ? progress || "Sending…" : `Resume (${c.pending})`}</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
