import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneNumber } from "@/lib/whatsapp/config";
import { sendWhatsAppText } from "@/lib/whatsapp/meta";

function baseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "https://dekez.vercel.app";
}

export type AgreementWhatsAppResult = {
  status: "sent" | "failed" | "missing" | "invalid";
};

export async function sendAgreementRequest(
  supabase: SupabaseClient,
  agreementId: string,
  options: {
    rejectionReason?: string;
    resign?: boolean;
    renewalOnly?: boolean;
  } = {},
): Promise<AgreementWhatsAppResult> {
  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .select(
      "id, tenancy_id, term_type, agreement_type, status, signed_at, term_start_date, term_end_date, tenancies(status, checkout_date, tenant_id, tenants(id, profile_id, full_name, phone))",
    )
    .eq("id", agreementId)
    .maybeSingle();
  const tenancy = Array.isArray(agreement?.tenancies)
    ? agreement.tenancies[0]
    : agreement?.tenancies;
  const tenant = Array.isArray(tenancy?.tenants)
    ? tenancy.tenants[0]
    : tenancy?.tenants;

  if (
    !agreement ||
    !tenancy ||
    agreement.signed_at ||
    ["signed", "renewal_signed"].includes(String(agreement.status)) ||
    tenancy.status !== "active" ||
    tenancy.checkout_date ||
    (options.renewalOnly && agreement.term_type !== "renewal")
  ) {
    return { status: "invalid" };
  }

  const isRenewal = agreement.term_type === "renewal";
  if (isRenewal && !options.resign) {
    const { data: approvedDecision } = await supabase
      .from("tenancy_renewals")
      .select("id")
      .eq("new_agreement_id", agreement.id)
      .eq("decision_status", "renew")
      .limit(1)
      .maybeSingle();
    if (!approvedDecision) {
      return { status: "invalid" };
    }
  }
  const notificationType = options.resign
    ? "signature_resign_request"
    : isRenewal
      ? "renewal_signature_request"
      : "signature_request";

  const normalizedPhone = normalizePhoneNumber(tenant?.phone);
  if (!tenant?.phone || normalizedPhone.length < 8) {
    await supabase.from("agreement_notifications").insert({
      tenancy_id: agreement.tenancy_id,
      agreement_id: agreement.id,
      notification_type: notificationType,
      status: "missing_phone",
    });
    return { status: "missing" };
  }

  const agreementUrl = `${baseUrl()}/e-tenancy/${agreement.id}`;
  const message = [
    `Hello ${tenant.full_name ?? "Tenant"},`,
    options.resign
      ? "Admin could not approve your previous signed tenancy agreement. A replacement copy is ready and must be signed again."
      : isRenewal
        ? "Reminder: your DEKEZ tenancy renewal agreement is waiting for your signature."
        : "Your DEKEZ tenancy agreement is ready for review and signature.",
    options.resign && options.rejectionReason
      ? `Reason: ${options.rejectionReason}`
      : "",
    agreement.term_start_date && agreement.term_end_date
      ? `Term: ${agreement.term_start_date} to ${agreement.term_end_date}.`
      : "",
    options.resign
      ? `Review and sign the replacement here: ${agreementUrl}`
      : `Open and sign here: ${agreementUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const now = new Date().toISOString();
  const { data: conversation } = await supabase
    .from("whatsapp_conversations")
    .upsert(
      {
        tenant_id: tenant.profile_id ?? null,
        phone_number: tenant.phone,
        normalized_phone: normalizedPhone,
        last_message_at: now,
        updated_at: now,
      },
      { onConflict: "normalized_phone" },
    )
    .select("id")
    .single();

  let providerMessageId: string | null = null;
  let sendStatus: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;

  try {
    const response = await sendWhatsAppText(normalizedPhone, message);
    providerMessageId = response.messages?.[0]?.id ?? null;
  } catch (error) {
    sendStatus = "failed";
    errorMessage =
      error instanceof Error ? error.message : "WhatsApp send failed";
  }

  await supabase.from("whatsapp_messages").insert({
    conversation_id: conversation?.id ?? null,
    tenant_id: tenant.profile_id ?? null,
    phone_number: tenant.phone,
    normalized_phone: normalizedPhone,
    direction: "outgoing",
    meta_message_id: providerMessageId,
    message_type: "text",
    message_text: message,
    processing_status: sendStatus,
    error_message: errorMessage,
  });

  await supabase.from("agreement_notifications").insert({
    tenancy_id: agreement.tenancy_id,
    agreement_id: agreement.id,
    notification_type: notificationType,
    status: sendStatus,
    sent_at: sendStatus === "sent" ? now : null,
  });

  if (sendStatus === "sent" && isRenewal) {
    await supabase
      .from("tenancy_agreements")
      .update({ status: "renewal_sent", updated_at: now })
      .eq("id", agreement.id)
      .is("signed_at", null);
  }

  return { status: sendStatus };
}
