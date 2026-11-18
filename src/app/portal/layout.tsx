import type { Metadata } from "next";
export const metadata: Metadata = { title: { default: "MEDORO Chemist Portal", template: "%s · MEDORO Chemist Portal" }, robots: { index: false } };
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#F4F6F9] text-[#0B2545]">{children}</div>;
}
