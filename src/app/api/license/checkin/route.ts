import { LICENCE_HEADER, SIGNATURE_HEADER } from "@/lib/licence";
import { authenticate, checkin } from "@/staff/licence";
import { licenceApi } from "../handler";

export const dynamic = "force-dynamic";

/** Daily check-in: usage counts and queued requests in, a signed licence document out. */
export async function POST(req: Request) {
  return licenceApi(req, async (body) => {
    const c = await authenticate(req.headers.get(LICENCE_HEADER), req.headers.get(SIGNATURE_HEADER), body);
    return checkin(c, JSON.parse(body));
  });
}
