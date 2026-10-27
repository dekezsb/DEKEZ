import { timingSafeEqual } from "node:crypto";
import { runRentalCollections } from "@/lib/rental-collection/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const headers = {"Cache-Control": "private, no-store"};
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return Response.json({error: "Unauthorized."}, {status: 401, headers});
  try {
    // No query/body overrides of company, tenant, original date or recipient.
    const result = await runRentalCollections();
    return Response.json(result, {status: ["uncertain", "rejected", "incomplete"].includes(result.state) ? 503 : 200, headers});
  } catch {
    return Response.json({error: "Collection review needs Admin attention. Check private history before retrying."}, {status: 503, headers});
  }
}
