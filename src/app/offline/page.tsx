import type { Metadata } from "next";
import { OfflinePos } from "./offline-pos";

export const metadata: Metadata = { title: "Offline billing" };
export const dynamic = "force-dynamic";

/** Rendered per request (CSP nonce); the service worker keeps a copy on the device. All data comes from the device's own storage. */
export default function Page() {
  return <OfflinePos />;
}
