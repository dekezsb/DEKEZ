import { timingSafeEqual } from "node:crypto";
import { deliverManagementReport } from "@/lib/management-report/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    // Caller cannot override company, recipient, date, body or delivery mode.
    const result = await deliverManagementReport("daily");
    return Response.json(result, { status: ["uncertain", "rejected"].includes(result.state) ? 503 : 200, headers });
  } catch {
    console.error("DEKEZ management report processing failed; inspect private delivery state before retrying.");
    return Response.json({ error: "Report unavailable. Review delivery state before retrying." }, { status: 503, headers });
  }
}
