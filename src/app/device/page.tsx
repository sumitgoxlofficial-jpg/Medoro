import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/toast";
import { OfflineDevice } from "./offline-device";

export const metadata: Metadata = { title: "Counter (Drive mode)", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Drive mode counter without signing in: works offline. The service worker keeps a copy of this page; all data
 * comes from the device's own database and the counter PIN set by the owner unlocks it.
 */
export default function Page() {
  return (
    <ToastProvider>
      <OfflineDevice />
    </ToastProvider>
  );
}
