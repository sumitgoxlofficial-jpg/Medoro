"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { cancelPortalOrderAction } from "./actions";
export function PCancel({ code, orderId }: { code: string; orderId: string }) {
  const t = useT();
  const router = useRouter();
  const [p, start] = useTransition();
  return <button disabled={p} className="text-[#B3261E]" onClick={() => { if (!window.confirm(t("Cancel this order?"))) return; start(async () => { const r = await cancelPortalOrderAction(code, orderId); if (!r.ok) window.alert(t(r.error)); router.refresh(); }); }}>{t("Cancel")}</button>;
}
