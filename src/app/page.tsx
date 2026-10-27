import { redirect } from "next/navigation";
import { isSetupDone } from "@/domain/identity/service";

export const dynamic = "force-dynamic";

// The marketing site will live here; until then send people to the right place.
export default async function Home() {
  redirect((await isSetupDone()) ? "/app" : "/setup");
}
