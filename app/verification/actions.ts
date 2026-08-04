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
import { sendAgreementRequest } from "@/lib/tenancy/agreement-whatsapp";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function verificationPath(view: string, result: string) {
  return `/verification?view=${view}&${result}`;
}

function staffPayoutPath(
  returnTo: "expenses" | "verification",
  result: string,
) {
  return returnTo === "expenses"
    ? `/expenses?${result}#staff-ap-payments`
    : verificationPath("claims", result);
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

export async function reviewSmartMeterTopUp(formData: FormData) {
  await requireRole(["super_admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const requestId = textValue(formData, "requestId");
  const decision = textValue(formData, "decision");
  const reason = textValue(formData, "reason");

  if (
    !user ||
    !requestId ||
    !["approved", "rejected"].includes(decision) ||
    (decision === "rejected" && !reason)
  ) {
    redirect(verificationPath("meter_topups", "error=topup_review"));
  }

  const supabase = createAdminClient();
  const { data: request } = await supabase
    .from("smart_meter_top_up_requests")
    .select("id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!request || request.status !== "pending_verification") {
    redirect(verificationPath("meter_topups", "error=topup_changed"));
  }

  const now = new Date().toISOString();
  const { data: reviewedRequest, error } = await supabase
    .from("smart_meter_top_up_requests")
    .update({
      status:
        decision === "approved"
          ? "approved_awaiting_top_up"
          : "rejected",
      rejection_reason: decision === "rejected" ? reason : null,
      verified_by: user.id,
      verified_at: now,
      updated_at: now,
    })
    .eq("id", request.id)
    .eq("status", "pending_verification")
    .select("id")
    .maybeSingle();

  if (error) {
    redirect(verificationPath("meter_topups", "error=topup_review"));
  }

  if (!reviewedRequest) {
    redirect(verificationPath("meter_topups", "error=topup_changed"));
  }

  revalidatePath("/verification");
  revalidatePath("/dashboard");
  redirect(
    verificationPath(
      "meter_topups",
      decision === "approved" ? "topup_approved=1" : "topup_rejected=1",
    ),
  );
}

export async function confirmSmartMeterCredit(formData: FormData) {
  await requireRole(["super_admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const requestId = textValue(formData, "requestId");
  const providerReference = textValue(formData, "providerReference");

  if (!user || !requestId || !providerReference) {
    redirect(verificationPath("meter_topups", "error=topup_credit_details"));
  }

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("confirm_smart_meter_top_up_credit", {
    request_id: requestId,
    reviewer_id: user.id,
    external_reference: providerReference,
  });

  if (error) {
    const errorCode = error.message.includes("active_electricity_meter_required")
      ? "meter_missing"
      : "topup_credit";
    redirect(verificationPath("meter_topups", `error=${errorCode}`));
  }

  revalidatePath("/verification");
  revalidatePath("/dashboard");
  revalidatePath("/properties");
  redirect(verificationPath("meter_topups", "topup_credited=1"));
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

export async function verifySignedAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const agreementId = textValue(formData, "agreementId");

  if (!user || !agreementId) {
    redirect(verificationPath("agreements", "error=agreement_missing"));
  }

  const supabase = await adminClient();
  const verifiedAt = new Date().toISOString();
  const { data: agreement, error } = await supabase
    .from("tenancy_agreements")
    .update({
      admin_verified_at: verifiedAt,
      admin_verified_by: user.id,
    })
    .eq("id", agreementId)
    .in("status", ["signed", "renewal_signed"])
    .is("admin_verified_at", null)
    .is("admin_rejected_at", null)
    .select("id")
    .maybeSingle();

  if (error || !agreement) {
    redirect(verificationPath("agreements", "error=agreement_verify"));
  }

  const { error: logError } = await supabase
    .from("tenancy_agreement_verification_logs")
    .insert({
      agreement_id: agreement.id,
      action: "verified",
      performed_by: user.id,
      performed_at: verifiedAt,
    });

  if (logError) {
    console.error("Signed agreement verification log could not be recorded.", {
      agreementId,
      error: logError.message,
    });
  }

  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  redirect(verificationPath("agreements", "agreement_verified=1"));
}

export async function rejectSignedAgreementForResign(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const agreementId = textValue(formData, "agreementId");
  const reason = textValue(formData, "reason");

  if (!user || !agreementId || !reason || reason.length > 1000) {
    redirect(verificationPath("agreements", "error=agreement_reject_missing"));
  }

  const supabase = createAdminClient();
  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .select("id, rendered_content")
    .eq("id", agreementId)
    .in("status", ["signed", "renewal_signed"])
    .is("admin_verified_at", null)
    .is("admin_rejected_at", null)
    .maybeSingle();

  if (!agreement) {
    redirect(verificationPath("agreements", "error=agreement_reject"));
  }

  const replacementContent = agreement.rendered_content.replace(
    /Signed digitally by [^\r\n]+/,
    "[Pending tenant signature]",
  );
  if (
    replacementContent === agreement.rendered_content ||
    !replacementContent.includes("[Pending tenant signature]")
  ) {
    redirect(
      verificationPath("agreements", "error=agreement_replacement_prepare"),
    );
  }

  const { data: replacementId, error } = await supabase.rpc(
    "reject_signed_agreement_and_request_resign",
    {
      source_agreement_id: agreement.id,
      rejection_reason: reason,
      replacement_rendered_content: replacementContent,
      performed_by_user_id: user.id,
    },
  );

  if (error || typeof replacementId !== "string") {
    redirect(verificationPath("agreements", "error=agreement_reject"));
  }

  const sendResult = await sendAgreementRequest(supabase, replacementId, {
    rejectionReason: reason,
    resign: true,
  });

  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  revalidatePath(`/e-tenancy/${agreement.id}`);
  revalidatePath(`/e-tenancy/${replacementId}`);
  revalidatePath("/tenancy-agreements");
  redirect(
    verificationPath(
      "agreements",
      `agreement_rejected=1&resign_sent=${
        sendResult.status === "sent" ? "1" : "0"
      }`,
    ),
  );
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
    .select("id, ticket_id, property_id, room_id, submitted_by, labour_cost, material_cost, total_amount, description, funding_source, bill_date, status")
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
          expense_date: claim.bill_date ?? malaysiaToday(),
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

    if (claim.funding_source === "staff_personal") {
      const { data: existingLiability } = await supabase
        .from("staff_reimbursement_liabilities")
        .select("id")
        .eq("claim_id", claim.id)
        .maybeSingle();

      if (!existingLiability) {
        const { error: liabilityError } = await supabase
          .from("staff_reimbursement_liabilities")
          .insert({
            claim_id: claim.id,
            expense_id: expense.id,
            staff_id: claim.submitted_by,
            amount:
              claim.total_amount ??
              Number(claim.labour_cost ?? 0) +
                Number(claim.material_cost ?? 0),
            status: "owed",
            owed_at: new Date().toISOString(),
          });

        if (liabilityError) {
          redirect(verificationPath("claims", "error=claim_reimbursement"));
        }
      }
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

export async function recordStaffReimbursementPayout(formData: FormData) {
  const returnTo =
    textValue(formData, "returnTo") === "expenses"
      ? "expenses"
      : "verification";
  await requireRole(["super_admin", "admin"], {
    module: returnTo,
    level: "manage",
  });
  const user = await getCurrentUser();
  const staffId = textValue(formData, "staffId");
  const paymentSource = textValue(formData, "paymentSource");
  const paidOn = textValue(formData, "paidOn");
  const referenceNumber = textValue(formData, "referenceNumber");
  const notes = textValue(formData, "notes");
  const proof = fileValue(formData, "payoutProof");
  const liabilityIds = [
    ...new Set(
      formData
        .getAll("liabilityIds")
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value),
        ),
    ),
  ];

  if (
    !user ||
    !staffId ||
    !liabilityIds.length ||
    !["company_cash", "company_bank"].includes(paymentSource) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) ||
    !proof ||
    proof.size > 3 * 1024 * 1024 ||
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ].includes(proof.type)
  ) {
    redirect(staffPayoutPath(returnTo, "error=payout_missing"));
  }

  const supabase = createAdminClient();
  const { data: liabilities } = await supabase
    .from("staff_reimbursement_liabilities")
    .select("id, expense_id")
    .in("id", liabilityIds)
    .eq("staff_id", staffId)
    .eq("status", "owed");

  if ((liabilities ?? []).length !== liabilityIds.length) {
    redirect(staffPayoutPath(returnTo, "error=payout_changed"));
  }

  const expenseIds = (liabilities ?? []).map(
    (liability) => liability.expense_id,
  );
  const { data: billReceipts } = await supabase
    .from("expense_attachments")
    .select("expense_id")
    .in("expense_id", expenseIds);
  const expensesWithReceipts = new Set(
    (billReceipts ?? []).map((receipt) => receipt.expense_id),
  );
  if (expenseIds.some((expenseId) => !expensesWithReceipts.has(expenseId))) {
    redirect(staffPayoutPath(returnTo, "error=payout_receipt_missing"));
  }

  const safeName = proof.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const proofPath =
    `${staffId}/${Date.now()}-staff-payout-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("reimbursement-proofs")
    .upload(proofPath, Buffer.from(await proof.arrayBuffer()), {
      contentType: proof.type,
      upsert: false,
    });

  if (uploadError) {
    redirect(staffPayoutPath(returnTo, "error=payout_proof"));
  }

  const { error: payoutError } = await supabase.rpc(
    "record_staff_reimbursement_payout",
    {
      target_staff_id: staffId,
      liability_ids: liabilityIds,
      payout_source: paymentSource,
      payout_date: paidOn,
      payout_reference: referenceNumber,
      payout_notes: notes,
      payout_proof_bucket: "reimbursement-proofs",
      payout_proof_path: proofPath,
      payout_proof_content_type: proof.type,
      payout_recorded_by: user.id,
    },
  );

  if (payoutError) {
    await supabase.storage.from("reimbursement-proofs").remove([proofPath]);
    redirect(staffPayoutPath(returnTo, "error=payout_changed"));
  }

  revalidatePath("/verification");
  revalidatePath("/claims");
  revalidatePath("/maintenance");
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  redirect(staffPayoutPath(returnTo, "payout_recorded=1"));
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

  if (!user || !tenancyId) {
    redirect(verificationPath("tenancy", "error=agreement_missing"));
  }

  const supabase = await adminClient();
  try {
    await createAgreementForTenancy(supabase, tenancyId, user.id);
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
  const renewalMonthlyRent = Number(
    textValue(formData, "renewalMonthlyRent"),
  );

  if (
    !user ||
    !tenancyId ||
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
    .is("admin_rejected_at", null)
    .order("term_end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let agreementId: string | null = existing?.id ?? null;
  if (agreementId) {
    const { data: approvedDecision } = await supabase
      .from("tenancy_renewals")
      .select("id")
      .eq("new_agreement_id", agreementId)
      .eq("decision_status", "renew")
      .limit(1)
      .maybeSingle();
    if (!approvedDecision) {
      redirect(verificationPath("tenancy", "error=renewal_decision"));
    }
    try {
      await updateUnsignedAgreementRent(
        supabase,
        agreementId,
        renewalMonthlyRent,
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
