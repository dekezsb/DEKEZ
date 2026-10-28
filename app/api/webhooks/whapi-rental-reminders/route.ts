import { timingSafeEqual } from "node:crypto";
import { collectionEvents } from "@/lib/rental-collection/contact-events";
import { collectionIntakeConfig, recordCollectionEvent } from "@/lib/rental-collection/contact-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_BYTES = 64 * 1024;
const reply = (status: number) => new Response(status === 200 ? "OK" : "Request rejected", {
  status, headers: {"Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8"},
});

// Suppression/receipts only. There is deliberately no outbound messaging import.
// Independent callback preserves the existing management command allowlist.
export async function POST(request: Request) {
  const config = collectionIntakeConfig();
  if (!config.ready) return reply(503);
  const supplied = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${config.secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || request.headers.has("content-encoding")) return reply(415);
  if (!request.body || Number(request.headers.get("content-length")) > MAX_BYTES) return reply(413);
  const reader = request.body.getReader();
  let payload: unknown;
  try {
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); return reply(413); }
      chunks.push(part.value);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return reply(400); } finally { reader.releaseLock(); }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const envelope = payload as Record<string, unknown>;
    if ([envelope.messages, envelope.statuses].some(batch => Array.isArray(batch) && batch.length > 50)) return reply(413);
  }
  try {
    for (const event of collectionEvents(payload)) await recordCollectionEvent(event);
  } catch {
    console.error("DEKEZ payment reminder intake unavailable");
    return reply(503); // provider retries are deduplicated; no payload/secret logs
  }
  return reply(200);
}
