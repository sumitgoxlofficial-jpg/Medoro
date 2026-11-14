import { ToastProvider } from "@/components/ui/toast";
import { AuthShell } from "@/components/auth-shell";
import { getT } from "@/server/lang";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  // Lines and points reuse the homepage's text, so they already read in Hindi.
  const lines = ["Bill faster.", "Waste less stock.", "Close GST on time."].map((l) => t(l));
  const points: [string, string][] = ([["GST", "MRP-inclusive, CGST, SGST and IGST"], ["FEFO", "Earliest expiry sells first"], ["Offline", "Billing on the shop network"], ["हिंदी", "Full Hindi interface"]] as const).map(([a, b]) => [t(a), t(b)]);
  return (
    <ToastProvider>
      {/* Before sign-in there is no header, so the language is picked in the shell. */}
      <AuthShell lines={lines} points={points}>{children}</AuthShell>
    </ToastProvider>
  );
}
