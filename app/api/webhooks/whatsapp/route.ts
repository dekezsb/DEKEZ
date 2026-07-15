import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { classifyTenantMessage, type WhatsAppIntent } from "@/lib/whatsapp/ai";
import { getWhatsAppConfig, normalizePhoneNumber } from "@/lib/whatsapp/config";
import { downloadWhatsAppMedia, sendWhatsAppText } from "@/lib/whatsapp/meta";
import {
  createMaintenanceTicketFromWhatsApp,
  findTenantByWhatsAppPhone,
  getMyBills,
  getMyContractExpiry,
  getMyMaintenanceTickets,
  getMyOutstandingRent,
  getMyPaymentHistory,
  getMyProfile,
  getMyRoom,
  getMyTenancyAgreement,
  type TenantIdentity,
} from "@/lib/whatsapp/tenant-tools";
import { createAdminClient } from "@/lib/supabase/admin";

type MetaMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
};

type MetaWebhookPayload = {
  entry?: {
    changes?: {
      value?: {
        messages?: MetaMessage[];
      };
    }[];
  }[];
};

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "https://dekez.vercel.app";
}

function verifySignature(rawBody: string, signatureHeader: string | null) {
  const { appSecret } = getWhatsAppConfig();

  if (!appSecret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

function extractMessages(payload: MetaWebhookPayload) {
  return (payload.entry ?? [])
    .flatMap((entry) => entry.changes ?? [])
    .flatMap((change) => change.value?.messages ?? []);
}

function getMessageText(message: MetaMessage) {
  if (message.type === "text") {
    return message.text?.body ?? "";
  }

  if (message.type === "image") {
    return message.image?.caption || "Tenant sent an image.";
  }

  if (message.type === "document") {
    return message.document?.caption || `Tenant sent a document${message.document?.filename ? `: ${message.document.filename}` : ""}.`;
  }

  return `Tenant sent a ${message.type ?? "message"}.`;
}

function getMedia(message: MetaMessage) {
  if (message.type === "image" && message.image?.id) {
    return {
      mediaId: message.image.id,
      mimeType: message.image.mime_type ?? null,
      extension: "jpg",
    };
  }

  if (message.type === "document" && message.document?.id) {
    return {
      mediaId: message.document.id,
      mimeType: message.document.mime_type ?? null,
      extension: message.document.filename?.split(".").pop() || "bin",
    };
  }

  return null;
}

async function createOrUpdateConversation(
  supabase: ReturnType<typeof createAdminClient>,
  phoneNumber: string,
  normalizedPhone: string,
  tenant: TenantIdentity | null,
) {
  const { data } = await supabase
    .from("whatsapp_conversations")
    .upsert({
      phone_number: phoneNumber,
      normalized_phone: normalizedPhone,
      tenant_id: tenant?.id ?? null,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "normalized_phone",
    })
    .select("id")
    .single();

  return data?.id ?? null;
}

async function logOutgoingMessage(
  supabase: ReturnType<typeof createAdminClient>,
  conversationId: string | null,
  tenant: TenantIdentity | null,
  to: string,
  text: string,
  metaMessageId?: string,
) {
  await supabase.from("whatsapp_messages").insert({
    conversation_id: conversationId,
    tenant_id: tenant?.id ?? null,
    phone_number: to,
    normalized_phone: normalizePhoneNumber(to),
    direction: "outgoing",
    meta_message_id: metaMessageId ?? null,
    message_type: "text",
    message_text: text,
    processing_status: "sent",
  });
}

async function reply(
  supabase: ReturnType<typeof createAdminClient>,
  conversationId: string | null,
  tenant: TenantIdentity | null,
  to: string,
  text: string,
) {
  const sent = await sendWhatsAppText(to, text);
  await logOutgoingMessage(supabase, conversationId, tenant, to, text, sent.messages?.[0]?.id);
}

async function runIntent(
  intent: WhatsAppIntent,
  supabase: ReturnType<typeof createAdminClient>,
  tenant: TenantIdentity,
  messageText: string,
  maintenanceDescription?: string,
  mediaPath?: string | null,
  mediaMimeType?: string | null,
) {
  switch (intent) {
    case "get_my_profile":
      return getMyProfile(supabase, tenant);
    case "get_my_room":
      return getMyRoom(supabase, tenant);
    case "get_my_outstanding_rent":
      return getMyOutstandingRent(supabase, tenant);
    case "get_my_bills":
      return getMyBills(supabase, tenant);
    case "get_my_payment_history":
      return getMyPaymentHistory(supabase, tenant);
    case "get_my_tenancy_agreement":
      return getMyTenancyAgreement(supabase, tenant);
    case "get_my_contract_expiry":
      return getMyContractExpiry(supabase, tenant);
    case "get_my_maintenance_tickets":
      return getMyMaintenanceTickets(supabase, tenant);
    case "create_maintenance_ticket":
      return createMaintenanceTicketFromWhatsApp(
        supabase,
        tenant,
        maintenanceDescription || messageText,
        mediaPath,
        mediaMimeType,
      );
    default:
      return {
        ok: true,
        message:
          "I can help with your rent balance, bills, payment history, contract end date, room details, and maintenance tickets. Please ask one of those.",
      };
  }
}

async function processMessage(message: MetaMessage, rawPayload: MetaWebhookPayload) {
  const supabase = createAdminClient();
  const normalizedPhone = normalizePhoneNumber(message.from);
  const tenant = await findTenantByWhatsAppPhone(supabase, message.from);
  const conversationId = await createOrUpdateConversation(supabase, message.from, normalizedPhone, tenant);
  const messageText = getMessageText(message);
  const metaTimestamp = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : null;

  const { data: existing } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("meta_message_id", message.id)
    .maybeSingle();

  if (existing) {
    return;
  }

  const media = getMedia(message);
  const { data: incomingLog } = await supabase
    .from("whatsapp_messages")
    .insert({
      conversation_id: conversationId,
      tenant_id: tenant?.id ?? null,
      phone_number: message.from,
      normalized_phone: normalizedPhone,
      direction: "incoming",
      meta_message_id: message.id,
      message_type: message.type ?? "unknown",
      message_text: messageText,
      media_id: media?.mediaId ?? null,
      media_mime_type: media?.mimeType ?? null,
      processing_status: "processing",
      meta_timestamp: metaTimestamp,
      raw_payload: rawPayload,
    })
    .select("id")
    .single();

  if (!tenant) {
    const loginLink = `${getBaseUrl()}/login/tenant-phone`;
    await reply(
      supabase,
      conversationId,
      null,
      message.from,
      `We could not find a DEKEZ tenant account linked to this WhatsApp number. Please register or login here: ${loginLink}`,
    );
    await supabase
      .from("whatsapp_messages")
      .update({ processing_status: "processed" })
      .eq("id", incomingLog?.id);
    return;
  }

  let mediaPath: string | null = null;
  let mediaMimeType: string | null = media?.mimeType ?? null;

  if (media) {
    try {
      const downloaded = await downloadWhatsAppMedia(media.mediaId);
      mediaMimeType = downloaded.mimeType;
      mediaPath = `${tenant.id}/${message.id}/media.${media.extension}`;
      await supabase.storage.from("whatsapp-media").upload(mediaPath, downloaded.bytes, {
        contentType: downloaded.mimeType,
        upsert: true,
      });
      await supabase
        .from("whatsapp_messages")
        .update({ media_file_path: mediaPath, media_mime_type: mediaMimeType })
        .eq("id", incomingLog?.id);
    } catch (error) {
      await supabase
        .from("whatsapp_messages")
        .update({ error_message: error instanceof Error ? error.message : "Media download failed" })
        .eq("id", incomingLog?.id);
    }
  }

  const classified = await classifyTenantMessage(messageText);
  const result = await runIntent(
    classified.intent,
    supabase,
    tenant,
    messageText,
    classified.maintenance_description,
    mediaPath,
    mediaMimeType,
  );

  await reply(supabase, conversationId, tenant, message.from, result.message);
  await supabase
    .from("whatsapp_messages")
    .update({ processing_status: result.ok ? "processed" : "failed", error_message: result.ok ? null : result.message })
    .eq("id", incomingLog?.id);
}

export async function GET(request: Request) {
  const config = getWhatsAppConfig();
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === config.verifyToken) {
    return new Response(challenge ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as MetaWebhookPayload;
    const messages = extractMessages(payload);

    for (const message of messages) {
      await processMessage(message, payload);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Webhook failed" },
      { status: 500 },
    );
  }
}
