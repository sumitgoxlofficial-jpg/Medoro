import type { Metadata } from "next";
import { OfflinePos } from "./offline-pos";

export const metadata: Metadata = { title: "Offline billing" };
export const dynamic = "force-static";

/** Static page the service worker keeps on the device; all data comes from the device's own storage. */
export default function Page() {
  return <OfflinePos />;
}
