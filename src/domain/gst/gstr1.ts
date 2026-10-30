import { B2CL_THRESHOLD_PAISE, hsnRows, hsnSplitFrom, rs, dmy, type GstDoc, type GstLine } from "./common";

// GSTR-1 in the GSTN offline-tool / API JSON shape. Field names follow the published schema
// (developer.gst.gov.in, Returns → GSTR-1; offline tool GST3.2.x).

type ItmDet = { txval: number; rt: number; iamt?: number; camt?: number; samt?: number; csamt: number };
type Itm = { num: number; itm_det: ItmDet };

export type Gstr1 = {
  gstin: string; fp: string; version: string; hash: string;
  b2b?: { ctin: string; inv: { inum: string; idt: string; val: number; pos: string; rchrg: "N"; inv_typ: "R"; itms: Itm[] }[] }[];
  b2cl?: { pos: string; inv: { inum: string; idt: string; val: number; itms: Itm[] }[] }[];
  b2cs?: ({ sply_ty: "INTER" | "INTRA"; rt: number; typ: "OE"; pos: string; txval: number; csamt: number } & Partial<Record<"iamt" | "camt" | "samt", number>>)[];
  nil?: { inv: { sply_ty: "INTRB2B" | "INTRAB2B" | "INTRB2C" | "INTRAB2C"; expt_amt: number; nil_amt: number; ngsup_amt: number }[] };
  cdnr?: { ctin: string; nt: { ntty: "C"; nt_num: string; nt_dt: string; val: number; pos: string; rchrg: "N"; inv_typ: "R"; itms: Itm[] }[] }[];
  cdnur?: { typ: "B2CL"; ntty: "C"; nt_num: string; nt_dt: string; val: number; pos: string; itms: Itm[] }[];
  hsn?: { hsn_b2b?: HsnEntry[]; hsn_b2c?: HsnEntry[]; data?: HsnEntry[] };
  doc_issue?: { doc_det: { doc_num: number; docs: { num: number; from: string; to: string; totnum: number; cancel: number; net_issue: number }[] }[] };
};
type HsnEntry = { num: number; hsn_sc: string; desc?: string; uqc: string; qty: number; rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number };

const taxed = (lines: GstLine[]) => lines.filter((l) => l.rate > 0);

/** Item rows per rate. Intra-state rows carry CGST/SGST, inter-state rows IGST only (as the schema expects). */
function itms(lines: GstLine[], inter: boolean, igstOnly = false): Itm[] {
  const by = new Map<number, { txval: number; iamt: number; camt: number; samt: number }>();
  for (const l of taxed(lines)) {
    const r = by.get(l.rate) ?? { txval: 0, iamt: 0, camt: 0, samt: 0 };
    r.txval += l.taxable; r.iamt += l.igst; r.camt += l.cgst; r.samt += l.sgst;
    by.set(l.rate, r);
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([rt, r], i) => ({
    num: i + 1,
    itm_det: inter || igstOnly ? { txval: rs(r.txval), rt, iamt: rs(r.iamt), csamt: 0 } : { txval: rs(r.txval), rt, camt: rs(r.camt), samt: rs(r.samt), csamt: 0 },
  }));
}

export const isB2cl = (d: { ctin: string | null; inter: boolean; value: number }, threshold: number) => !d.ctin && d.inter && d.value > threshold;

/** Invoice and credit-note number ranges (Table 13). Invoice series count gaps as cancelled; `cancelled` are numbers withdrawn after issue. */
export function docIssue(docs: GstDoc[], cancelled: string[]): Gstr1["doc_issue"] {
  const out: NonNullable<Gstr1["doc_issue"]>["doc_det"] = [];
  const parse = (no: string) => { const m = /^(.*?)(\d+)$/.exec(no); return m ? { series: m[1], n: Number(m[2]) } : { series: no, n: 0 }; };
  for (const [docNum, kind] of [[1, "inv"], [5, "cn"]] as const) {
    const nos = [...docs.filter((d) => d.kind === kind).map((d) => d.no), ...(kind === "inv" ? cancelled : [])];
    const series = new Map<string, string[]>();
    for (const no of nos) { const p = parse(no); series.set(p.series, [...(series.get(p.series) ?? []), no]); }
    const rows = [...series].sort((a, b) => a[0].localeCompare(b[0])).map(([, list], i) => {
      const sorted = list.sort((a, b) => parse(a).n - parse(b).n);
      const span = kind === "inv" ? parse(sorted[sorted.length - 1]).n - parse(sorted[0]).n + 1 : sorted.length;
      const issued = sorted.length - (kind === "inv" ? sorted.filter((n) => cancelled.includes(n)).length : 0);
      return { num: i + 1, from: sorted[0], to: sorted[sorted.length - 1], totnum: span, cancel: span - issued, net_issue: issued };
    });
    if (rows.length) out.push({ doc_num: docNum, docs: rows });
  }
  return out.length ? { doc_det: out } : undefined;
}

/**
 * Builds GSTR-1 for one GSTIN and return period from its invoices and credit notes.
 * B2B: buyer has a GSTIN. B2CL: inter-state, no GSTIN, value above the threshold. B2CS: the rest, totalled by
 * supply type, place of supply and rate, net of credit notes against them. Credit notes against B2B invoices go to
 * CDNR, against B2CL invoices to CDNUR. Nil-rated (0%) lines go to Table 8 only. HSN covers every line.
 */
export function buildGstr1(input: { gstin: string; fp: string; docs: GstDoc[]; cancelled?: string[]; threshold?: number }): Gstr1 {
  const { gstin, fp, docs } = input, threshold = input.threshold ?? B2CL_THRESHOLD_PAISE, home = gstin.slice(0, 2);
  const out: Gstr1 = { gstin, fp, version: "GST3.2.4", hash: "hash" };
  const inv = docs.filter((d) => d.kind === "inv"), cn = docs.filter((d) => d.kind === "cn");

  const b2b = new Map<string, NonNullable<Gstr1["b2b"]>[number]["inv"]>();
  const b2cl = new Map<string, NonNullable<Gstr1["b2cl"]>[number]["inv"]>();
  const b2cs = new Map<string, { sply_ty: "INTER" | "INTRA"; pos: string; rt: number; txval: number; iamt: number; camt: number; samt: number }>();
  const addB2cs = (d: { inter: boolean; pos: string }, lines: GstLine[], sign: number) => {
    for (const l of taxed(lines)) {
      const pos = d.inter ? d.pos : home, k = `${d.inter}|${pos}|${l.rate}`;
      const r = b2cs.get(k) ?? { sply_ty: d.inter ? "INTER" : "INTRA", pos, rt: l.rate, txval: 0, iamt: 0, camt: 0, samt: 0 };
      r.txval += sign * l.taxable; r.iamt += sign * l.igst; r.camt += sign * l.cgst; r.samt += sign * l.sgst;
      b2cs.set(k, r);
    }
  };
  const nil = new Map<string, number>();
  const addNil = (ctin: string | null, inter: boolean, lines: GstLine[], sign: number) => {
    const k = `${inter ? "INTR" : "INTRA"}${ctin ? "B2B" : "B2C"}`;
    for (const l of lines.filter((x) => x.rate === 0)) nil.set(k, (nil.get(k) ?? 0) + sign * l.taxable);
  };

  for (const d of inv) {
    addNil(d.ctin, d.inter, d.lines, 1);
    if (!taxed(d.lines).length) continue;
    if (d.ctin) b2b.set(d.ctin, [...(b2b.get(d.ctin) ?? []), { inum: d.no, idt: dmy(d.date), val: rs(d.value), pos: d.pos, rchrg: "N", inv_typ: "R", itms: itms(d.lines, d.inter) }]);
    else if (isB2cl(d, threshold)) b2cl.set(d.pos, [...(b2cl.get(d.pos) ?? []), { inum: d.no, idt: dmy(d.date), val: rs(d.value), itms: itms(d.lines, true, true) }]);
    else addB2cs(d, d.lines, 1);
  }

  const cdnr = new Map<string, NonNullable<Gstr1["cdnr"]>[number]["nt"]>();
  const cdnur: NonNullable<Gstr1["cdnur"]> = [];
  for (const d of cn) {
    const o = d.orig ?? { no: "", date: d.date, value: d.value, inter: d.inter, ctin: d.ctin };
    addNil(o.ctin, o.inter, d.lines, -1);
    if (!taxed(d.lines).length) continue;
    if (o.ctin) cdnr.set(o.ctin, [...(cdnr.get(o.ctin) ?? []), { ntty: "C", nt_num: d.no, nt_dt: dmy(d.date), val: rs(d.value), pos: d.pos, rchrg: "N", inv_typ: "R", itms: itms(d.lines, d.inter) }]);
    else if (isB2cl(o, threshold)) cdnur.push({ typ: "B2CL", ntty: "C", nt_num: d.no, nt_dt: dmy(d.date), val: rs(d.value), pos: d.pos, itms: itms(d.lines, true, true) });
    else addB2cs(d, d.lines, -1);
  }

  if (b2b.size) out.b2b = [...b2b].sort((a, b) => a[0].localeCompare(b[0])).map(([ctin, list]) => ({ ctin, inv: list }));
  if (b2cl.size) out.b2cl = [...b2cl].sort((a, b) => a[0].localeCompare(b[0])).map(([pos, list]) => ({ pos, inv: list }));
  if (b2cs.size) out.b2cs = [...b2cs.values()].sort((a, b) => a.sply_ty.localeCompare(b.sply_ty) || a.pos.localeCompare(b.pos) || a.rt - b.rt)
    .map((r) => ({ sply_ty: r.sply_ty, rt: r.rt, typ: "OE" as const, pos: r.pos, txval: rs(r.txval), ...(r.sply_ty === "INTER" ? { iamt: rs(r.iamt) } : { camt: rs(r.camt), samt: rs(r.samt) }), csamt: 0 }));
  if (nil.size) out.nil = { inv: (["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"] as const).filter((k) => nil.has(k)).map((k) => ({ sply_ty: k, expt_amt: 0, nil_amt: rs(nil.get(k)!), ngsup_amt: 0 })) };
  if (cdnr.size) out.cdnr = [...cdnr].sort((a, b) => a[0].localeCompare(b[0])).map(([ctin, nt]) => ({ ctin, nt }));
  if (cdnur.length) out.cdnur = cdnur;

  const hsn = hsnRows(docs);
  if (hsn.length) {
    const entry = (r: (typeof hsn)[number], i: number): HsnEntry => ({ num: i + 1, hsn_sc: r.hsn, ...(r.desc ? { desc: r.desc.slice(0, 30) } : {}), uqc: r.uqc, qty: r.qty, rt: r.rate, txval: rs(r.taxable), iamt: rs(r.igst), camt: rs(r.cgst), samt: rs(r.sgst), csamt: 0 });
    if (hsnSplitFrom(fp)) {
      const b = hsn.filter((r) => r.b2b).map(entry), c = hsn.filter((r) => !r.b2b).map(entry);
      out.hsn = { ...(b.length ? { hsn_b2b: b } : {}), ...(c.length ? { hsn_b2c: c } : {}) };
    } else out.hsn = { data: hsn.map(entry) };
  }
  const di = docIssue(docs, input.cancelled ?? []);
  if (di) out.doc_issue = di;
  return out;
}

/** Totals per section for the screen: documents (or rows), taxable value and tax, in rupees. */
export function gstr1Summary(g: Gstr1) {
  const rows = gstr1Csv(g);
  const start = rows.findIndex((r) => r[0] === "Section" && r[1] === "Documents/rows");
  const sections = rows.slice(start + 1).filter((r) => r.length === 6 && !String(r[0]).startsWith("Documents (13)")).map((r) => ({ section: String(r[0]), count: Number(r[1]), taxable: Number(r[2]), igst: Number(r[3]), cgst: Number(r[4]), sgst: Number(r[5]) }));
  const hsn = [...(g.hsn?.hsn_b2b ?? []), ...(g.hsn?.hsn_b2c ?? []), ...(g.hsn?.data ?? [])];
  return { sections, hsnRows: hsn.length, docs: (g.doc_issue?.doc_det ?? []).flatMap((d) => d.docs.map((x) => ({ kind: d.doc_num === 1 ? "Invoices" : "Credit notes", ...x }))) };
}
/** Human-readable companion to the JSON: section totals, then every document and B2CS row. */
export function gstr1Csv(g: Gstr1): (string | number)[][] {
  const n = (x: number | undefined) => (x ?? 0).toFixed(2);
  const sum = (items: Itm[]) => items.reduce((a, i) => ({ tx: a.tx + i.itm_det.txval, i: a.i + (i.itm_det.iamt ?? 0), c: a.c + (i.itm_det.camt ?? 0), s: a.s + (i.itm_det.samt ?? 0) }), { tx: 0, i: 0, c: 0, s: 0 });
  const rows: (string | number)[][] = [["Section", "Party GSTIN / place of supply", "Document", "Date", "Value", "Taxable", "IGST", "CGST", "SGST", "Cess"]];
  const total: Record<string, { count: number; tx: number; i: number; c: number; s: number }> = {};
  const add = (sec: string, party: string, no: string, dt: string, val: number | string, t: { tx: number; i: number; c: number; s: number }) => {
    rows.push([sec, party, no, dt, typeof val === "number" ? n(val) : val, n(t.tx), n(t.i), n(t.c), n(t.s), "0.00"]);
    const x = (total[sec] ??= { count: 0, tx: 0, i: 0, c: 0, s: 0 });
    x.count++; x.tx += t.tx; x.i += t.i; x.c += t.c; x.s += t.s;
  };
  for (const b of g.b2b ?? []) for (const v of b.inv) add("B2B (4A)", b.ctin, v.inum, v.idt, v.val, sum(v.itms));
  for (const b of g.b2cl ?? []) for (const v of b.inv) add("B2CL (5)", b.pos, v.inum, v.idt, v.val, sum(v.itms));
  for (const r of g.b2cs ?? []) add("B2CS (7)", `${r.sply_ty} ${r.pos}`, `${r.rt}%`, "", "", { tx: r.txval, i: r.iamt ?? 0, c: r.camt ?? 0, s: r.samt ?? 0 });
  for (const r of g.nil?.inv ?? []) add("Nil rated (8)", r.sply_ty, "", "", "", { tx: r.nil_amt, i: 0, c: 0, s: 0 });
  for (const b of g.cdnr ?? []) for (const v of b.nt) add("CDNR (9B)", b.ctin, v.nt_num, v.nt_dt, v.val, sum(v.itms));
  for (const v of g.cdnur ?? []) add("CDNUR (9B)", v.pos, v.nt_num, v.nt_dt, v.val, sum(v.itms));
  const summary: (string | number)[][] = [["GSTR-1", g.gstin, `Period ${g.fp.slice(0, 2)}/${g.fp.slice(2)}`], [], ["Section", "Documents/rows", "Taxable", "IGST", "CGST", "SGST"],
    ...Object.entries(total).map(([k, t]) => [k, t.count, n(t.tx), n(t.i), n(t.c), n(t.s)])];
  for (const d of g.doc_issue?.doc_det ?? []) for (const x of d.docs) summary.push([`Documents (13) · ${d.doc_num === 1 ? "Invoices" : "Credit notes"}`, `${x.from} – ${x.to}`, `issued ${x.totnum}`, `cancelled ${x.cancel}`, `net ${x.net_issue}`]);
  return [...summary, [], ...rows];
}
