import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAssistantBatch } from "@/lib/chat/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const secret = process.env.CRON_SECRET, supplied = request.headers.get("authorization") ?? "", expected = `Bearer ${secret ?? ""}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  if (process.env.DEKEZ_CHAT_ENABLED !== "true" || process.env.DEKEZ_CHAT_ASSISTANT_ENABLED !== "true") return Response.json({ disabled: true }, { headers });
  try {
    const result = await runAssistantBatch(createAdminClient());
    if ("failed" in result && result.failed) console.error("DEKEZ Assistant batch requires attention", { failed: result.failed });
    return Response.json(result, { headers });
  } catch {
    console.error("DEKEZ Assistant processing unavailable");
    return Response.json({ error: "Assistant processing unavailable. Safe to retry." }, { status: 503, headers });
  }
}
