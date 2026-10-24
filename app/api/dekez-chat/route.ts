import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatCommand, chatError, chatQuery, type ChatCommand } from "@/lib/chat/requests";

export const dynamic = "force-dynamic";
const respond = (data: unknown, status = 200) => NextResponse.json(data, {
  status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" },
});

async function execute(command: ChatCommand | null) {
  // Deliberately off until migration, account scope and integration tests are approved.
  if (process.env.DEKEZ_CHAT_ENABLED !== "true") return respond({ error: "DEKEZ Chat is not enabled yet." }, 503);
  if (!command) return respond({ error: "Invalid chat request." }, 400);
  try {
    const client = await createClient();
    const { data: session, error: authError } = await client.auth.getUser();
    if (authError || !session.user) return respond({ error: "Please sign in again." }, 401);
    // End-user JWT, never service-role credentials. RPC and RLS independently
    // enforce membership, current role, job state and selected support evidence.
    const { data, error } = await client.rpc(command.rpc, command.args);
    if (error) { const safe = chatError(error.code); return respond({ error: safe.message }, safe.status); }
    // Keep one application shape for singleton composite RPC responses.
    const singleton = command.rpc === "dekez_chat_send" || command.rpc === "dekez_chat_file_send" || command.rpc === "dekez_chat_evidence";
    return respond({ data: singleton && Array.isArray(data) ? data[0] ?? null : data });
  } catch {
    return respond({ error: "Unable to connect to chat. Please retry." }, 503);
  }
}

export async function GET(request: Request) {
  return execute(chatQuery(new URL(request.url).searchParams));
}

export async function POST(request: Request) {
  // Cookie-authenticated writes are same-origin only, including audited reads.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return respond({ error: "Request origin is not allowed." }, 403);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json"))
    return respond({ error: "Send a JSON request." }, 415);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 65536) return respond({ error: "Request is too large." }, 413);
  try {
    // Bound streamed/chunked bodies too; Content-Length is not trusted.
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: "Request body is required." }, 400);
    const parts: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); return respond({ error: "Request is too large." }, 413); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return execute(chatCommand(JSON.parse(new TextDecoder().decode(bytes))));
  } catch { return respond({ error: "Invalid chat request." }, 400); }
}
