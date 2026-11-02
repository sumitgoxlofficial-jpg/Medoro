import { api } from "@/server/api";
import { providersView } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
/** Every connector with its real status: Available / Sandbox only / Partner onboarding required / Not yet supported. */
export const GET = api(async () => ({ providers: providersView() }));
