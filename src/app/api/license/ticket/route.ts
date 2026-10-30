import { z } from "zod";
import { LICENCE_HEADER, SIGNATURE_HEADER } from "@/lib/licence";
import { authenticate, processRequests } from "@/staff/licence";
import { licenceApi } from "../handler";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().uuid(), kind: z.enum(["ticket", "ticket_reply"]), payload: z.record(z.string(), z.unknown()), createdBy: z.string().max(80).default("") });

/** A support ticket (or a reply) from the pharmacy's Help screen, delivered right away. */
export async function POST(req: Request) {
  return licenceApi(req, async (body) => {
    const c = await authenticate(req.headers.get(LICENCE_HEADER), req.headers.get(SIGNATURE_HEADER), body);
    const [result] = await processRequests(c, [schema.parse(JSON.parse(body))]);
    return result;
  });
}
