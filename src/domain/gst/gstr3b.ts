import { rs, type GstDoc } from "./common";

// GSTR-3B in the GSTN offline-utility / API JSON shape (sup_details, inter_sup, itc_elg, inward_sup).

type Tax = { iamt: number; camt: number; samt: number; csamt: number };
export type Itc = { igst: number; cgst: number; sgst: number; revIgst: number; revCgst: number; revSgst: number };

export type Gstr3b = {
  gstin: string; ret_period: string;
  sup_details: { osup_det: Tax & { txval: number }; osup_zero: { txval: number; iamt: number; csamt: number }; osup_nil_exmp: { txval: number }; isup_rev: Tax & { txval: number }; osup_nongst: { txval: number } };
  inter_sup: { unreg_details: { pos: string; txval: number; iamt: number }[]; comp_details: never[]; uin_details: never[] };
  itc_elg: { itc_avl: ({ ty: "IMPG" | "IMPS" | "ISRC" | "ISD" | "OTH" } & Tax)[]; itc_rev: ({ ty: "RUL" | "OTH" } & Tax)[]; itc_net: Tax; itc_inelg: ({ ty: "RUL" | "OTH" } & Tax)[] };
  inward_sup: { isup_details: { ty: "GST" | "NONGST"; inter: number; intra: number }[] };
};

const zero = (): Tax => ({ iamt: 0, camt: 0, samt: 0, csamt: 0 });

/**
 * 3.1(a) outward taxable supplies and 3.1(c) nil-rated, net of credit notes; 3.2 inter-state supplies to
 * unregistered persons by place of supply; 4(A)(5) ITC from the input tax ledgers (purchases less debit notes)
 * and 4(B)(2) other reversals posted to them.
 */
export function buildGstr3b(input: { gstin: string; fp: string; docs: GstDoc[]; itc: Itc }): Gstr3b {
  const out = { txval: 0, iamt: 0, camt: 0, samt: 0 }, nilTx = { v: 0 };
  const unreg = new Map<string, { txval: number; iamt: number }>();
  for (const d of input.docs) {
    const sign = d.kind === "cn" ? -1 : 1, ctin = d.kind === "cn" ? d.orig?.ctin ?? d.ctin : d.ctin;
    for (const l of d.lines) {
      if (l.rate === 0) { nilTx.v += sign * l.taxable; continue; }
      out.txval += sign * l.taxable; out.iamt += sign * l.igst; out.camt += sign * l.cgst; out.samt += sign * l.sgst;
      if (d.inter && !ctin) {
        const u = unreg.get(d.pos) ?? { txval: 0, iamt: 0 };
        u.txval += sign * l.taxable; u.iamt += sign * l.igst; unreg.set(d.pos, u);
      }
    }
  }
  const i = input.itc;
  const avl = { iamt: rs(i.igst), camt: rs(i.cgst), samt: rs(i.sgst), csamt: 0 }, rev = { iamt: rs(i.revIgst), camt: rs(i.revCgst), samt: rs(i.revSgst), csamt: 0 };
  return {
    gstin: input.gstin, ret_period: input.fp,
    sup_details: {
      osup_det: { txval: rs(out.txval), iamt: rs(out.iamt), camt: rs(out.camt), samt: rs(out.samt), csamt: 0 },
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: rs(nilTx.v) },
      isup_rev: { txval: 0, ...zero() },
      osup_nongst: { txval: 0 },
    },
    inter_sup: { unreg_details: [...unreg].sort((a, b) => a[0].localeCompare(b[0])).map(([pos, u]) => ({ pos, txval: rs(u.txval), iamt: rs(u.iamt) })), comp_details: [], uin_details: [] },
    itc_elg: {
      itc_avl: [{ ty: "IMPG", ...zero() }, { ty: "IMPS", ...zero() }, { ty: "ISRC", ...zero() }, { ty: "ISD", ...zero() }, { ty: "OTH", ...avl }],
      itc_rev: [{ ty: "RUL", ...zero() }, { ty: "OTH", ...rev }],
      itc_net: { iamt: rs(i.igst - i.revIgst), camt: rs(i.cgst - i.revCgst), samt: rs(i.sgst - i.revSgst), csamt: 0 },
      itc_inelg: [{ ty: "RUL", ...zero() }, { ty: "OTH", ...zero() }],
    },
    inward_sup: { isup_details: [{ ty: "GST", inter: 0, intra: 0 }, { ty: "NONGST", inter: 0, intra: 0 }] },
  };
}

export function gstr3bRows(g: Gstr3b): (string | number)[][] {
  const n = (x: number) => x.toFixed(2), s = g.sup_details, oth = g.itc_elg.itc_avl.find((x) => x.ty === "OTH")!, rev = g.itc_elg.itc_rev.find((x) => x.ty === "OTH")!;
  return [
    ["GSTR-3B", g.gstin, `Period ${g.ret_period.slice(0, 2)}/${g.ret_period.slice(2)}`],
    [],
    ["Table", "Description", "Taxable value", "IGST", "CGST", "SGST", "Cess"],
    ["3.1(a)", "Outward taxable supplies (other than zero rated, nil rated and exempted)", n(s.osup_det.txval), n(s.osup_det.iamt), n(s.osup_det.camt), n(s.osup_det.samt), n(s.osup_det.csamt)],
    ["3.1(b)", "Outward taxable supplies (zero rated)", n(0), n(0), "", "", n(0)],
    ["3.1(c)", "Other outward supplies (nil rated, exempted)", n(s.osup_nil_exmp.txval), "", "", "", ""],
    ["3.1(d)", "Inward supplies (liable to reverse charge)", n(0), n(0), n(0), n(0), n(0)],
    ["3.1(e)", "Non-GST outward supplies", n(s.osup_nongst.txval), "", "", "", ""],
    ...g.inter_sup.unreg_details.map((u) => ["3.2", `Inter-state supplies to unregistered persons · place of supply ${u.pos}`, n(u.txval), n(u.iamt), "", "", ""]),
    ["4(A)(5)", "All other ITC", "", n(oth.iamt), n(oth.camt), n(oth.samt), n(oth.csamt)],
    ["4(B)(2)", "ITC reversed (others)", "", n(rev.iamt), n(rev.camt), n(rev.samt), n(rev.csamt)],
    ["4(C)", "Net ITC available", "", n(g.itc_elg.itc_net.iamt), n(g.itc_elg.itc_net.camt), n(g.itc_elg.itc_net.samt), n(g.itc_elg.itc_net.csamt)],
  ];
}
