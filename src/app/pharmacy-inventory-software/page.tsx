import { LandingPage, landingMetadata } from "@/components/site/landing";

export const metadata = landingMetadata("pharmacy-inventory-software");

export default function Page() {
  return <LandingPage slug="pharmacy-inventory-software" />;
}
