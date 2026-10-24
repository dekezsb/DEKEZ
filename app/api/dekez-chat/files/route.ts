import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHAT_BUCKET, boundedBytes, validateChatFile, validId } from "@/lib/chat/files";
import { chatError } from "@/lib/chat/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
const rpcFailure = (code?: string) => { const safe = chatError(code); return fail(safe.message, safe.status); };

/** Binary uploads and downloads are same-origin POSTs; no reusable signed URLs. */
export async function POST(request: Request) {
  if (process.env.DEKEZ_CHAT_ENABLED !== "true" || process.env.DEKEZ_CHAT_FILES_ENABLED !== "true") return fail("Chat attachments are not enabled yet.", 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Request origin is not allowed.", 403);
  try {
    const client = await createClient();
    const { data: session, error } = await client.auth.getUser();
    if (error || !session.user) return fail("Please sign in again.", 401);
    const action = request.headers.get("x-chat-action");
    if (action === "upload") {
      const conversation = request.headers.get("x-chat-conversation"), key = request.headers.get("x-chat-key");
      if (!validId(conversation) || !validId(key)) return fail("Invalid upload request.", 400);
      // Authorize before accepting/decoding a potentially expensive file.
      const access = await client.rpc("dekez_chat_detail", { p_conversation: conversation });
      if (access.error) return rpcFailure(access.error.code);
      if (access.data?.[0]?.status !== "active") return fail("This conversation is closed.", 403);
      let file;
      try { file = await validateChatFile(await boundedBytes(request), decodeURIComponent(request.headers.get("x-chat-name") ?? "attachment")); }
      catch { return fail("Use a valid JPG, PNG, WebP or PDF up to 3 MB (PDF: 1–100 pages).", 400); }
      const reserved = await client.rpc("dekez_chat_file_reserve", { p_conversation: conversation, p_key: key, p_digest: file.digest, p_name: file.name, p_mime: file.mime, p_size: file.bytes.length });
      if (reserved.error) return rpcFailure(reserved.error.code);
      const reservation = reserved.data as { id: string; object_key: string; ready: boolean };
      if (!reservation.ready) {
        // Server credential is used only AFTER the session-scoped reservation.
        const admin = createAdminClient(), bucket = admin.storage.from(CHAT_BUCKET);
        const uploaded = await bucket.upload(reservation.object_key, file.bytes, { contentType: file.mime, upsert: false, cacheControl: "0" });
        if (uploaded.error) {
          // Recover a lost response without overwriting any existing file.
          const existing = await bucket.download(reservation.object_key);
          if (existing.error || !existing.data || createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex") !== file.digest) return fail("Upload failed. Your message is still unsent; please retry.", 503);
        }
        const attested = await admin.rpc("dekez_chat_file_uploaded", { p_upload: reservation.id, p_digest: file.digest });
        if (attested.error) return fail("Unable to finish the upload. Please retry.", 503);
      }
      return NextResponse.json({ data: { uploadId: reservation.id, fileName: file.name } }, { headers });
    }
    if (action !== "view" && action !== "download") return fail("Invalid file action.", 400);
    const attachment = request.headers.get("x-chat-attachment"), caseId = request.headers.get("x-chat-case");
    const reason = decodeURIComponent(request.headers.get("x-chat-reason") ?? "");
    if (!validId(attachment) || caseId !== null && !validId(caseId) || reason.length > 1000) return fail("Invalid file request.", 400);
    const args = { p_attachment: attachment, p_case: caseId, p_reason: reason || null, p_intent: action };
    const access = await client.rpc("dekez_chat_file_access", args);
    if (access.error) return rpcFailure(access.error.code);
    const file = access.data as { object_key: string; file_name: string; mime_type: string; byte_size: number };
    const download = await createAdminClient().storage.from(CHAT_BUCKET).download(file.object_key);
    if (download.error || !download.data) return fail("File is temporarily unavailable. Please retry.", 503);
    // Recheck after storage I/O: closing a case while it downloads revokes delivery.
    const delivery = await client.rpc("dekez_chat_file_access", args);
    if (delivery.error) return rpcFailure(delivery.error.code);
    return new Response(download.data, { headers: { ...headers, "Content-Type": file.mime_type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch { return fail("Unable to connect to secure files. Please retry.", 503); }
}
