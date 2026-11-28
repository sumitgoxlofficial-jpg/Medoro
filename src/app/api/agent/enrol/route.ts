import { enrolDevice } from "@/staff/hrms/workforce";
import { agentApi, json } from "../handler";

export const dynamic = "force-dynamic";

/** A one-time code from HR in, this device's token out (shown once). */
export async function POST(req: Request) {
  return agentApi(req, async ({ ip, body }) => json(await enrolDevice(body, ip)), { device: false });
}
