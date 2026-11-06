import { body, growthApi } from "@/staff/growth/api";
import { sendMessage } from "@/staff/growth/comms";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => growthApi(req, "messages.send", async (a) => sendMessage(a, await body(req) as never));
