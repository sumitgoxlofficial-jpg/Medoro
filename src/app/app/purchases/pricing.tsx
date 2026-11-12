"use client";
import { useState, useTransition } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import type { GstBase, PricingRules } from "@/domain/purchasing/pricing";
import { useT } from "@/lib/i18n-client";
import { savePricingRulesAction } from "./pricing-actions";

const BASES: [GstBase, string, string][] = [
  ["net", "After all discounts on the bill (recommended)", "GST law values a supply net of discounts shown on the invoice (CGST Act s.15(3)(a)). Most distributor software bills this way."],
  ["before_cd", "Before cash discount", "For distributors who treat cash discount as a settlement discount and charge GST before it."],
  ["gross", "On PTR × paid quantity", "For distributors who print GST on the undiscounted PTR value."],
];

export function PricingRulesButton({ rules }: { rules: PricingRules }) {
  const t = useT();
  const toastR = useActionToast();
  const [open, setOpen] = useState(false), [r, setR] = useState(rules), [pending, start] = useTransition();
  const save = () => start(async () => { if (toastR(await savePricingRulesAction(r))) setOpen(false); });
  return (
    <>
      <Button className="max-sm:flex-1" onClick={() => { setR(rules); setOpen(true); }}><Settings2 size={15} />{t("Pricing rules")}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Purchase pricing rules" sub="How GRNs work out GST and landed cost" width={560}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Save rules</Button></>}>
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">{t("Minimum shelf life when receiving stock")}</div>
          <label className="flex items-center gap-2 text-[13px]"><input type="number" min={0} max={730} className="border border-line rounded-lg px-2.5 py-1.5 w-24 bg-white" value={r.minShelfDays} onChange={(e) => setR({ ...r, minShelfDays: Math.max(0, Math.min(730, parseInt(e.target.value) || 0)) })} aria-label={t("Minimum shelf life in days")} />{t("days (0 turns the check off). Lines with less shelf life need “I accept short-dated stock” before the bill can be posted.")}</label>
          <div className="text-[13px] font-semibold">{t("GST on purchase lines is worked out")}</div>
          {BASES.map(([v, label, hint]) => (
            <label key={v} className="flex gap-2 items-start cursor-pointer text-[13px]">
              <input type="radio" className="mt-1 accent-teal" checked={r.gstBase === v} onChange={() => setR({ ...r, gstBase: v })} />
              <span><span className="font-medium">{t(label)}</span><br /><span className="text-faint text-[12px]">{t(hint)}</span></span>
            </label>
          ))}
          <div className="text-[12px] text-faint">{t("Free goods under a scheme (“10+2”) are part of the same supply: no GST on them, and their cost is spread over all units received.")}</div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">{t("Input GST")}</div>
          <label className="flex gap-2 items-start cursor-pointer text-[13px]"><input type="radio" className="mt-1 accent-teal" checked={r.itc} onChange={() => setR({ ...r, itc: true })} /><span><span className="font-medium">{t("Claimed as input tax credit")}</span><br /><span className="text-faint text-[12px]">{t("Regular GST registration: GST goes to Input CGST/SGST/IGST, stock is valued without it.")}</span></span></label>
          <label className="flex gap-2 items-start cursor-pointer text-[13px]"><input type="radio" className="mt-1 accent-teal" checked={!r.itc} onChange={() => setR({ ...r, itc: false })} /><span><span className="font-medium">{t("Not claimable (composition scheme)")}</span><br /><span className="text-faint text-[12px]">{t("GST is part of the purchase cost and of each batch’s landed cost.")}</span></span></label>
        </div>
        <div className="text-[12px] text-faint">{t("Changes apply to GRNs posted from now on. Each GRN keeps the rules it was posted with.")}</div>
      </Modal>
    </>
  );
}
