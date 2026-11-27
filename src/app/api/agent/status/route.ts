import { agentStatus } from "@/staff/hrms/workforce";
import { agentApi, json } from "../handler";

export const dynamic = "force-dynamic";

/** Whether the agent may record right now, and the message its tray shows. */
export async function GET(req: Request) {
  return agentApi(req, async ({ device, ip }) => json(await agentStatus(device!, ip)));
}
