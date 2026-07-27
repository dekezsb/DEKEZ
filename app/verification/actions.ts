"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import {
  addMonths,
  defaultAgreementTemplate,
  money,
  renderAgreementTemplate,
} from "@/lib/e-tenancy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizePhoneNumber } from "@/lib/whatsapp/config";
import { sendWhatsAppText } from "@/lib/whatsapp/meta";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function verificationPath(view: string, result: string) {
  return `/verification?view=${view}&${result}`;
}

function baseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "https://dekez.vercel.app";
}

function nextDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function adminClient() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export async function reviewOwnerRegistration(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const ownerId = textValue(formData, "ownerId");
  const decision = textValue(formData, "decision");
  const reason = textValue(formData, "reason");
  const propertyIds = formData
    .getAll("propertyIds")
    .filter((value): value is string => typeof value === "string" && Boolean(value));

  if (
    !user ||
    !ownerId ||
    !["approved", "rejected"].includes(decision) ||
    (decision === "approved" && !propertyIds.length) ||
    (decision === "rejected" && !reason)
  ) {
    redirect(verificationPath("owners", "error=owner_missing"));
  }

  const admin = await adminClient();
  const { data: owner } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", ownerId)
    .maybeSingle();

  if (!owner || owner.role !== "owner") {
    redirect(verificationPath("owners", "error=owner_missing"));
  }

  if (decision === "approved") {
    const { data: properties } = await admin
      .from("properties")
      .select("id, company_id")
      .in("id", propertyIds);

    if (!properties?.length || properties.length !== propertyIds.length) {
      redirect(verificationPath("owners", "error=property_missing"));
    }

    const sessionClient = await createClient();
    for (const property of properties) {
      const { error: membershipError } = await admin.from("company_users").upsert(
        {
          company_id: property.company_id,
          profile_id: owner.id,
          user_id: owner.id,
          role: "owner",
          status: "active",
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,profile_id" },
      );

      if (membershipError) {
        redirect(verificationPath("owners", "error=owner_assign"));
      }

      const { error: assignmentError } = await sessionClient.rpc("set_property_owner", {
        target_owner_id: owner.id,
        target_property_id: property.id,
      });

      if (assignmentError) {
        redirect(verificationPath("owners", "error=owner_assign"));
      }
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({
      registration_status: decision,
      registration_reviewed_by: user.id,
      registration_reviewed_at: new Date().toISOString(),
      registration_rejection_reason: decision === "rejected" ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", owner.id);

  if (error) {
    redirect(verificationPath("owners", "error=owner_review"));
  }

  revalidatePath("/verification");
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect(verificationPath("owners", "reviewed=1"));
}

export async function reviewClaim(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const claimId = textValue(formData, "claimId");
  const decision = textValue(formData, "decision");
  const reason = textValue(formData, "reason");

  if (
    !user ||
    !claimId ||
    !["approved", "rejected", "information_requested"].includes(decision) ||
    (decision !== "approved" && !reason)
  ) {
    redirect(verificationPath("claims", "error=claim_missing"));
  }

  const supabase = await adminClient();
  const { error } = await supabase
    .from("claims")
    .update({
      status: decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: decision === "approved" ? null : reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);

  if (error) {
    redirect(verificationPath("claims", "error=claim_review"));
  }

  revalidatePath("/verification");
  revalidatePath("/claims");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  redirect(verificationPath("claims", "reviewed=1"));
}

async function sendAgreementRequest(
  supabase: Awaited<ReturnType<typeof adminClient>>,
  agreementId: string,
) {
  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .select("id, tenancy_id, agreement_type, status, term_start_date, term_end_date, tenancies(tenant_id, tenants(id, profile_id, full_name, phone))")
    .eq("id", agreementId)
    .maybeSingle();
  const tenancy = Array.isArray(agreement?.tenancies)
    ? agreement?.tenancies[0]
    : agreement?.tenancies;
  const tenant = Array.isArray(tenancy?.tenants)
    ? tenancy?.tenants[0]
    : tenancy?.tenants;

  if (!agreement || !tenancy || !tenant?.phone) {
    return { status: "missing" as const };
  }

  const normalizedPhone = normalizePhoneNumber(tenant.phone);
  const agreementUrl = `${baseUrl()}/e-tenancy/${agreement.id}`;
  const isRenewal = agreement.agreement_type === "renewal";
  const message = [
    `Hello ${tenant.full_name ?? "Tenant"},`,
    isRenewal
      ? "Your DEKEZ tenancy renewal agreement is ready for review and signature."
      : "Your DEKEZ tenancy agreement is ready for review and signature.",
    agreement.term_start_date && agreement.term_end_date
      ? `Term: ${agreement.term_start_date} to ${agreement.term_end_date}.`
      : "",
    `Open and sign here: ${agreementUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data: conversation } = await supabase
    .from("whatsapp_conversations")
    .upsert(
      {
        tenant_id: tenant.profile_id ?? null,
        phone_number: tenant.phone,
        normalized_phone: normalizedPhone,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "normalized_phone" },
    )
    .select("id")
    .single();

  let providerMessageId: string | null = null;
  let sendStatus: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;

  try {
    const response = await sendWhatsAppText(tenant.phone, message);
    providerMessageId = response.messages?.[0]?.id ?? null;
  } catch (error) {
    sendStatus = "failed";
    errorMessage = error instanceof Error ? error.message : "WhatsApp send failed";
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
    notification_type: isRenewal ? "renewal_signature_request" : "signature_request",
    status: sendStatus,
    sent_at: sendStatus === "sent" ? new Date().toISOString() : null,
  });

  if (sendStatus === "sent" && isRenewal && agreement.status !== "renewal_signed") {
    await supabase
      .from("tenancy_agreements")
      .update({ status: "renewal_sent", updated_at: new Date().toISOString() })
      .eq("id", agreement.id);
  }

  return { status: sendStatus };
}

export async function sendAgreementWhatsApp(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const agreementId = textValue(formData, "agreementId");

  if (!agreementId) {
    redirect(verificationPath("tenancy", "error=agreement_missing"));
  }

  const supabase = await adminClient();
  const result = await sendAgreementRequest(supabase, agreementId);

  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  redirect(
    result.status === "sent"
      ? verificationPath("tenancy", "sent=1")
      : verificationPath("tenancy", "error=whatsapp_failed"),
  );
}

export async function requestRenewalSignature(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  const duration = Number(textValue(formData, "duration") || "12");

  if (!user || !tenancyId || ![6, 12].includes(duration)) {
    redirect(verificationPath("tenancy", "error=renewal_missing"));
  }

  const supabase = await adminClient();
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, unit_id, room_id, monthly_rental, deposit, tenancy_start_date, tenancy_end_date, contract_start, contract_end, tenants(full_name, phone, identity_number), properties(name, address, default_ta_template_id), rooms(name, room_number), units(name)")
    .eq("id", tenancyId)
    .eq("status", "active")
    .maybeSingle();

  if (!tenancy) {
    redirect(verificationPath("tenancy", "error=renewal_missing"));
  }

  const tenant = Array.isArray(tenancy.tenants) ? tenancy.tenants[0] : tenancy.tenants;
  const property = Array.isArray(tenancy.properties) ? tenancy.properties[0] : tenancy.properties;
  const room = Array.isArray(tenancy.rooms) ? tenancy.rooms[0] : tenancy.rooms;
  const unit = Array.isArray(tenancy.units) ? tenancy.units[0] : tenancy.units;
  const currentEnd = tenancy.tenancy_end_date ?? tenancy.contract_end;

  if (!currentEnd || !property) {
    redirect(verificationPath("tenancy", "error=renewal_missing"));
  }

  const startDate = nextDate(currentEnd);
  const endDate = addMonths(startDate, duration);
  const { data: existing } = await supabase
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancy.id)
    .eq("term_start_date", startDate)
    .eq("term_end_date", endDate)
    .maybeSingle();

  let agreementId = existing?.id ?? null;
  if (!agreementId) {
    let template: { id: string; template_content: string } | null = null;
    if (property.default_ta_template_id) {
      const { data } = await supabase
        .from("tenancy_agreement_templates")
        .select("id, template_content")
        .eq("id", property.default_ta_template_id)
        .maybeSingle();
      template = data;
    }

    if (!template) {
      const { data } = await supabase
        .from("tenancy_agreement_templates")
        .insert({
          property_id: tenancy.property_id,
          name: `${property.name} Default TA`,
          template_content: defaultAgreementTemplate,
          is_active: true,
          created_by: user.id,
        })
        .select("id, template_content")
        .single();
      template = data;
    }

    const { data: previousAgreements } = await supabase
      .from("tenancy_agreements")
      .select("id, version_number")
      .eq("tenancy_id", tenancy.id)
      .order("version_number", { ascending: false });
    const previous = previousAgreements?.[0] ?? null;
    const rendered = renderAgreementTemplate(
      template?.template_content ?? defaultAgreementTemplate,
      {
        tenant_name: tenant?.full_name,
        tenant_ic_passport: tenant?.identity_number,
        tenant_phone: tenant?.phone,
        property_name: property.name,
        property_address: property.address,
        unit_number: unit?.name,
        room_number: room?.room_number ?? room?.name,
        monthly_rent: money(tenancy.monthly_rental),
        deposit_amount: money(tenancy.deposit),
        utility_deposit: money(0),
        tenancy_start_date: startDate,
        tenancy_end_date: endDate,
        contract_duration_months: duration,
        agreement_date: new Date().toISOString().slice(0, 10),
        tenant_signature: "[Pending tenant signature]",
      },
    );

    const { data: agreement, error } = await supabase
      .from("tenancy_agreements")
      .insert({
        tenancy_id: tenancy.id,
        template_id: template?.id ?? null,
        agreement_type: "renewal",
        version_number: Number(previous?.version_number ?? 0) + 1,
        status: "renewal_pending",
        rendered_content: rendered,
        term_start_date: startDate,
        term_end_date: endDate,
        tenant_name_snapshot: tenant?.full_name ?? null,
        property_name_snapshot: property.name,
        room_name_snapshot: room?.room_number ?? room?.name ?? null,
        previous_agreement_id: previous?.id ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !agreement) {
      redirect(verificationPath("tenancy", "error=renewal_create"));
    }
    agreementId = agreement.id;
  }

  await supabase
    .from("tenancies")
    .update({ renewal_status: "pending_signature", updated_at: new Date().toISOString() })
    .eq("id", tenancy.id);

  const result = await sendAgreementRequest(supabase, agreementId);
  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  redirect(
    result.status === "sent"
      ? verificationPath("tenancy", "renewal=1")
      : verificationPath("tenancy", "error=whatsapp_failed"),
  );
}
