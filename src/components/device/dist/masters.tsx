"use client";
import { addDays, todayISO } from "@/lib/dates";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { useT } from "@/lib/i18n-client";
import { card, input, label, errText, toPaise, type Cfg, type Who } from "../ui";
import { portalRequestsAction } from "@/app/dist/actions";

type ChemRow = { id: string; name: string; phone: string | null; gstin: string | null; creditLimitPaise: number; profile: boolean; stateCode: string | null; dl20b: string | null; dl21b: string | null; dlExpiry: string | null;
  creditDays: number | null; graceDays: number | null; priceTier: string | null; status: string | null; balancePaise: number; portalAccountId: string | null };
const blank = { name: "", phone: "", gstin: "", limit: "", stateCode: "", dl20b: "", dl21b: "", dlExpiry: "", creditDays: "21", graceDays: "7", priceTier: "ptr" as "ptr" | "pts" };

/** Chemists: wholesale profile (licences, credit terms, price tier), hold / block, special rates, and portal requests. */
export function Chemists({ who }: { who: Who }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ChemRow[]>([]);
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(() => dev.call("distChemists", q).then((r) => setRows(r as ChemRow[]), () => setRows([])), [dev, q]);
  useEffect(() => { void load(); }, [load]);
  const edit = (c: ChemRow) => { setEditing(c.id); setF({ name: c.name, phone: c.phone ?? "", gstin: c.gstin ?? "", limit: String(c.creditLimitPaise / 100), stateCode: c.stateCode ?? "", dl20b: c.dl20b ?? "", dl21b: c.dl21b ?? "", dlExpiry: c.dlExpiry ?? "", creditDays: String(c.creditDays ?? 21), graceDays: String(c.graceDays ?? 7), priceTier: (c.priceTier as "ptr") ?? "ptr" }); };
  const save = async () => {
    try {
      const id = editing ?? (await dev.call("addCustomer", { name: f.name, phone: f.phone || null, gstin: f.gstin || null, creditLimitPaise: toPaise(f.limit) })).id;
      await dev.call("saveDistChemist", { customerId: id, stateCode: f.stateCode || null, dl20b: f.dl20b || undefined, dl21b: f.dl21b || undefined, dlExpiry: f.dlExpiry || null, creditDays: Number(f.creditDays) || 0, graceDays: Number(f.graceDays) || 0, priceTier: f.priceTier });
      toast(t("Chemist saved."), "green"); setF(blank); setEditing(null); void load();
    } catch (e) { toast(errText(e), "red"); }
  };
  const status = async (c: ChemRow, s: "active" | "hold" | "blocked") => {
    const note = s === "active" ? "" : prompt(t("Why?")) ?? "";
    try { await dev.call("setDistChemistStatus", c.id, s, note); void load(); } catch (e) { toast(errText(e), "red"); }
  };
  const field = (k: keyof typeof blank, l: string, ph = "") => <label className={label}>{t(l)}<input className={input} placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} max-w-3xl`}>
        <div className="font-semibold">{t(editing ? "Edit chemist" : "Add a chemist")}</div>
        <div className="grid grid-cols-3 gap-2">
          {!editing && field("name", "Firm name")}{!editing && field("phone", "Mobile")}{!editing && field("gstin", "GSTIN")}{!editing && field("limit", "Credit limit (₹)")}
          {field("stateCode", "State code", "27")}{field("dl20b", "Drug licence 20B")}{field("dl21b", "Drug licence 21B")}{field("dlExpiry", "Licence valid till", "2027-03-31")}
          {field("creditDays", "Credit days")}{field("graceDays", "Grace days")}
          <label className={label}>{t("Price tier")}<select className={input} value={f.priceTier} onChange={(e) => setF({ ...f, priceTier: e.target.value as "ptr" })}><option value="ptr">PTR</option><option value="pts">PTS</option></select></label>
        </div>
        <div className="flex gap-2"><Button variant="primary" onClick={save}>{t("Save")}</Button>{editing && <Button onClick={() => { setEditing(null); setF(blank); }}>{t("Cancel")}</Button>}</div>
      </div>
      <PortalRequests onApproved={load} owner={who.owner} />
      <div className={card}>
        <input className={input} placeholder={t("Search chemist by name or phone")} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="text-sm divide-y divide-line">{rows.map((c) => (
          <li key={c.id} className="py-2 flex justify-between gap-2 flex-wrap items-center">
            <span><b>{c.name}</b>{c.phone ? ` · ${c.phone}` : ""} · {t("owes")} {inr(c.balancePaise)}{!c.profile ? <span className="text-muted"> · {t("no wholesale profile")}</span> : c.status !== "active" ? <span className="text-bad"> · {t(c.status === "hold" ? "On hold" : "Blocked")}</span> : ""}{c.portalAccountId ? ` · ${t("portal")}` : ""}</span>
            <span className="flex gap-1.5"><Button size="sm" onClick={() => edit(c)}>{t("Edit")}</Button>
              {c.profile && (c.status === "active" ? <><Button size="sm" onClick={() => status(c, "hold")}>{t("Hold")}</Button><Button size="sm" variant="danger-outline" onClick={() => status(c, "blocked")}>{t("Block")}</Button></> : <Button size="sm" onClick={() => status(c, "active")}>{t("Make active")}</Button>)}</span>
          </li>
        ))}</ul>
      </div>
    </div>
  );
}

type Req = { id: string; accountId: string; firmName: string; ownerName: string; phone: string; gstin: string | null; dl20b: string; dl21b: string; dlExpiry: string; address: string; pincode: string; stateCode: string };
function PortalRequests({ onApproved, owner }: { onApproved: () => void; owner: boolean }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [rows, setRows] = useState<Req[]>([]);
  const load = useCallback(() => portalRequestsAction().then((r) => setRows(r.ok ? r.data : []), () => setRows([])), []);
  useEffect(() => { void load(); }, [load]);
  if (!rows.length) return null;
  const approve = async (r: Req) => {
    const limit = prompt(t("Credit limit for {name} (₹)", { name: r.firmName }), "0");
    if (limit === null) return;
    try {
      await dev.call("distApprovePortalChemist", r.id, { accountId: r.accountId, firmName: r.firmName, ownerName: r.ownerName, phone: r.phone, gstin: r.gstin, dl20b: r.dl20b, dl21b: r.dl21b, dlExpiry: r.dlExpiry, address: r.address, pincode: r.pincode, stateCode: r.stateCode, creditLimitPaise: toPaise(limit) });
      toast(t("{name} can now order on the portal.", { name: r.firmName }), "green"); void load(); onApproved();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className={card}>
      <div className="font-semibold">{t("Chemists asking to order on the portal")}</div>
      <ul className="text-sm divide-y divide-line">{rows.map((r) => (
        <li key={r.id} className="py-2 flex justify-between gap-2 items-center"><span><b>{r.firmName}</b> · {r.phone} · DL {r.dl20b} / {r.dl21b} · {t("valid till {date}", { date: r.dlExpiry })} · {r.pincode}</span>
          {owner && <Button size="sm" variant="primary" onClick={() => approve(r)}>{t("Approve")}</Button>}</li>
      ))}</ul>
      {!owner && <div className="text-[13px] text-muted">{t("Only the owner’s device can approve portal chemists.")}</div>}
    </div>
  );
}

type Prod = { id: string; name: string; packSize: number; gstRate: number; mrpPaise: number; wholesale: boolean; companyId: string | null; company: string | null; ptrPaise: number; ptsPaise: number; minOrderQty: number; portalVisible: boolean; discontinued: boolean; freePacks: number };

/** Products with their wholesale terms, companies and principals, and trade schemes. */
export function Products({ cfg }: { cfg: Cfg }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Prod[]>([]);
  const [cos, setCos] = useState<{ id: string; name: string }[]>([]);
  const [sel, setSel] = useState<Prod | null>(null);
  const [tm, setTm] = useState({ ptr: "", pts: "", companyId: "", min: "1", portal: true, discontinued: false });
  const [nm, setNm] = useState({ name: "", gst: "12", mrp: "", pack: "1", hsn: "3004" });
  const [coName, setCoName] = useState("");
  const load = useCallback(() => { dev.call("distProducts", cfg.branchId, q).then((r) => setRows(r as Prod[]), () => setRows([])); dev.call("distCompanies").then(setCos, () => setCos([])); }, [dev, cfg.branchId, q]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "green"); load(); } catch (e) { toast(errText(e), "red"); } };
  const pick = (p: Prod) => { setSel(p); setTm({ ptr: p.wholesale ? String(p.ptrPaise / 100) : "", pts: p.ptsPaise ? String(p.ptsPaise / 100) : "", companyId: p.companyId ?? "", min: String(p.minOrderQty), portal: p.portalVisible, discontinued: p.discontinued }); };
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <input className={input} placeholder={t("Search products")} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="text-sm divide-y divide-line max-h-80 overflow-auto">{rows.map((p) => (
          <li key={p.id}><button className="w-full text-left py-1.5 flex justify-between gap-2 cursor-pointer hover:bg-page px-1" onClick={() => pick(p)}><span>{p.name}{p.company ? ` · ${p.company}` : ""}{p.discontinued ? ` · ${t("discontinued")}` : ""}</span>
            <span className="text-muted">{p.wholesale ? `PTR ${inr(p.ptrPaise)}` : t("no wholesale rate")} · {t("{n} packs free", { n: p.freePacks })}</span></button></li>
        ))}</ul>
      </div>
      {sel && <div className={`${card} max-w-2xl`}>
        <div className="font-semibold">{t("Wholesale terms · {name}", { name: sel.name })}</div>
        <div className="grid grid-cols-3 gap-2">
          <label className={label}>PTR (₹)<input className={input} value={tm.ptr} onChange={(e) => setTm({ ...tm, ptr: e.target.value })} /></label>
          <label className={label}>PTS (₹)<input className={input} value={tm.pts} onChange={(e) => setTm({ ...tm, pts: e.target.value })} /></label>
          <label className={label}>{t("Minimum order (packs)")}<input className={input} value={tm.min} onChange={(e) => setTm({ ...tm, min: e.target.value.replace(/\D/g, "") })} /></label>
          <label className={label}>{t("Company")}<select className={input} value={tm.companyId} onChange={(e) => setTm({ ...tm, companyId: e.target.value })}><option value="">—</option>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <div className="flex gap-4 text-sm"><label className="flex gap-1.5 items-center"><input type="checkbox" checked={tm.portal} onChange={(e) => setTm({ ...tm, portal: e.target.checked })} /> {t("Show on the chemist portal")}</label>
          <label className="flex gap-1.5 items-center"><input type="checkbox" checked={tm.discontinued} onChange={(e) => setTm({ ...tm, discontinued: e.target.checked })} /> {t("Discontinued")}</label></div>
        <Button variant="primary" className="self-start" onClick={() => run(() => dev.call("saveDistProduct", { medicineId: sel.id, companyId: tm.companyId || null, ptrPaise: toPaise(tm.ptr), ptsPaise: toPaise(tm.pts), minOrderQty: Number(tm.min) || 1, portalVisible: tm.portal, discontinued: tm.discontinued }), t("Terms saved."))}>{t("Save terms")}</Button>
      </div>}
      <div className={`${card} max-w-2xl`}>
        <div className="font-semibold">{t("New product")}</div>
        <div className="grid grid-cols-5 gap-2">
          <input className={`${input} col-span-2`} placeholder={t("Name")} value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} />
          <input className={input} placeholder={t("MRP (₹)")} value={nm.mrp} onChange={(e) => setNm({ ...nm, mrp: e.target.value })} />
          <input className={input} placeholder={t("Units per pack")} value={nm.pack} onChange={(e) => setNm({ ...nm, pack: e.target.value.replace(/\D/g, "") })} />
          <select className={input} value={nm.gst} onChange={(e) => setNm({ ...nm, gst: e.target.value })} aria-label="GST">{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>GST {g}%</option>)}</select>
        </div>
        <Button className="self-start" onClick={() => run(async () => { await dev.call("addMedicine", { name: nm.name, gstRate: Number(nm.gst) as 12, mrpPaise: toPaise(nm.mrp), packSize: Number(nm.pack) || 1, hsn: nm.hsn }); setNm({ name: "", gst: "12", mrp: "", pack: "1", hsn: "3004" }); }, t("Product added. Set its wholesale terms."))}><Plus size={14} /> {t("Add product")}</Button>
      </div>
      <div className={`${card} max-w-2xl`}>
        <div className="font-semibold">{t("Companies")}</div>
        <div className="text-sm">{cos.map((c) => c.name).join(", ") || t("None yet.")}</div>
        <div className="flex gap-2"><input className={input} placeholder={t("Company name")} value={coName} onChange={(e) => setCoName(e.target.value)} />
          <Button onClick={() => run(async () => { await dev.call("saveDistCompany", null, { name: coName }); setCoName(""); }, t("Company added."))}>{t("Add")}</Button></div>
      </div>
      <Principals cos={cos} />
      <Schemes cos={cos} products={rows} />
    </div>
  );
}

function Principals({ cos }: { cos: { id: string; name: string }[] }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [sups, setSups] = useState<{ id: string; name: string }[]>([]);
  const [p, setP] = useState({ companyId: "", supplierId: "", before: "90", after: "180", pct: "100" });
  useEffect(() => { dev.call("supplierList").then((r) => setSups((r as { id: string; name: string }[]).map((s) => ({ id: s.id, name: s.name }))), () => setSups([])); }, [dev]);
  const save = async () => { try { await dev.call("distSavePrincipal", { companyId: p.companyId, supplierId: p.supplierId || null, claimBeforeDays: Number(p.before) || 0, claimAfterDays: Number(p.after) || 0, claimCreditPct: Number(p.pct) || 0 }); toast(t("Principal saved."), "green"); } catch (e) { toast(errText(e), "red"); } };
  return (
    <div className={`${card} max-w-2xl`}>
      <div className="font-semibold">{t("Principals (claim terms with each company)")}</div>
      <div className="grid grid-cols-5 gap-2 text-sm">
        <select className={input} value={p.companyId} onChange={(e) => setP({ ...p, companyId: e.target.value })} aria-label={t("Company")}><option value="">{t("Company")}</option>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className={input} value={p.supplierId} onChange={(e) => setP({ ...p, supplierId: e.target.value })} aria-label={t("Claim from supplier")}><option value="">{t("Claim from supplier")}</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input className={input} title={t("Days before expiry")} value={p.before} onChange={(e) => setP({ ...p, before: e.target.value })} aria-label={t("Days before expiry")} />
        <input className={input} title={t("Days after expiry")} value={p.after} onChange={(e) => setP({ ...p, after: e.target.value })} aria-label={t("Days after expiry")} />
        <input className={input} title={t("Credit %")} value={p.pct} onChange={(e) => setP({ ...p, pct: e.target.value })} aria-label={t("Credit %")} />
      </div>
      <Button className="self-start" disabled={!p.companyId} onClick={save}>{t("Save principal")}</Button>
    </div>
  );
}

function Schemes({ cos, products }: { cos: { id: string; name: string }[]; products: { id: string; name: string }[] }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [rows, setRows] = useState<{ id: string; code: string; name: string; kind: string; target: string | null; buyQty: number; freeQty: number; discPct: number; validTo: string; active: boolean }[]>([]);
  // India's date, as billing uses (todayISO); a new scheme runs for 30 days unless changed.
  const today = todayISO();
  const [s, setS] = useState({ code: "", kind: "free" as "free" | "discount", target: "", buy: "10", free: "1", disc: "", from: today, to: addDays(today, 30) });
  const load = useCallback(() => dev.call("distSchemes").then(setRows, () => setRows([])), [dev]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    const [kind, id] = s.target.split(":");
    try {
      await dev.call("saveDistScheme", { code: s.code, name: s.kind === "free" ? `${s.buy}+${s.free}` : `${s.disc}% off`, kind: s.kind, medicineId: kind === "m" ? id : null, companyId: kind === "c" ? id : null, buyQty: Number(s.buy) || 0, freeQty: Number(s.free) || 0, discPct: Number(s.disc) || 0, validFrom: s.from, validTo: s.to });
      toast(t("Scheme saved."), "green"); void load();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className={card}>
      <div className="font-semibold">{t("Schemes")}</div>
      <div className="grid grid-cols-4 gap-2 text-sm">
        <input className={input} placeholder={t("Code")} value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} />
        <select className={input} value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value as "free" })} aria-label={t("Kind")}><option value="free">{t("Free goods (buy X get Y)")}</option><option value="discount">{t("Extra discount %")}</option></select>
        <select className={`${input} col-span-2`} value={s.target} onChange={(e) => setS({ ...s, target: e.target.value })} aria-label={t("For")}><option value="">{t("For a product or a company")}</option>
          {cos.map((c) => <option key={c.id} value={`c:${c.id}`}>{t("All of {name}", { name: c.name })}</option>)}{products.map((p) => <option key={p.id} value={`m:${p.id}`}>{p.name}</option>)}</select>
        {s.kind === "free" ? <><input className={input} placeholder={t("Buy")} value={s.buy} onChange={(e) => setS({ ...s, buy: e.target.value })} /><input className={input} placeholder={t("Free")} value={s.free} onChange={(e) => setS({ ...s, free: e.target.value })} /></>
          : <input className={`${input} col-span-2`} placeholder={t("Discount %")} value={s.disc} onChange={(e) => setS({ ...s, disc: e.target.value })} />}
        <input type="date" className={input} value={s.from} onChange={(e) => setS({ ...s, from: e.target.value })} aria-label={t("From")} />
        <input type="date" className={input} value={s.to} onChange={(e) => setS({ ...s, to: e.target.value })} aria-label={t("To")} />
      </div>
      <Button className="self-start" disabled={!s.code || !s.target} onClick={save}>{t("Save scheme")}</Button>
      <ul className="text-sm divide-y divide-line">{rows.map((r) => (
        <li key={r.id} className="py-1.5 flex justify-between gap-2 items-center"><span><b>{r.code}</b> · {r.name} · {r.target ?? "—"} · {t("till {date}", { date: r.validTo })}{!r.active ? ` · ${t("ended")}` : ""}</span>
          {r.active && <Button size="sm" onClick={async () => { try { await dev.call("endDistScheme", r.id); void load(); } catch (e) { toast(errText(e), "red"); } }}>{t("End")}</Button>}</li>
      ))}</ul>
    </div>
  );
}

type Exp = { batchId: string; medicine: string; batchNo: string; expiry: string; daysLeft: number; onShelf: number; returned: number; value: number; eligible: boolean; why: string; expectedCredit: number };

/** Stock close to expiry (on the shelf and returned by chemists), and claims on the company. */
export function ExpiryClaims({ cfg, who }: { cfg: Cfg; who: Who }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [rows, setRows] = useState<Exp[]>([]);
  const load = useCallback(() => dev.call("distExpiry", cfg.branchId, 180).then((r) => setRows(r as Exp[]), () => setRows([])), [dev, cfg.branchId]);
  useEffect(() => { void load(); }, [load]);
  const claim = async (r: Exp) => {
    const qty = prompt(t("Packs to claim from batch {no}", { no: r.batchNo }), String(Math.floor(r.onShelf + r.returned)));
    if (!qty) return;
    try { const c = await dev.call("distRaiseClaim", { branchId: cfg.branchId, batchId: r.batchId, userId: who.userId, qty: Number(qty) || 0, reason: r.daysLeft <= 0 ? "expiry" : "near_expiry" }); toast(t("Claim {no} raised: {value} (expect {credit}).", { no: c.claimNo, value: inr(c.value), credit: inr(c.expected) }), "green"); void load(); }
    catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className={card}>
      <div className="font-semibold">{t("Expiry & claims")}</div>
      <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th>{t("Product")}</th><th>{t("Batch")}</th><th className="text-right">{t("Days left")}</th><th className="text-right">{t("On shelf")}</th><th className="text-right">{t("Returned")}</th><th className="text-right">{t("Value")}</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.batchId} className="border-t border-line"><td>{r.medicine}</td><td>{r.batchNo} · {r.expiry}</td><td className="text-right">{r.daysLeft}</td><td className="text-right">{r.onShelf}</td><td className="text-right">{r.returned}</td><td className="text-right">{inr(r.value)}</td>
            <td className="text-right">{r.eligible ? <Button size="sm" onClick={() => claim(r)}>{t("Claim")}</Button> : <span className="text-muted text-[12px]">{t(r.why)}</span>}</td></tr>
        ))}{!rows.length && <tr><td colSpan={7} className="py-3 text-muted">{t("Nothing expires within 180 days.")}</td></tr>}</tbody></table>
    </div>
  );
}

/** The distributor's own rules on this device: shelf life, credit, and what the chemist portal shows. */
export function DistSettingsCard() {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [s, setS] = useState<{ minShelfDays: number; creditMode: "hold" | "block"; portal: { enabled: boolean; discoverable: boolean; stock: "exact" | "band" | "none"; showSchemes: boolean; showMrp: boolean; minOrderPaise: number; serviceArea: string } } | null>(null);
  useEffect(() => { dev.call("distSettings").then((r) => setS(r as never), () => setS(null)); }, [dev]);
  if (!s) return null;
  const save = async () => { try { setS((await dev.call("saveDistSettings", { minShelfDays: s.minShelfDays, creditMode: s.creditMode, portal: s.portal })) as never); toast(t("Settings saved."), "green"); } catch (e) { toast(errText(e), "red"); } };
  return (
    <div className={`${card} max-w-lg`}>
      <div className="font-semibold">{t("Distribution rules")}</div>
      <label className={label}>{t("Shortest shelf life sent to chemists (days)")}<input className={input} value={s.minShelfDays} onChange={(e) => setS({ ...s, minShelfDays: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
      <label className={label}>{t("Over credit")}<select className={input} value={s.creditMode} onChange={(e) => setS({ ...s, creditMode: e.target.value as "hold" })}><option value="hold">{t("Hold for a manager to release")}</option><option value="block">{t("Refuse")}</option></select></label>
      <div className="font-medium text-sm mt-1">{t("Chemist portal")}</div>
      <label className="flex gap-1.5 items-center text-sm"><input type="checkbox" checked={s.portal.enabled} onChange={(e) => setS({ ...s, portal: { ...s.portal, enabled: e.target.checked } })} /> {t("Take orders on the portal")}</label>
      <label className="flex gap-1.5 items-center text-sm"><input type="checkbox" checked={s.portal.showSchemes} onChange={(e) => setS({ ...s, portal: { ...s.portal, showSchemes: e.target.checked } })} /> {t("Show schemes")}</label>
      <label className="flex gap-1.5 items-center text-sm"><input type="checkbox" checked={s.portal.showMrp} onChange={(e) => setS({ ...s, portal: { ...s.portal, showMrp: e.target.checked } })} /> {t("Show MRP")}</label>
      <label className={label}>{t("Stock shown to chemists")}<select className={input} value={s.portal.stock} onChange={(e) => setS({ ...s, portal: { ...s.portal, stock: e.target.value as "band" } })}><option value="band">{t("In stock / Low / Out")}</option><option value="exact">{t("Exact packs")}</option><option value="none">{t("Nothing")}</option></select></label>
      <Button variant="primary" className="self-start" onClick={save}>{t("Save")}</Button>
    </div>
  );
}
