"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { normalizeRole } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createAgreementForTenancy,
  prepareNextRenewalAgreement,
  updateUnsignedAgreementRent,
} from "@/lib/tenancy/agreement";
import { isAgreementDocumentType } from "@/lib/tenancy/agreement-types";
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

function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function adminClient() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export async function reviewUserRegistration(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const profileId = textValue(formData, "profileId");
  const decision = textValue(formData, "decision");
  const assignedRole = normalizeRole(textValue(formData, "role"));
  const reason = textValue(formData, "reason");
  const propertyIds = formData
    .getAll("propertyIds")
    .filter((value): value is string => typeof value === "string" && Boolean(value));

  if (
    !user ||
    !profileId ||
    !["approved", "rejected"].includes(decision) ||
    (decision === "approved" &&
      (!assignedRole ||
        assignedRole === "super_admin" ||
        (assignedRole === "owner" && !propertyIds.length))) ||
    (decision === "rejected" && !reason)
  ) {
    redirect(verificationPath("users", "error=user_missing"));
  }

  const admin = await adminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, requested_role, identity_type, identity_number")
    .eq("id", profileId)
    .maybeSingle();

  if (!profile || profile.role === "super_admin") {
    redirect(verificationPath("users", "error=user_missing"));
  }

  if (
    decision === "approved" &&
    assignedRole === "owner" &&
    profile.requested_role === "owner"
  ) {
    const { data: documents } = await admin
      .from("profile_documents")
      .select("document_type")
      .eq("profile_id", profile.id);
    const documentTypes = new Set(
      (documents ?? []).map((document) => document.document_type),
    );
    const hasIdentity =
      profile.identity_type === "ic"
        ? documentTypes.has("ic_front") && documentTypes.has("ic_back")
        : documentTypes.has("passport_photo_page");

    if (!profile.identity_number || !hasIdentity) {
      redirect(verificationPath("users", "error=user_documents"));
    }
  }

  if (decision === "approved") {
    const { error: roleError } = await admin
      .from("profiles")
      .update({
        role: assignedRole,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (roleError) {
      redirect(verificationPath("users", "error=user_review"));
    }

    const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
    const { error: authRoleError } = await admin.auth.admin.updateUserById(
      profile.id,
      {
        app_metadata: {
          ...(authUser.user?.app_metadata ?? {}),
          role: assignedRole,
        },
      },
    );

    if (authRoleError) {
      redirect(verificationPath("users", "error=user_review"));
    }

    if (assignedRole === "owner") {
      const { data: properties } = await admin
        .from("properties")
        .select("id, company_id")
        .in("id", propertyIds);

      if (!properties?.length || properties.length !== propertyIds.length) {
        redirect(verificationPath("users", "error=property_missing"));
      }

      const sessionClient = await createClient();
      for (const property of properties) {
        const { error: membershipError } = await admin
          .from("company_users")
          .upsert(
            {
              company_id: property.company_id,
              profile_id: profile.id,
              user_id: profile.id,
              role: "owner",
              status: "active",
              created_by: user.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "company_id,profile_id" },
          );

        if (membershipError) {
          redirect(verificationPath("users", "error=user_assign"));
        }

        const { error: assignmentError } = await sessionClient.rpc(
          "set_property_owner",
          {
            target_owner_id: profile.id,
            target_property_id: property.id,
          },
        );

        if (assignmentError) {
          redirect(verificationPath("users", "error=user_assign"));
        }
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
    .eq("id", profile.id);

  if (error) {
    redirect(verificationPath("users", "error=user_review"));
  }

  await admin
    .from("profile_documents")
    .update({
      verification_status:
        decision === "approved" ? "verified" : "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: decision === "rejected" ? reason : null,
    })
    .eq("profile_id", profile.id);

  revalidatePath("/verification");
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  redirect(verificationPath("users", "reviewed=1"));
}

export async function reviewClaim(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
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
  const { data: claim } = await supabase
    .from("claims")
    .select("id, ticket_id, property_id, room_id, submitted_by, labour_cost, material_cost, total_amount, description, funding_source, status")
    .eq("id", claimId)
    .maybeSingle();

  if (!claim || ["paid"].includes(claim.status)) {
    redirect(verificationPath("claims", "error=claim_missing"));
  }

  if (decision !== "approved" && claim.status === "approved") {
    redirect(verificationPath("claims", "error=claim_review"));
  }

  if (decision === "approved") {
    const { data: property } = await supabase
      .from("properties")
      .select("id, company_id, organization_id")
      .eq("id", claim.property_id)
      .maybeSingle();
    const { data: category } = await supabase
      .from("expense_categories")
      .select("id")
      .eq("name", "Repairs & Maintenance")
      .maybeSingle();

    if (!property) {
      redirect(verificationPath("claims", "error=claim_expense"));
    }

    let { data: expense } = await supabase
      .from("expenses")
      .select("id")
      .eq("claim_id", claim.id)
      .maybeSingle();
    let createdExpense = false;

    if (!expense) {
      const { data: insertedExpense, error: expenseError } = await supabase
        .from("expenses")
        .insert({
          organization_id: property.organization_id ?? null,
          company_id: property.company_id,
          property_id: claim.property_id,
          room_id: claim.room_id ?? null,
          maintenance_ticket_id: claim.ticket_id ?? null,
          claim_id: claim.id,
          category_id: category?.id ?? null,
          expense_date: malaysiaToday(),
          amount:
            claim.total_amount ??
            Number(claim.labour_cost ?? 0) + Number(claim.material_cost ?? 0),
          tax_amount: 0,
          description: claim.description,
          paid_by: claim.submitted_by,
          payment_method: "cash",
          funding_source: claim.funding_source,
          charge_to: "company",
          status: "pending_verification",
          tax_claimable: false,
          uploaded_by: claim.submitted_by,
        })
        .select("id")
        .single();

      if (expenseError || !insertedExpense) {
        redirect(verificationPath("claims", "error=claim_expense"));
      }
      expense = insertedExpense;
      createdExpense = true;
    }

    const [{ data: claimAttachments }, { data: existingAttachments }] =
      await Promise.all([
        supabase
          .from("claim_attachments")
          .select("id, bucket_name, file_path, content_type")
          .eq("claim_id", claim.id),
        supabase
          .from("expense_attachments")
          .select("file_path")
          .eq("expense_id", expense.id),
      ]);
    const existingPaths = new Set(
      (existingAttachments ?? []).map((attachment) => attachment.file_path),
    );
    const copiedPaths: string[] = [];

    for (const attachment of claimAttachments ?? []) {
      const fileName =
        attachment.file_path.split("/").at(-1) ?? `${attachment.id}.bin`;
      const destinationPath = `${expense.id}/claim-${attachment.id}-${fileName}`;
      if (existingPaths.has(destinationPath)) continue;

      const { data: receipt, error: downloadError } = await supabase.storage
        .from(attachment.bucket_name)
        .download(attachment.file_path);
      if (downloadError || !receipt) {
        if (createdExpense) {
          await supabase.from("expenses").delete().eq("id", expense.id);
        }
        redirect(verificationPath("claims", "error=claim_expense"));
      }

      const { error: uploadError } = await supabase.storage
        .from("expense-receipts")
        .upload(destinationPath, await receipt.arrayBuffer(), {
          contentType: attachment.content_type ?? undefined,
          upsert: false,
        });
      if (uploadError) {
        if (copiedPaths.length) {
          await supabase.storage.from("expense-receipts").remove(copiedPaths);
        }
        if (createdExpense) {
          await supabase.from("expenses").delete().eq("id", expense.id);
        }
        redirect(verificationPath("claims", "error=claim_expense"));
      }
      copiedPaths.push(destinationPath);

      const { error: attachmentError } = await supabase
        .from("expense_attachments")
        .insert({
          expense_id: expense.id,
          bucket_name: "expense-receipts",
          file_path: destinationPath,
          file_name: fileName,
          content_type: attachment.content_type,
          uploaded_by: claim.submitted_by,
        });
      if (attachmentError) {
        await supabase.storage
          .from("expense-receipts")
          .remove(copiedPaths);
        if (createdExpense) {
          await supabase.from("expenses").delete().eq("id", expense.id);
        }
        redirect(verificationPath("claims", "error=claim_expense"));
      }
    }

    const { error: expenseVerificationError } = await supabase
      .from("expenses")
      .update({
        status: "verified",
        verified_by: user.id,
        verified_at: new Date().toISOString(),
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", expense.id);
    if (expenseVerificationError) {
      redirect(verificationPath("claims", "error=claim_expense"));
    }
  }

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
  revalidatePath("/maintenance");
  revalidatePath("/expenses");
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
    .select("id, tenancy_id, term_type, agreement_type, status, term_start_date, term_end_date, tenancies(tenant_id, tenants(id, profile_id, full_name, phone))")
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
  const isRenewal = agreement.term_type === "renewal";
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
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
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

export async function generateInitialAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  const agreementType = textValue(formData, "agreementType");

  if (!user || !tenancyId || !isAgreementDocumentType(agreementType)) {
    redirect(verificationPath("tenancy", "error=agreement_missing"));
  }

  const supabase = await adminClient();
  try {
    await createAgreementForTenancy(supabase, tenancyId, user.id, {
      agreementType,
    });
  } catch {
    redirect(verificationPath("tenancy", "error=agreement_create"));
  }

  revalidatePath("/verification");
  revalidatePath("/dashboard");
  redirect(verificationPath("tenancy", "created=agreement"));
}

export async function updateAgreementTermRent(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const agreementId = textValue(formData, "agreementId");
  const monthlyRent = Number(textValue(formData, "termMonthlyRent"));

  if (!agreementId || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    redirect(verificationPath("tenancy", "error=agreement_rent"));
  }

  const supabase = await adminClient();
  try {
    await updateUnsignedAgreementRent(supabase, agreementId, monthlyRent);
  } catch {
    redirect(verificationPath("tenancy", "error=agreement_rent"));
  }

  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  revalidatePath(`/e-tenancy/${agreementId}`);
  redirect(verificationPath("tenancy", "updated=rent"));
}

export async function requestRenewalSignature(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  const agreementType = textValue(formData, "agreementType");
  const renewalMonthlyRent = Number(
    textValue(formData, "renewalMonthlyRent"),
  );

  if (
    !user ||
    !tenancyId ||
    !isAgreementDocumentType(agreementType) ||
    !Number.isFinite(renewalMonthlyRent) ||
    renewalMonthlyRent <= 0
  ) {
    redirect(verificationPath("tenancy", "error=renewal_missing"));
  }

  const supabase = await adminClient();
  const { data: existing } = await supabase
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("term_type", "renewal")
    .in("status", ["renewal_pending", "renewal_sent", "pending_signature"])
    .order("term_end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let agreementId: string | null = existing?.id ?? null;
  if (agreementId) {
    try {
      await updateUnsignedAgreementRent(
        supabase,
        agreementId,
        renewalMonthlyRent,
        agreementType,
      );
    } catch {
      redirect(verificationPath("tenancy", "error=renewal_create"));
    }
  } else {
    try {
      agreementId = await prepareNextRenewalAgreement(
        supabase,
        tenancyId,
        user.id,
        {
          agreementType,
          monthlyRent: renewalMonthlyRent,
        },
      );
    } catch {
      redirect(verificationPath("tenancy", "error=renewal_create"));
    }
  }

  if (!agreementId) {
    redirect(verificationPath("tenancy", "error=renewal_missing"));
  }
  const result = await sendAgreementRequest(supabase, agreementId);
  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  redirect(
    result.status === "sent"
      ? verificationPath("tenancy", "renewal=1")
      : verificationPath("tenancy", "error=whatsapp_failed"),
  );
}
