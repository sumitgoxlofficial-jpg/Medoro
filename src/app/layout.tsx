import type { Metadata } from "next";
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
  title: { default: "Medoro", template: "%s · Medoro" },
  description: "Smarter Pharmacy. Simpler Business. Pharmacy management for Indian medical stores.",
  icons: { icon: "/medoro-mark.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
