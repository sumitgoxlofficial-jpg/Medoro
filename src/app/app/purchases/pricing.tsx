"use client";
import { useState, useTransition } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import type { GstBase, PricingRules } from "@/domain/purchasing/pricing";
import { savePricingRulesAction } from "./pricing-actions";

const BASES: [GstBase, string, string][] = [
  ["net", "After all discounts on the bill (recommended)", "GST law values a supply net of discounts shown on the invoice (CGST Act s.15(3)(a)). Most distributor software bills this way."],
  ["before_cd", "Before cash discount", "For distributors who treat cash discount as a settlement discount and charge GST before it."],
  ["gross", "On PTR × paid quantity", "For distributors who print GST on the undiscounted PTR value."],
];

export function PricingRulesButton({ rules }: { rules: PricingRules }) {
  const toastR = useActionToast();
  const [open, setOpen] = useState(false), [r, setR] = useState(rules), [pending, start] = useTransition();
  const save = () => start(async () => { if (toastR(await savePricingRulesAction(r))) setOpen(false); });
  return (
    <>
      <Button className="max-sm:flex-1" onClick={() => { setR(rules); setOpen(true); }}><Settings2 size={15} />Pricing rules</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Purchase pricing rules" sub="How GRNs work out GST and landed cost" width={560}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Save rules</Button></>}>
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">GST on purchase lines is worked out</div>
          {BASES.map(([v, label, hint]) => (
            <label key={v} className="flex gap-2 items-start cursor-pointer text-[13px]">
              <input type="radio" className="mt-1 accent-teal" checked={r.gstBase === v} onChange={() => setR({ ...r, gstBase: v })} />
              <span><span className="font-medium">{label}</span><br /><span className="text-faint text-[12px]">{hint}</span></span>
            </label>
          ))}
          <div className="text-[12px] text-faint">Free goods under a scheme (“10+2”) are part of the same supply: no GST on them, and their cost is spread over all units received.</div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">Input GST</div>
          <label className="flex gap-2 items-start cursor-pointer text-[13px]"><input type="radio" className="mt-1 accent-teal" checked={r.itc} onChange={() => setR({ ...r, itc: true })} /><span><span className="font-medium">Claimed as input tax credit</span><br /><span className="text-faint text-[12px]">Regular GST registration: GST goes to Input CGST/SGST/IGST, stock is valued without it.</span></span></label>
          <label className="flex gap-2 items-start cursor-pointer text-[13px]"><input type="radio" className="mt-1 accent-teal" checked={!r.itc} onChange={() => setR({ ...r, itc: false })} /><span><span className="font-medium">Not claimable (composition scheme)</span><br /><span className="text-faint text-[12px]">GST is part of the purchase cost and of each batch’s landed cost.</span></span></label>
        </div>
        <div className="text-[12px] text-faint">Changes apply to GRNs posted from now on. Each GRN keeps the rules it was posted with.</div>
      </Modal>
    </>
  );
}
