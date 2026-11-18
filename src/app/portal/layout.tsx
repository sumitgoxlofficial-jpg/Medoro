import type { Metadata } from "next";
export const metadata: Metadata = { title: { default: "MEDORO Chemist Portal", template: "%s · MEDORO Chemist Portal" }, robots: { index: false } };
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-page text-teal">{children}</div>;
}
