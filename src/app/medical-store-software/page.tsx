import { LandingPage, landingMetadata } from "@/components/site/landing";

export const metadata = landingMetadata("medical-store-software");

export default function Page() {
  return <LandingPage slug="medical-store-software" />;
}
