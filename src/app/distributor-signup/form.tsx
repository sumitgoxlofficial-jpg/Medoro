"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n-client";
import { createDistributorAction } from "./actions";

const keyGen = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function DistributorSignup() {
  const t = useT();
  const [key, setKey] = useState("");
  const [p, start] = useTransition();
  const [m, setM] = useState<{ ok: boolean; text: string; code?: string } | null>(null);
  useEffect(() => setKey(keyGen()), []);
  const f = (label: string, name: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-1 text-[12.5px] font-medium text-[#4A5A73]">{t(label)}<input name={name} {...extra} className="h-10 rounded-lg border border-[#C9D2DE] px-3 text-[14px]" /></label>
  );
  if (m?.ok) return <div className="bg-white border border-[#E3E7ED] rounded-xl p-6 text-[14px]"><p className="m-0 text-[#1E7F4F] font-semibold">{m.text}</p><p>{t("Business code")}: <strong>{m.code}</strong></p><Link href="/signin" className="font-semibold">{t("Sign in")} →</Link></div>;
  return (
    <form className="bg-white border border-[#E3E7ED] rounded-xl p-6 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); start(async () => { const r = await createDistributorAction(fd); setM(r.ok ? { ok: true, text: t(r.message ?? ""), code: r.data.code } : { ok: false, text: t(r.error) }); }); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {f("Business name", "name", { required: true })}
        {f("Business code (e.g. SHAH-PUNE)", "code", { required: true, pattern: "[A-Za-z0-9]{3,8}(-[A-Za-z0-9]{2,8})?" })}
        {f("GSTIN", "gstin", { required: true })}
        {f("Wholesale drug licence (20B/21B)", "dl", { required: true })}
        {f("Address", "address", { required: true })}
        {f("Godowns (comma separated)", "godowns", { placeholder: "Main godown, Bhiwandi" })}
        {f("Owner name", "ownerName", { required: true })}
        {f("Owner email", "email", { type: "email", required: true })}
        {f("Owner mobile", "phone", { required: true, inputMode: "tel" })}
        {f("Password (10+ characters)", "password", { type: "password", required: true, minLength: 10, autoComplete: "new-password" })}
      </div>
      <div className="rounded-lg bg-[#FDF2E1] text-[#94570A] p-3 text-[13px]">
        <div className="font-semibold">{t("Backup recovery key — store it offline")}</div>
        <code className="block break-all text-[12px] my-1 text-[#0B2545]">{key}</code>
        <input type="hidden" name="backupKey" value={key} />
        <label className="flex gap-2 items-start"><input type="checkbox" name="kitAck" required className="mt-0.5" />{t("I have copied this key somewhere safe. Encrypted backups can’t be restored without it.")}</label>
      </div>
      <button disabled={p || !key} className="h-11 rounded-lg bg-[#0B2545] text-white font-semibold disabled:opacity-50">{p ? t("Working…") : t("Create distributor account")}</button>
      {m && !m.ok ? <div role="alert" className="text-[13px] text-[#B3261E]">{m.text}</div> : null}
    </form>
  );
}
