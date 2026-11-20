"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, KeyRound, Trash2, Warehouse } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { GSTIN_RE, MOBILE_RE, normPhone } from "@/domain/identity/contracts";
import { downloadRecoveryKit } from "@/components/recovery-kit";
import { useT } from "@/lib/i18n-client";
import { createDistributorAction } from "./actions";

// The same steps, card and inputs as pharmacy sign-up (setup/wizard.tsx), with a distributor's details.
const LABELS = ["Your business", "Your account", "Godowns", "Backups", "Done"];
const inp = "border border-input rounded-lg px-3 py-2.5 text-[14px] outline-none bg-white focus:border-teal focus:ring-2 focus:ring-teal/15 w-full";

const suggestCode = (name: string, addr: string) => {
  const w = name.toUpperCase().replace(/[^A-Z ]/g, "").trim().split(/\s+/)[0]?.slice(0, 4) ?? "";
  const city = addr.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z ]{3,}$/.test(x)).pop()?.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) ?? "";
  return w ? (city ? `${w}-${city}` : w) : "";
};

export function DistributorSignup({ signup, google = null, verifiedEmail = "" }: { signup: boolean; google?: { name: string; email: string } | null; verifiedEmail?: string }) {
  const router = useRouter();
  const t = useT();
  const [step, setStep] = useState(1);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [biz, setBiz] = useState({ name: "", code: "", gstin: "", dl: "", address: "" });
  const [codeTouched, setCodeTouched] = useState(false);
  const [owner, setOwner] = useState({ name: google?.name ?? "", email: google?.email ?? verifiedEmail, phone: "", password: "", password2: "" });
  const [godowns, setGodowns] = useState(["Main godown"]);
  const [newGodown, setNewGodown] = useState("");
  const [kit, setKit] = useState<{ key: string; fp: string } | null>(null);
  const [kitAck, setKitAck] = useState(false);
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState<{ code: string; google: boolean } | null>(null);

  const setB = (k: keyof typeof biz) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = k === "gstin" || k === "code" ? e.target.value.toUpperCase() : e.target.value;
    setBiz((x) => {
      const n = { ...x, [k]: v };
      if (!codeTouched && (k === "name" || k === "address")) n.code = suggestCode(n.name, n.address);
      return n;
    });
    if (k === "code") setCodeTouched(true);
  };
  const setO = (k: keyof typeof owner) => (e: React.ChangeEvent<HTMLInputElement>) => setOwner((x) => ({ ...x, [k]: e.target.value }));
  const addGodown = () => { const n = newGodown.trim(); if (n && !godowns.includes(n)) setGodowns((x) => [...x, n]); setNewGodown(""); };

  const makeKit = async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const fp = Array.from(digest.slice(0, 4), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
    downloadRecoveryKit({ pharmacy: biz.name, code: biz.code, key, fingerprint: fp });
    setKit({ key, fp });
  };

  const next = () => {
    setErr("");
    const e = (m: string) => setErr(m);
    if (step === 1) {
      if (!biz.name.trim() || !biz.dl.trim() || !biz.address.trim()) return e("Business name, wholesale drug licence and address are required.");
      if (!GSTIN_RE.test(biz.gstin)) return e("GSTIN format looks wrong (e.g. 27AAKFS3192P1Z6).");
      if (!/^[A-Z0-9]{3,8}(-[A-Z0-9]{2,8})?$/.test(biz.code)) return e("Business code: letters and numbers, like SHAH-PUNE.");
    }
    if (step === 2) {
      if (owner.name.trim().length < 2) return e("Enter your full name.");
      if (!/^\S+@\S+\.\S+$/.test(owner.email)) return e("Enter a valid email.");
      if (!MOBILE_RE.test(normPhone(owner.phone))) return e("Enter a valid 10-digit Indian mobile number.");
      if (!google && owner.password.length < 10) return e("Password must be at least 10 characters.");
      if (!google && owner.password !== owner.password2) return e("Passwords do not match.");
    }
    if (step === 3 && !godowns.length) return e("Add at least one godown.");
    if (step === 4) {
      if (!kit || !kitAck) return e("Download the recovery kit and confirm you stored it.");
      if (signup && !agree) return e("Accept the Terms and Privacy Policy to continue.");
      return start(async () => {
        const r = await createDistributorAction({ business: biz, owner: { name: owner.name, email: owner.email, phone: owner.phone, password: owner.password }, godowns, backupKey: kit.key, kitAck: true, agree });
        if (!r.ok) return setErr(r.error);
        setDone(r.data); setStep(5);
      });
    }
    setStep(step + 1);
  };

  return (
    <div className="w-[min(860px,100%)] flex flex-col gap-[18px]">
      <div className="flex gap-1.5 flex-wrap">
        {LABELS.map((l, i) => (
          <div key={l} className="flex-1 min-w-[96px] flex flex-col gap-1.5">
            <div className="h-1 rounded-sm" style={{ background: i + 1 <= step ? "#0B5E5B" : "#DCE0E3" }} />
            <span className="text-[12.5px]" style={{ color: i + 1 === step ? "#1F2328" : "#6B737B", fontWeight: i + 1 === step ? 600 : 400 }}>{i + 1}. {t(l)}</span>
          </div>
        ))}
      </div>
      <div className="bg-white border border-[#E3E6E9] rounded-[14px] px-7 py-[26px] flex flex-col gap-4">
        {step === 1 ? (
          <>
            <div className="text-[19px] font-semibold">{t("Your business")}</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5">
              <input className={inp} value={biz.name} onChange={setB("name")} placeholder={t("Business name *")} aria-label={t("Business name")} autoFocus />
              <input className={cn(inp, "font-mono")} value={biz.gstin} onChange={setB("gstin")} placeholder={t("GSTIN (15 characters) *")} aria-label="GSTIN" maxLength={15} />
              <input className={inp} value={biz.dl} onChange={setB("dl")} placeholder={t("Wholesale drug licence (20B/21B) *")} aria-label={t("Wholesale drug licence")} />
              <input className={cn(inp, "col-span-full")} value={biz.address} onChange={setB("address")} placeholder={t("Address, city, PIN *")} aria-label={t("Address")} />
            </div>
            <div className="flex gap-2.5 items-center text-[13.5px] flex-wrap">
              <span>{t("Business code")}</span>
              <input className={cn(inp, "font-mono w-[180px]")} value={biz.code} onChange={setB("code")} placeholder="SHAH-PUNE" aria-label={t("Business code")} />
              <span className="text-[12.5px] text-faint">{t("Your team and chemists use this code to find your business.")}</span>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="text-[19px] font-semibold">{t("Your owner account")}</div>
            <div className="text-[13.5px] text-muted -mt-2">{t("There are no default logins. This account owns the business and can add everyone else.")}</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5">
              <input className={inp} value={owner.name} onChange={setO("name")} placeholder={t("Full name *")} aria-label={t("Full name")} autoComplete="name" autoFocus />
              <input className={inp + (google || verifiedEmail ? " bg-page text-muted" : "")} value={owner.email} onChange={setO("email")} readOnly={!!google || !!verifiedEmail} placeholder={t("Email *")} aria-label={t("Email")} type="email" autoComplete="email" />
              <input className={inp} value={owner.phone} onChange={setO("phone")} placeholder={t("Mobile number *")} aria-label={t("Mobile number")} inputMode="tel" autoComplete="tel" />
              {google ? null : (
                <>
                  <div />
                  <input className={inp} value={owner.password} onChange={setO("password")} placeholder={t("Password (10+ characters) *")} aria-label={t("Password")} type="password" autoComplete="new-password" />
                  <input className={inp} value={owner.password2} onChange={setO("password2")} placeholder={t("Confirm password *")} aria-label={t("Confirm password")} type="password" autoComplete="new-password" />
                </>
              )}
            </div>
            <div className="text-[12.5px] text-faint">{google
              ? t("You’ll sign in with Google ({email}). No password needed. You can set one later from Profile.", { email: google.email })
              : t("After setup you’ll scan a QR code with an authenticator app and save 10 recovery codes. Two-step verification is required for owners and managers. You can connect Google sign-in later from Profile; your password stays as the way back in.")}</div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="text-[19px] font-semibold">{t("Godowns")}</div>
            <div className="text-[13.5px] text-muted -mt-2">{t("Stock, orders and dispatch are kept per godown. You can add more later.")}</div>
            {godowns.map((g, i) => (
              <div key={i} className="flex items-center gap-2.5 border border-line rounded-[10px] px-3.5 py-2.5 flex-wrap">
                <Warehouse size={17} className="text-teal" />
                <input className="flex-1 min-w-[160px] text-[14px] font-semibold outline-none bg-transparent" value={g} aria-label={t("Godown name")} onChange={(e) => setGodowns((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
                <button type="button" onClick={() => setGodowns((x) => x.filter((_, j) => j !== i))} className="text-bad text-[12.5px] flex items-center gap-1 cursor-pointer"><Trash2 size={14} />{t("Remove")}</button>
              </div>
            ))}
            <div className="flex gap-2">
              <input className={inp} value={newGodown} onChange={(e) => setNewGodown(e.target.value)} placeholder={t("Godown name, e.g. Bhiwandi")} aria-label={t("New godown")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGodown(); } }} />
              <Button onClick={addGodown} className="h-[42px]">Add godown</Button>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="text-[19px] font-semibold">{t("Backups & recovery kit")}</div>
            <div className="flex gap-3 items-center border border-line rounded-[10px] p-3.5 flex-wrap">
              <KeyRound size={20} className="text-teal" />
              <div className="flex flex-col flex-1 min-w-[200px]"><strong className="text-[14px]">{t("Encryption recovery kit")}</strong>
                <span className="text-[12.5px] text-muted">{kit ? <>{t("Downloaded · key fingerprint")} <span className="font-mono">{kit.fp}</span></> : t("Contains your backup decryption key: the only way to open your backups elsewhere. Medoro keeps a sealed copy only to run your backups.")}</span></div>
              <Button variant="primary" onClick={makeKit}>{kit ? "Download again" : "Download & print"}</Button>
            </div>
            <label className="flex gap-2 text-[13.5px] cursor-pointer"><input type="checkbox" className="accent-teal mt-0.5" checked={kitAck} onChange={(e) => setKitAck(e.target.checked)} />{t("I’ve stored the recovery kit offline. Without it, backups can’t be restored.")}</label>
            {signup ? (
              <label className="flex gap-2 text-[13.5px] cursor-pointer"><input type="checkbox" className="accent-teal mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{t("I agree to the")} <a href="/legal#terms" target="_blank" className="text-teal underline">{t("Terms")}</a>, <a href="/legal#privacy" target="_blank" className="text-teal underline">{t("Privacy policy")}</a> {t("and")} <a href="/legal#refund" target="_blank" className="text-teal underline">{t("Cancellation & refund policy")}</a>.</span></label>
            ) : null}
          </>
        ) : null}

        {step === 5 && done ? (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <CircleCheck size={44} className="text-ok" />
            <div className="text-[22px] font-semibold">{t("{name} is ready", { name: biz.name })}</div>
            <div className="text-[13.5px] text-muted max-w-[560px]">{t("Your 7-day free trial has started with every feature.")} {t("{n} godown(s)", { n: godowns.length })} · {t("Business code")} <span className="font-mono text-ink">{done.code}</span>.</div>
            {done.google
              ? <Button variant="primary" size="lg" onClick={() => router.replace("/dist")}>Open Medoro Distribution</Button>
              : <Button variant="primary" size="lg" onClick={() => router.replace("/signin/mfa")}>Set up two-step verification</Button>}
          </div>
        ) : null}

        {err ? <div role="alert" className="text-[13px] text-bad">{t(err)}</div> : null}
        {step < 5 ? (
          <div className="flex justify-between gap-2.5 pt-1">
            <Button onClick={() => { setErr(""); setStep(Math.max(1, step - 1)); }} disabled={step === 1 || pending}>Back</Button>
            <Button variant="primary" onClick={next} disabled={pending}>{pending && step === 4 ? "Creating…" : step === 4 ? "Create my distributor account" : "Continue"}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
