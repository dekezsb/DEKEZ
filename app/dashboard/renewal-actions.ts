"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { formatMalaysiaDate } from "@/lib/date-format";
import { addDays, calculateTermEndDate } from "@/lib/e-tenancy";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  prepareNextRenewalAgreement,
  renewalDurationMonths,
} from "@/lib/tenancy/agreement";
import { sendAgreementRequest } from "@/lib/tenancy/agreement-whatsapp";
import { normalizePhoneNumber } from "@/lib/whatsapp/config";
import { sendWhatsAppText } from "@/lib/whatsapp/meta";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(new Date());
}

function resultPath(result: string) {
  return `/dashboard?renewalResult=${result}#dashboard-renewals`;
}

async function requireRenewalAdmin() {
  await requireRole(["super_admin", "admin"], {
    module: "tenancy_agreements",
    level: "manage",
  });
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

async function requireRenewalFollowUp() {
  await requireRole(["super_admin", "admin"], {
    module: "tenancy_agreements",
    level: "view",
  });
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

async function loadRenewalContext(
  supabase: SupabaseClient,
  tenancyId: string,
) {
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select(
      "id, monthly_rental, tenancy_end_date, contract_end, status, checkout_date, billing_status, tenants(id, profile_id, full_name, phone), properties(name, is_commercial), rooms!tenancies_room_id_fkey(name, room_number)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  const tenant = Array.isArray(tenancy?.tenants)
    ? tenancy.tenants[0]
    : tenancy?.tenants;
  const property = Array.isArray(tenancy?.properties)
    ? tenancy.properties[0]
    : tenancy?.properties;
  const room = Array.isArray(tenancy?.rooms)
    ? tenancy.rooms[0]
    : tenancy?.rooms;
  const contractEndDate = tenancy?.tenancy_end_date ?? tenancy?.contract_end;

  if (
    !tenancy ||
    !contractEndDate ||
    tenancy.status !== "active" ||
    tenancy.checkout_date ||
    ["terminated", "completed"].includes(tenancy.billing_status ?? "") ||
    contractEndDate > addDays(malaysiaToday(), 60)
  ) {
    return null;
  }

  return { tenancy, tenant, property, room, contractEndDate };
}

async function decisionRow(
  supabase: SupabaseClient,
  context: NonNullable<Awaited<ReturnType<typeof loadRenewalContext>>>,
  userId: string,
) {
  const startDate = addDays(context.contractEndDate, 1);
  const duration = renewalDurationMonths(
    context.property?.is_commercial ?? false,
  );
  const endDate = calculateTermEndDate(startDate, duration);
  const { data: existing } = await supabase
    .from("tenancy_renewals")
    .select("id, decision_status, new_agreement_id, new_end_date")
    .eq("tenancy_id", context.tenancy.id)
    .eq("new_start_date", startDate)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("tenancy_renewals")
    .insert({
      tenancy_id: context.tenancy.id,
      selected_duration_months: duration,
      renewal_status: "decision_pending",
      decision_status: "pending",
      new_start_date: startDate,
      new_end_date: endDate,
      created_by: userId,
    })
    .select("id, decision_status, new_agreement_id, new_end_date")
    .single();

  if (!created || error) {
    const { data: raced } = await supabase
      .from("tenancy_renewals")
      .select("id, decision_status, new_agreement_id, new_end_date")
      .eq("tenancy_id", context.tenancy.id)
      .eq("new_start_date", startDate)
      .maybeSingle();
    if (raced) return raced;
    throw new Error(error?.message ?? "Renewal decision could not be created.");
  }
  return created;
}

function revalidateRenewals(agreementId?: string | null) {
  revalidatePath("/dashboard");
  revalidatePath("/tenancy-agreements");
  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  if (agreementId) revalidatePath(`/e-tenancy/${agreementId}`);
}

export async function sendRenewalDecisionRequest(formData: FormData) {
  const user = await requireRenewalAdmin();
  const tenancyId = textValue(formData, "tenancyId");
  if (!tenancyId) redirect(resultPath("missing"));

  const supabase = createAdminClient();
  const context = await loadRenewalContext(supabase, tenancyId);
  if (!context) redirect(resultPath("missing"));
  const renewal = await decisionRow(supabase, context, user.id);
  const normalizedPhone = normalizePhoneNumber(context.tenant?.phone);
  const now = new Date().toISOString();

  if (!context.tenant?.phone || normalizedPhone.length < 8) {
    await supabase.from("agreement_notifications").insert({
      tenancy_id: context.tenancy.id,
      agreement_id: null,
      notification_type: "renewal_decision_request",
      status: "missing_phone",
    });
    redirect(resultPath("missing_phone"));
  }

  const message = [
    `Hello ${context.tenant.full_name ?? "Tenant"},`,
    `Your tenancy for ${context.property?.name ?? "your DEKEZ property"} - ${context.room?.room_number ?? context.room?.name ?? "room"} ends on ${formatMalaysiaDate(context.contractEndDate)}.`,
    "Please let us know whether you want to renew for the next term.",
    "Reply YES to renew or NO if you will not renew. A renewal agreement will only be prepared after your confirmation.",
  ].join("\n");

  const { data: conversation } = await supabase
    .from("whatsapp_conversations")
    .upsert(
      {
        tenant_id: context.tenant.profile_id ?? null,
        phone_number: context.tenant.phone,
        normalized_phone: normalizedPhone,
        last_message_at: now,
        updated_at: now,
      },
      { onConflict: "normalized_phone" },
    )
    .select("id")
    .single();

  let providerMessageId: string | null = null;
  let status: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;
  try {
    const response = await sendWhatsAppText(normalizedPhone, message);
    providerMessageId = response.messages?.[0]?.id ?? null;
  } catch (error) {
    status = "failed";
    errorMessage =
      error instanceof Error ? error.message : "WhatsApp send failed";
  }

  await supabase.from("whatsapp_messages").insert({
    conversation_id: conversation?.id ?? null,
    tenant_id: context.tenant.profile_id ?? null,
    phone_number: context.tenant.phone,
    normalized_phone: normalizedPhone,
    direction: "outgoing",
    meta_message_id: providerMessageId,
    message_type: "text",
    message_text: message,
    processing_status: status,
    error_message: errorMessage,
  });
  await supabase.from("agreement_notifications").insert({
    tenancy_id: context.tenancy.id,
    agreement_id: null,
    notification_type: "renewal_decision_request",
    status,
    sent_at: status === "sent" ? now : null,
  });

  await supabase
    .from("tenancy_renewals")
    .update({
      renewal_status:
        status === "sent" ? "decision_requested" : "decision_request_failed",
      decision_status: status === "sent" ? "requested" : "pending",
      decision_requested_at: status === "sent" ? now : null,
      updated_at: now,
    })
    .eq("id", renewal.id);
  await supabase
    .from("tenancies")
    .update({
      renewal_status:
        status === "sent" ? "decision_requested" : "decision_request_failed",
      updated_at: now,
    })
    .eq("id", context.tenancy.id);

  revalidateRenewals();
  redirect(resultPath(status === "sent" ? "request_sent" : "send_failed"));
}

export async function recordRenewalDecision(formData: FormData) {
  const user = await requireRenewalFollowUp();
  const tenancyId = textValue(formData, "tenancyId");
  const decision = textValue(formData, "decision");
  const note = textValue(formData, "note");
  if (!tenancyId || !["renew", "not_renew"].includes(decision)) {
    redirect(resultPath("missing"));
  }

  const supabase = createAdminClient();
  const context = await loadRenewalContext(supabase, tenancyId);
  if (!context) redirect(resultPath("missing"));
  const renewal = await decisionRow(supabase, context, user.id);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("tenancy_renewals")
    .update({
      renewal_status:
        decision === "renew" ? "renewal_approved" : "not_renewing",
      decision_status: decision,
      decision_recorded_at: now,
      decision_recorded_by: user.id,
      decision_channel: "admin_recorded_tenant_reply",
      decision_note: note || null,
      updated_at: now,
    })
    .eq("id", renewal.id);
  if (error) redirect(resultPath("decision_failed"));

  await supabase
    .from("tenancies")
    .update({
      renewal_status:
        decision === "renew" ? "renewal_approved" : "not_renewing",
      updated_at: now,
    })
    .eq("id", context.tenancy.id);

  revalidateRenewals();
  redirect(
    resultPath(decision === "renew" ? "renew_confirmed" : "not_renewing"),
  );
}

export async function prepareConfirmedRenewal(formData: FormData) {
  const user = await requireRenewalAdmin();
  const tenancyId = textValue(formData, "tenancyId");
  const monthlyRent = Number(textValue(formData, "monthlyRent"));
  if (!tenancyId || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    redirect(resultPath("rent_missing"));
  }

  const supabase = createAdminClient();
  const context = await loadRenewalContext(supabase, tenancyId);
  if (!context) redirect(resultPath("missing"));
  const renewal = await decisionRow(supabase, context, user.id);
  if (renewal.decision_status !== "renew") {
    redirect(resultPath("decision_required"));
  }
  const nextStartDate = addDays(context.contractEndDate, 1);
  const nextEndDate =
    renewal.new_end_date ??
    calculateTermEndDate(
      nextStartDate,
      renewalDurationMonths(context.property?.is_commercial ?? false),
    );
  if (nextEndDate < malaysiaToday()) {
    redirect(resultPath("date_review"));
  }

  let agreementId: string | null = null;
  try {
    agreementId = await prepareNextRenewalAgreement(
      supabase,
      tenancyId,
      user.id,
      { monthlyRent },
    );
  } catch {
    redirect(resultPath("prepare_failed"));
  }
  if (!agreementId) redirect(resultPath("prepare_failed"));

  const result = await sendAgreementRequest(supabase, agreementId, {
    renewalOnly: true,
  });
  revalidateRenewals(agreementId);
  redirect(
    resultPath(result.status === "sent" ? "ta_sent" : "ta_prepared_send_failed"),
  );
}

export async function resendConfirmedRenewalAgreement(formData: FormData) {
  await requireRenewalAdmin();
  const agreementId = textValue(formData, "agreementId");
  if (!agreementId) redirect(resultPath("missing"));

  const result = await sendAgreementRequest(
    createAdminClient(),
    agreementId,
    { renewalOnly: true },
  );
  revalidateRenewals(agreementId);
  redirect(resultPath(result.status === "sent" ? "ta_sent" : "send_failed"));
}
