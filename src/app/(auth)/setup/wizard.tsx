"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cloud, Server, Network, Monitor, Store, HardDriveUpload, KeyRound, CircleCheck, CircleAlert, Circle, LoaderCircle, Trash2, Copy } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { GSTIN_RE, MOBILE_RE, ROLE_OPTIONS, inviteContact, normPhone } from "@/domain/identity/contracts";
import { setupAction, testDatabase } from "../actions";
import { useSetupDrive } from "./drive-connect";

const LABELS = ["Pharmacy", "Your account", "Database", "Branches", "Team", "Backups", "Done"];
const inp = "border border-input rounded-lg px-3 py-2.5 text-[14px] outline-none bg-white focus:border-teal focus:ring-2 focus:ring-teal/15 w-full";
type Dep = "cloud" | "onprem" | "lan" | "single";
const HOSTS: [Dep, React.ComponentType<{ size?: number; className?: string }>, string, string][] = [
  ["cloud", Cloud, "Your cloud server", "Your own AWS, Azure or GCP account, or another provider you choose"],
  ["onprem", Server, "On-premises server", "A server you own, in the shop or at your office"],
  ["lan", Network, "Shop LAN", "One PC hosts the database and the other counters join over Wi-Fi or LAN"],
  ["single", Monitor, "Single device", "One computer, no sharing"],
];

const suggestCode = (name: string, addr: string) => {
  const w = name.toUpperCase().replace(/[^A-Z ]/g, "").trim().split(/\s+/)[0]?.slice(0, 4) ?? "";
  const city = addr.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z ]{3,}$/.test(x)).pop()?.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) ?? "";
  return w ? (city ? `${w}-${city}` : w) : "";
};

export function Wizard({ deployment, driveApp = false, driveAccount = null, onRestore }: { deployment: Dep; driveApp?: boolean; driveAccount?: string | null; onRestore?: () => void }) {
  const router = useRouter();
  const drive = useSetupDrive(driveAccount);
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const [ph, setPh] = useState({ name: "", code: "", gstin: "", dl: "", pharmacist: "", address: "", lang: "en" as "en" | "hi" | "hinglish" });
  const [codeTouched, setCodeTouched] = useState(false);
  const [owner, setOwner] = useState({ name: "", email: "", phone: "", password: "", password2: "" });
  const [host, setHost] = useState<Dep>(deployment);
  const [db, setDb] = useState<{ state: "idle" | "testing" | "ok" | "fail"; msg: string }>({ state: "idle", msg: "Not tested" });
  const [branches, setBranches] = useState([{ name: "Main branch", counters: 1 }]);
  const [newBranch, setNewBranch] = useState("");
  const [invites, setInvites] = useState<{ contact: string; role: (typeof ROLE_OPTIONS)[number]; branch: string }[]>([]);
  const [inv, setInv] = useState({ contact: "", role: "Cashier" as (typeof ROLE_OPTIONS)[number], branch: "" });
  const [kit, setKit] = useState<{ key: string; fp: string } | null>(null);
  const [kitAck, setKitAck] = useState(false);
  const [result, setResult] = useState<{ invites: { contact: string; role: string; code: string }[]; tenantCode: string } | null>(null);

  const setP = (k: keyof typeof ph) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = k === "gstin" || k === "code" ? e.target.value.toUpperCase() : e.target.value;
    setPh((x) => {
      const n = { ...x, [k]: v };
      if (!codeTouched && (k === "name" || k === "address")) n.code = suggestCode(n.name, n.address);
      return n;
    });
    if (k === "code") setCodeTouched(true);
  };
  const setO = (k: keyof typeof owner) => (e: React.ChangeEvent<HTMLInputElement>) => setOwner((x) => ({ ...x, [k]: e.target.value }));

  const makeKit = async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const fp = Array.from(digest.slice(0, 4), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
    const text = [
      "MEDORO BACKUP RECOVERY KIT", "==========================", "",
      `Pharmacy: ${ph.name}`, `Pharmacy code: ${ph.code}`, `Created: ${new Date().toLocaleString("en-IN")}`, "",
      "Backup decryption key:", key, "", `Key fingerprint: ${fp}`, "",
      "Keep this printed and offline (a locker or safe). Anyone with this key and your backup",
      "files can read your data. Without it, encrypted backups cannot be restored on a new server.",
      "Your server keeps a copy sealed with its HOST_KEY so it can make and restore backups on",
      "its own. Medoro, the company, never receives this key.",
      "",
      "To restore on a new server: open /setup there, choose \"Restore from a backup\", pick the",
      "backup file or Google Drive, and paste the key above.",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `medoro-recovery-kit-${ph.code || "pharmacy"}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setKit({ key, fp });
  };

  const next = () => {
    setErr("");
    const e = (m: string) => setErr(m);
    if (step === 1) {
      if (!ph.name.trim() || !ph.dl.trim()) return e("Pharmacy name and drug licence number are required.");
      if (ph.gstin && !GSTIN_RE.test(ph.gstin)) return e("GSTIN format looks wrong (e.g. 27AAKFS3192P1Z6).");
      if (!/^[A-Z0-9]{3,8}(-[A-Z0-9]{2,8})?$/.test(ph.code)) return e("Pharmacy code: letters and numbers, like SANJ-PUNE.");
    }
    if (step === 2) {
      if (owner.name.trim().length < 2) return e("Enter your full name.");
      if (!/^\S+@\S+\.\S+$/.test(owner.email)) return e("Enter a valid email.");
      if (!MOBILE_RE.test(normPhone(owner.phone))) return e("Enter a valid 10-digit Indian mobile number.");
      if (owner.password.length < 10) return e("Password must be at least 10 characters.");
      if (owner.password !== owner.password2) return e("Passwords do not match.");
    }
    if (step === 3 && db.state !== "ok") return e("Test the database connection before continuing.");
    if (step === 4 && !branches.length) return e("Add at least one branch.");
    if (step === 6) {
      if (!kit || !kitAck) return e("Download the recovery kit and confirm you stored it.");
      return start(async () => {
        const r = await setupAction({
          pharmacy: ph, owner: { name: owner.name, email: owner.email, phone: owner.phone, password: owner.password },
          deployment: host, branches, invites: invites.map((i) => ({ ...i, branch: i.branch || branches[0]?.name })), backupKey: kit.key, kitAck: true,
        });
        if (!r.ok) return setErr(r.error);
        setResult(r.data!); setStep(7);
      });
    }
    setStep(step + 1);
  };

  const test = () => {
    setDb({ state: "testing", msg: "Connecting…" }); setErr("");
    start(async () => {
      const r = await testDatabase();
      setDb(r.ok ? { state: "ok", msg: r.data! } : { state: "fail", msg: r.error });
    });
  };

  const addInvite = () => {
    const c = inviteContact(inv.contact.trim());
    if (!c) return setErr("Enter a valid email or 10-digit mobile number.");
    if (inv.role === "Manager" && !c.email) return setErr("Invite managers by email: they sign in with a password and an authenticator app.");
    if (invites.some((i) => i.contact === inv.contact.trim())) return setErr("Already invited.");
    setErr(""); setInvites((x) => [...x, { ...inv, contact: inv.contact.trim(), branch: inv.branch || branches[0]?.name || "" }]); setInv((x) => ({ ...x, contact: "" }));
  };

  const DbIcon = { idle: Circle, testing: LoaderCircle, ok: CircleCheck, fail: CircleAlert }[db.state];
  const dbFg = { idle: "#5B636B", testing: "#0B5E5B", ok: "#1E7F4F", fail: "#B3261E" }[db.state];

  return (
    <div className="w-[min(860px,100%)] flex flex-col gap-[18px]">
      {step === 1 && onRestore ? (
        <button type="button" onClick={onRestore} className="self-start text-[13.5px] text-teal cursor-pointer bg-transparent border-0 p-0">Moving to a new server or recovering from a backup? Restore from a backup instead →</button>
      ) : null}
      <div className="flex gap-1.5 flex-wrap">
        {LABELS.map((l, i) => (
          <div key={l} className="flex-1 min-w-[96px] flex flex-col gap-1.5">
            <div className="h-1 rounded-sm" style={{ background: i + 1 <= step ? "#0B5E5B" : "#DCE0E3" }} />
            <span className="text-[12.5px]" style={{ color: i + 1 === step ? "#1F2328" : "#6B737B", fontWeight: i + 1 === step ? 600 : 400 }}>{i + 1}. {l}</span>
          </div>
        ))}
      </div>
      <div className="bg-white border border-[#E3E6E9] rounded-[14px] px-7 py-[26px] flex flex-col gap-4">
        {step === 1 ? (
          <>
            <div className="text-[19px] font-semibold">Your pharmacy</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5">
              <input className={inp} value={ph.name} onChange={setP("name")} placeholder="Pharmacy name *" aria-label="Pharmacy name" autoFocus />
              <input className={cn(inp, "font-mono")} value={ph.gstin} onChange={setP("gstin")} placeholder="GSTIN (15 characters)" aria-label="GSTIN" maxLength={15} />
              <input className={inp} value={ph.dl} onChange={setP("dl")} placeholder="Drug licence no. (20B/21B) *" aria-label="Drug licence number" />
              <input className={inp} value={ph.pharmacist} onChange={setP("pharmacist")} placeholder="Registered pharmacist & reg. no." aria-label="Registered pharmacist" />
              <input className={cn(inp, "col-span-full")} value={ph.address} onChange={setP("address")} placeholder="Address, city, PIN" aria-label="Address" />
            </div>
            <div className="flex gap-2.5 items-center text-[13.5px] flex-wrap">
              <span>Pharmacy code</span>
              <input className={cn(inp, "font-mono w-[180px]")} value={ph.code} onChange={setP("code")} placeholder="SANJ-PUNE" aria-label="Pharmacy code" />
              <span className="text-[12.5px] text-faint">Staff type this at the counter with their employee ID and PIN.</span>
            </div>
            <div className="flex gap-2.5 items-center text-[13.5px]">Interface language
              <select value={ph.lang} onChange={setP("lang")} className="border border-input rounded-lg px-2.5 py-2 text-[13.5px] bg-white">
                <option value="en">English</option><option value="hi">हिंदी</option><option value="hinglish">English + Hinglish AI</option>
              </select>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="text-[19px] font-semibold">Your owner account</div>
            <div className="text-[13.5px] text-muted -mt-2">There are no default logins. This account owns the pharmacy and can add everyone else.</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5">
              <input className={inp} value={owner.name} onChange={setO("name")} placeholder="Full name *" aria-label="Full name" autoComplete="name" autoFocus />
              <input className={inp} value={owner.email} onChange={setO("email")} placeholder="Email *" aria-label="Email" type="email" autoComplete="email" />
              <input className={inp} value={owner.phone} onChange={setO("phone")} placeholder="Mobile number *" aria-label="Mobile number" inputMode="tel" autoComplete="tel" />
              <div />
              <input className={inp} value={owner.password} onChange={setO("password")} placeholder="Password (10+ characters) *" aria-label="Password" type="password" autoComplete="new-password" />
              <input className={inp} value={owner.password2} onChange={setO("password2")} placeholder="Confirm password *" aria-label="Confirm password" type="password" autoComplete="new-password" />
            </div>
            <div className="text-[12.5px] text-faint">After setup you’ll scan a QR code with an authenticator app and save 10 recovery codes. Two-step verification is required for owners and managers. You can connect Google sign-in later from Profile; your password stays as the way back in.</div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="text-[19px] font-semibold">Where does your live database run?</div>
            <div className="text-[13.5px] text-muted -mt-2">You own this database. Medoro connects to it but never hosts your pharmacy records.</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
              {HOSTS.map(([id, Icon, label, desc]) => (
                <button key={id} type="button" onClick={() => setHost(id)} className="flex flex-col items-start gap-1.5 text-left rounded-[10px] p-3.5 cursor-pointer"
                  style={{ background: host === id ? "#F0F7F6" : "#fff", border: host === id ? "2px solid #0B5E5B" : "1px solid #E3E6E9" }}>
                  <Icon size={20} className="text-teal" /><strong className="text-[14px]">{label}</strong><span className="text-[12.5px] text-muted">{desc}</span>
                </button>
              ))}
            </div>
            <div className="bg-subtle border border-line rounded-[10px] p-3.5 flex flex-col gap-2.5">
              <div className="text-[13px] text-ink-2">This server is connected to the PostgreSQL database in its configuration (<span className="font-mono">DATABASE_URL</span>). Test it before continuing.</div>
              <div className="flex gap-3 items-center flex-wrap">
                <Button onClick={test} disabled={db.state === "testing"}>Test connection</Button>
                <span className="flex items-center gap-1.5 text-[13px]" style={{ color: dbFg }}><DbIcon size={15} className={db.state === "testing" ? "animate-spin" : ""} />{db.msg}</span>
              </div>
            </div>
            <div className="text-[12.5px] text-faint">The database is never exposed to browsers; all access goes through the Medoro app service on your server. Use TLS between the app and a remote database.</div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="text-[19px] font-semibold">Branches & counters</div>
            {branches.map((b, i) => (
              <div key={i} className="flex items-center gap-2.5 border border-line rounded-[10px] px-3.5 py-2.5 flex-wrap">
                <Store size={17} className="text-teal" />
                <input className="flex-1 min-w-[160px] text-[14px] font-semibold outline-none bg-transparent" value={b.name} aria-label="Branch name"
                  onChange={(e) => setBranches((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                <label className="flex items-center gap-1.5 text-[13px] text-muted">Counters
                  <input type="number" min={1} max={20} value={b.counters} className="w-16 border border-input rounded-md px-2 py-1 text-[13.5px]"
                    onChange={(e) => setBranches((x) => x.map((y, j) => (j === i ? { ...y, counters: Math.max(1, Math.min(20, Number(e.target.value) || 1)) } : y)))} />
                </label>
                <button type="button" onClick={() => setBranches((x) => x.filter((_, j) => j !== i))} className="text-bad text-[12.5px] flex items-center gap-1 cursor-pointer"><Trash2 size={14} />Remove</button>
              </div>
            ))}
            <div className="flex gap-2">
              <input className={inp} value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="Branch name, e.g. Kothrud" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newBranch.trim()) { setBranches((x) => [...x, { name: newBranch.trim(), counters: 1 }]); setNewBranch(""); } } }} />
              <Button onClick={() => { if (newBranch.trim()) { setBranches((x) => [...x, { name: newBranch.trim(), counters: 1 }]); setNewBranch(""); } }} className="h-[42px]">Add branch</Button>
            </div>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <div className="text-[19px] font-semibold">Invite your team</div>
            <div className="text-[13.5px] text-muted -mt-2">Each person gets an invite code (valid 48 hours) to create their own account. You can skip this and add people later in Users & branches.</div>
            {invites.map((iv, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-row py-2 text-[13.5px]">
                <span className="flex-1">{iv.contact}</span><span className="text-muted">{iv.role}</span><span className="text-muted">{iv.branch}</span>
                <button type="button" onClick={() => setInvites((x) => x.filter((_, j) => j !== i))} className="text-bad cursor-pointer" aria-label="Remove invite"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="flex gap-2 flex-wrap">
              <input className={cn(inp, "flex-1 min-w-[200px] w-auto")} value={inv.contact} onChange={(e) => setInv((x) => ({ ...x, contact: e.target.value }))} placeholder="Email or mobile" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInvite(); } }} />
              <select value={inv.role} onChange={(e) => setInv((x) => ({ ...x, role: e.target.value as typeof inv.role }))} className="border border-input rounded-lg px-2.5 text-[13.5px] bg-white">{ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}</select>
              {branches.length > 1 ? <select value={inv.branch || branches[0].name} onChange={(e) => setInv((x) => ({ ...x, branch: e.target.value }))} className="border border-input rounded-lg px-2.5 text-[13.5px] bg-white">{branches.map((b) => <option key={b.name}>{b.name}</option>)}</select> : null}
              <Button onClick={addInvite} className="h-[42px]">Add invite</Button>
            </div>
            <div className="text-[12.5px] text-faint">Roles can be fine-tuned later in Users & branches. Managers need an email invite: they use a password and an authenticator.</div>
          </>
        ) : null}

        {step === 6 ? (
          <>
            <div className="text-[19px] font-semibold">Backups & recovery kit</div>
            <div className="flex gap-3 items-center border border-line rounded-[10px] p-3.5 flex-wrap">
              <HardDriveUpload size={20} className="text-teal" />
              <div className="flex flex-col flex-1 min-w-[200px]"><strong className="text-[14px]">Google Drive <span className="font-normal text-muted">(optional)</span></strong>
                <span className="text-[12.5px] text-muted">{!driveApp ? "Google sign-in isn’t configured on this server; you can connect later in Backup & restore." : drive.account ? <>Connected as {drive.account}. Daily backups go to Medoro/{ph.name || "your pharmacy"} in this Drive, encrypted on your server first.</> : "Daily encrypted backups to your own Drive. Medoro can see only the files it creates. You can also connect later in Backup & restore."}</span>
                {drive.msg ? <span className="text-[12.5px] text-bad">{drive.msg}</span> : null}</div>
              {driveApp ? (drive.account ? <Button onClick={() => void drive.forget()}>Remove</Button> : <Button onClick={drive.connect}>Connect</Button>) : null}
            </div>
            <div className="flex gap-3 items-center border border-line rounded-[10px] p-3.5 flex-wrap">
              <KeyRound size={20} className="text-teal" />
              <div className="flex flex-col flex-1 min-w-[200px]"><strong className="text-[14px]">Encryption recovery kit</strong>
                <span className="text-[12.5px] text-muted">{kit ? <>Downloaded · key fingerprint <span className="font-mono">{kit.fp}</span></> : "Contains your backup decryption key: the only way to open backups on a new server. Your server keeps a sealed copy to run backups; Medoro never receives it."}</span></div>
              <Button variant="primary" onClick={makeKit}>{kit ? "Download again" : "Download & print"}</Button>
            </div>
            <label className="flex gap-2 text-[13.5px] cursor-pointer"><input type="checkbox" className="accent-teal mt-0.5" checked={kitAck} onChange={(e) => setKitAck(e.target.checked)} />I&apos;ve stored the recovery kit offline. Without it, backups can&apos;t be restored.</label>
          </>
        ) : null}

        {step === 7 && result ? (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <CircleCheck size={44} className="text-ok" />
            <div className="text-[22px] font-semibold">{ph.name} is ready</div>
            <div className="text-[13.5px] text-muted max-w-[560px]">
              {HOSTS.find((h) => h[0] === host)![2]} · {branches.length} branch(es) · {result.invites.length} invite(s) · {drive.account ? "Google Drive connected" : "Google Drive not connected"}. Strict customer-controlled mode is on. Pharmacy code <span className="font-mono text-ink">{result.tenantCode}</span>.
            </div>
            {result.invites.length ? (
              <div className="w-full max-w-[560px] border border-line rounded-[10px] text-left">
                <div className="px-3.5 py-2 text-[12.5px] text-muted border-b border-line-soft">Share these invite codes with your team (valid 48 hours). Messages aren’t sent automatically.</div>
                {result.invites.map((i) => (
                  <div key={i.code} className="flex items-center gap-3 px-3.5 py-2 text-[13.5px] border-b border-row last:border-0">
                    <span className="flex-1">{i.contact}</span><span className="text-muted">{i.role}</span><span className="font-mono font-semibold">{i.code}</span>
                    <button className="text-faint hover:text-teal cursor-pointer" aria-label="Copy" onClick={() => { navigator.clipboard.writeText(`Join ${ph.name} on Medoro: pharmacy code ${result.tenantCode}, invite code ${i.code}`); toast("Invite copied", "green"); }}><Copy size={14} /></button>
                  </div>
                ))}
              </div>
            ) : null}
            <Button variant="primary" size="lg" onClick={() => router.replace("/signin/mfa")}>Set up two-step verification</Button>
          </div>
        ) : null}

        {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
        {step < 7 ? (
          <div className="flex justify-between gap-2.5 pt-1">
            <Button onClick={() => { setErr(""); setStep(Math.max(1, step - 1)); }} disabled={step === 1 || pending}>Back</Button>
            <Button variant="primary" onClick={next} disabled={pending}>{pending && step === 6 ? "Creating…" : step === 6 ? "Finish setup" : "Continue"}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
