import { LandingPage, landingMetadata } from "@/components/site/landing";

export const metadata = landingMetadata("medical-billing-saas");

export default function Page() {
  return <LandingPage slug="medical-billing-saas" />;
}
