"use client";
import { Pill, dayLabel, inputCls } from "./kit";

/** A document's expiry date: edit it in place; a badge shows when it has expired or expires within 30 days. */
export function ExpiryCell({ x, disabled, onSave }: { x: { expiresOn: string | null; expiry: string }; disabled?: boolean; onSave: (v: string | null) => void }) {
  return <div className="flex items-center gap-1.5 flex-wrap">
    <input aria-label="Expires on" className={inputCls + " !w-[150px] !py-1 !text-[12.5px]"} type="date" defaultValue={x.expiresOn ?? ""} disabled={disabled}
      onBlur={(e) => { const v = e.target.value || null; if (v !== x.expiresOn) onSave(v); }} />
    {x.expiry === "expired" ? <Pill tone="red">Expired</Pill> : x.expiry === "soon" && x.expiresOn ? <Pill tone="amber">{dayLabel(x.expiresOn)}</Pill> : null}
  </div>;
}
