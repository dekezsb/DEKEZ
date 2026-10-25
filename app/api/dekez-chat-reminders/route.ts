import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

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
  if (process.env.DEKEZ_CHAT_ENABLED !== "true" || process.env.DEKEZ_CHAT_REMINDERS_ENABLED !== "true") {
    return Response.json({ disabled: true }, { headers });
  }
  // Preview is safe by default, including cron calls. Enabling sends requires a
  // separately approved deployment setting AND the database control switch.
  const preview = new URL(request.url).searchParams.get("preview") === "true"
    || process.env.DEKEZ_CHAT_REMINDERS_SEND !== "true";
  try {
    const { data, error } = await createAdminClient().rpc("dekez_chat_reminders", { p_preview: preview });
    if (error) throw new Error("Reminder worker request failed.");
    if (data?.failed > 0) console.error("DEKEZ chat reminder batch requires attention", { failed: data.failed });
    return Response.json(data, { headers });
  } catch {
    // Never log invoice contents, tenant identities, tokens or raw database errors.
    console.error("DEKEZ chat reminder worker failed; no success assumed.");
    return Response.json({ error: "Reminder processing failed. Safe to retry." }, { status: 503, headers });
  }
}
