"use client";
import { useT } from "@/lib/i18n-client";
import { Btn } from "./forms";
export function PrintButton({ label = "Print" }: { label?: string }) {
  const t = useT();
  return <Btn onClick={() => window.print()}>{t(label)}</Btn>;
}
