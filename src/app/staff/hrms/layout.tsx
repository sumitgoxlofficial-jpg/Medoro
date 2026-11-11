import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = { title: "Medoro HRMS", robots: { index: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ToastProvider><style>{`@media print{body *{visibility:hidden !important}.print-area,.print-area *{visibility:visible !important}.print-area{position:fixed !important;left:0;top:0;width:100% !important;border:0 !important}}`}</style><div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "radial-gradient(1200px 600px at 85% -10%,rgba(20,184,166,.10),transparent 60%),radial-gradient(900px 500px at -10% 110%,rgba(11,94,91,.08),transparent 60%),linear-gradient(rgba(248,250,252,.97),rgba(248,250,252,.97)),#F8FAFC" }} className="min-h-screen text-[#0f172a]">{children}</div></ToastProvider>;
}
