import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = { title: "Medoro HRMS", robots: { index: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ToastProvider><div style={{ fontFamily: "Inter, system-ui, sans-serif" }} className="min-h-screen bg-[#F8FAFC] text-[#0f172a]">{children}</div></ToastProvider>;
}
