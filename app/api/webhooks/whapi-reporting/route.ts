import { timingSafeEqual } from "node:crypto";
import { commandConfig } from "@/lib/management-report/commands/config";
import { incomingReportCommands } from "@/lib/management-report/commands/model";
import { executeReportCommand } from "@/lib/management-report/commands/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_BYTES = 64 * 1024;
const response = (status: number) => new Response(status === 200 ? "OK" : "Request rejected", {
  status, headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
});

async function readBoundedJson(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES || !request.body) throw new Error("Invalid body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Invalid body"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function POST(request: Request) {
  const config = commandConfig();
  // A disabled hook acknowledges without reading the body, DB or calling Whapi.
  if (!config.ready) return response(200);
  const expected = Buffer.from(`Bearer ${config.secret}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return response(401);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    || request.headers.has("content-encoding")) return response(415);
  let payload: unknown;
  try { payload = await readBoundedJson(request); } catch { return response(400); }
  const commands = incomingReportCommands(payload, new Date());
  let unavailable = false;
  for (const command of commands) {
    try { await executeReportCommand(command); }
    catch {
      // No request/header/body/error details in runtime logs. Retried callbacks
      // remain safe because already-reserved IDs can never reserve another send.
      console.error("DEKEZ reporting command could not be processed");
      unavailable = true;
    }
  }
  return response(unavailable ? 503 : 200);
}
