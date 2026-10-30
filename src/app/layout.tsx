import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { SwRegister } from "@/components/sw-register";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-sans-devanagari/400.css";
import "@fontsource/ibm-plex-sans-devanagari/500.css";
import "@fontsource/ibm-plex-sans-devanagari/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://medoro.in"),
  title: { default: "Medoro", template: "%s · Medoro" },
  description: "Smarter Pharmacy. Simpler Business. Pharmacy management for Indian medical stores.",
  icons: { icon: "/medoro-mark.png", apple: "/icons/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Medoro", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#0B5E5B" };

// Reading the request headers renders every page per request, so Next.js can stamp the CSP nonce
// from middleware.ts on its scripts (a prerendered page would carry no nonce and be blocked).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  return (
    <html lang="en">
      <body>{children}<SwRegister /></body>
    </html>
  );
}
