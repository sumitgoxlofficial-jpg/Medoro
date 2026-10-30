import { clientIp } from "@/server/auth";
import { register } from "@/staff/licence";
import { licenceApi } from "../handler";

export const dynamic = "force-dynamic";

/** A new pharmacy installation starts its trial and receives its licence id and instance token. */
export async function POST(req: Request) {
  return licenceApi(req, (body) => register(JSON.parse(body), clientIp(req.headers)));
}
