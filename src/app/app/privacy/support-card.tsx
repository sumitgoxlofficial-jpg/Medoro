"use client";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Headset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { decideRemoteAction, grantSupportAction, revokeSupportAction } from "./actions";
import { useLang, useT } from "@/lib/i18n-client";
import { localeOf, type Lang } from "@/lib/tr";

type Grant = { id: string; reason: string; minutes: number; createdBy: string; createdAt: string; expiresAt: string; usedAt: string | null; usedIp: string | null; revokedAt: string | null; revokedBy: string | null; active: boolean };
type Ask = { id: string; by: string; ticket: string | null; requestedAt: string };
const at = (iso: string, lang: Lang = "en") => new Date(iso).toLocaleString(localeOf(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Lets the owner give Medoro support a single-use, read-only, time-limited login. */
export function SupportCard({ grants, requests = [] }: { grants: Grant[]; requests?: Ask[] }) {
  const toast = useToast();
  const t = useT(), lang = useLang();
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
  const decide = (id: string, approve: boolean) => start(async () => {
    const r = await decideRemoteAction(id, approve, hours * 60);
    if (!r.ok) return toast(r.error, "red");
    toast(r.message ?? "Done.", "green");
    if (r.data) setLink({ url: r.data.link, until: r.data.expiresAt });
    router.refresh();
  });

  return (
    <section className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3 max-w-[1300px]">
      <div className="flex items-center gap-2 font-semibold text-[15px]"><Headset size={18} className="text-teal" />{t("Medoro support access")}</div>
      <p className="m-0 text-[13.5px] text-ink-2">{t("Medoro staff can’t see your data. If support needs to look at something, give them a link here. It signs them in as {who}, can only look (no changes, no downloads), works once, and ends when the time is up or you revoke it. Everything they open is in your audit trail.").split(/\{who\}/).map((x, i) => i ? <Fragment key={i}><strong>{t("Medoro support")}</strong>{x}</Fragment> : x)}</p>

      {requests.map((q) => (
        <div key={q.id} role="alert" className="flex gap-3 items-center flex-wrap bg-[#EAF0FC] rounded-lg px-3 py-2.5 text-[13.5px] text-[#1C3F8F]">
          <Badge tone="blue">Medoro support requested access</Badge>
          <span className="flex-1 min-w-[200px]">{q.by}{q.ticket ? ` · ${t("ticket {code}", { code: q.ticket })}` : ""} · {at(q.requestedAt, lang)}. {t(hours === 1 ? "Approving creates a read-only link for {n} hour (change it below) and sends it to them." : "Approving creates a read-only link for {n} hours (change it below) and sends it to them.", { n: hours })}</span>
          <Button variant="primary" disabled={busy} onClick={() => decide(q.id, true)}>Approve</Button>
          <Button disabled={busy} onClick={() => decide(q.id, false)}>Decline</Button>
        </div>
      ))}

      {active ? (
        <div className="flex gap-3 items-center flex-wrap bg-[#FDF2E1] rounded-lg px-3 py-2.5 text-[13.5px] text-[#6B4A0E]">
          <Badge tone="amber">{active.usedAt ? t("Support signed in") : t("Link not used yet")}</Badge>
          <span className="flex-1 min-w-[200px]">{t("Read-only until {when}", { when: at(active.expiresAt, lang) })} · {active.reason}{active.usedAt ? ` · ${active.usedIp ? t("opened {when} from {ip}", { when: at(active.usedAt, lang), ip: active.usedIp }) : t("opened {when}", { when: at(active.usedAt, lang) })}` : ""}</span>
          <Button variant="danger-outline" disabled={busy} onClick={revoke}>End access now</Button>
        </div>
      ) : null}

      {link ? (
        <div className="flex flex-col gap-2 bg-teal-soft border border-teal-line rounded-lg p-3">
          <strong className="text-[13.5px]">{t("Send this link to Medoro support (it’s shown only once)")}</strong>
          <div className="flex gap-2 items-center"><code className="flex-1 min-w-0 truncate bg-white border border-line rounded-md px-2.5 py-1.5 text-[12.5px]">{link.url}</code>
            <Button onClick={() => { navigator.clipboard?.writeText(link.url); toast("Link copied.", "green"); }}><Copy size={14} />{t("Copy")}</Button></div>
          <span className="text-[12.5px] text-muted">{t("Works once, until {when}. Support opens it in a browser that can reach this server. On a shop-only network they can’t reach it; share your screen instead.", { when: at(link.until, lang) })}</span>
        </div>
      ) : null}

      <form onSubmit={(e) => { e.preventDefault(); grant(); }} className="flex gap-2 flex-wrap items-end">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted flex-1 min-w-[220px]">{t("Reason or ticket number")}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("TK-1182 · printer cuts receipts")} className="border border-input rounded-lg px-3 py-2 text-[14px] outline-none focus:border-teal bg-white" />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">{t("For")}
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="border border-input rounded-lg px-3 py-2 text-[14px] bg-white">
            <option value={1}>{t("{n} hour", { n: 1 })}</option><option value={2}>{t("{n} hours", { n: 2 })}</option><option value={4}>{t("{n} hours", { n: 4 })}</option>
          </select>
        </label>
        <Button variant="primary" type="submit" disabled={busy}>{active ? t("Replace with a new link") : t("Give support access")}</Button>
      </form>

      {grants.length ? (
        <div className="flex flex-col text-[12.5px]">
          <span className="text-muted font-medium mb-1">{t("Recent")}</span>
          {grants.map((g) => (
            <div key={g.id} className="flex gap-2 flex-wrap py-1.5 border-t border-row">
              <span className="min-w-[110px]">{at(g.createdAt, lang)}</span>
              <span className="flex-1 min-w-[160px] text-ink-2">{g.reason} · {g.minutes / 60} h · {t("by {name}", { name: g.createdBy })}</span>
              <span className="text-muted">{g.active ? (g.usedAt ? t("in use") : t("waiting")) : g.revokedAt ? t("ended by {name}", { name: g.revokedBy }) : g.usedAt ? t("used, expired") : t("expired unused")}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
