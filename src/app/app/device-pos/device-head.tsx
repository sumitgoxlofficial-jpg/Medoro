"use client";
import { useSearchParams } from "next/navigation";
import { PageHead } from "@/components/page-head";

/** The page heading, except on the Dashboard tab, which shows its own (title, date, period and Export). */
export function DeviceHead({ sub }: { sub: string }) {
  if (useSearchParams().get("tab") === "dash") return null;
  return <PageHead title="Billing on this device" sub={sub} />;
}
