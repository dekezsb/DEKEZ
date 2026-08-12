"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { dayDifference, malaysiaDateString } from "@/lib/data/rent-due";
import {
  getVerifiedDepositPaymentMaps,
  verifiedDepositPaid,
} from "@/lib/invoices/deposit-payments";
import {
  isPaymentPurpose,
  type PaymentPurpose,
} from "@/lib/payments/payment-purpose";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { extendFingerprintAccessAfterPayment } from "@/lib/ttlock/fingerprint";
import { normalizePhoneNumber } from "@/lib/whatsapp/config";
import { sendWhatsAppText } from "@/lib/whatsapp/meta";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function rentTrackerPath(
  formData: FormData,
  resultKey: "error" | "uploaded",
  resultValue: string,
) {
  const params = new URLSearchParams();
  const returnTo = textValue(formData, "returnTo");
  const month = textValue(formData, "returnMonth");
  const property = textValue(formData, "returnProperty");

  if (returnTo === "/dashboard") {
    params.set(resultKey, resultValue);
    return `/dashboard?${params.toString()}#dashboard-rent-due`;
  }

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    params.set("month", month);
  }
  if (/^[0-9a-f-]{36}$/i.test(property)) {
    params.set("property", property);
  }

  params.set(resultKey, resultValue);
  return `/rent-due-tracker?${params.toString()}`;
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "https://dekez.vercel.app";
}

function reminderStage(daysUntilDue: number) {
  if (daysUntilDue > 0) {
    return `${daysUntilDue}_days_before`;
  }
  if (daysUntilDue === 0) {
    return "due_today";
  }
  return `${Math.abs(daysUntilDue)}_days_overdue`;
}

async function createOrUpdateConversation(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  tenantId: string | null,
  phoneNumber: string,
) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const { data } = await supabase
    .from("whatsapp_conversations")
    .upsert({
      tenant_id: tenantId,
      phone_number: phoneNumber,
      normalized_phone: normalizedPhone,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "normalized_phone",
    })
    .select("id")
    .single();

  return data?.id ?? null;
}

async function logWhatsAppMessage(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  input: {
    conversationId: string | null;
    tenantId: string | null;
    phoneNumber: string;
    message: string;
    providerMessageId?: string | null;
    status: "sent" | "failed";
    errorMessage?: string | null;
  },
) {
  await supabase.from("whatsapp_messages").insert({
    conversation_id: input.conversationId,
    tenant_id: input.tenantId,
    phone_number: input.phoneNumber,
    normalized_phone: normalizePhoneNumber(input.phoneNumber),
    direction: "outgoing",
    meta_message_id: input.providerMessageId ?? null,
    message_type: "text",
    message_text: input.message,
    processing_status: input.status,
    error_message: input.errorMessage ?? null,
  });
}

async function getBillContext(supabase: Awaited<ReturnType<typeof getAdmin>>, billId: string) {
  const { data: bill, error: billError } = await supabase
    .from("rent_bills")
    .select("id, tenant_id, tenancy_id, tenant_record_id, property_id, unit_id, room_id, bill_month, due_date, amount, deposit_amount, paid_amount, status, properties(name), units(name), rooms(name, room_number)")
    .eq("id", billId)
    .single();

  if (!bill) {
    console.error("[rent-bill] context lookup failed", {
      billId,
      code: billError?.code,
      message: billError?.message,
    });
    return null;
  }

  let tenant: { id: string | null; full_name: string | null; phone: string | null } | null = null;
  let tenantRecordId = bill.tenant_record_id;
  let tenantEntityId: string | null = null;

  if (bill.tenant_id) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .eq("id", bill.tenant_id)
      .maybeSingle();
    tenant = data;
  }

  if (!tenant && bill.tenant_record_id) {
    const { data } = await supabase
      .from("tenant_records")
      .select("id, tenant_id, full_name, phone")
      .eq("id", bill.tenant_record_id)
      .maybeSingle();

    if (data) {
      tenantEntityId = data.tenant_id ?? null;
      tenant = {
        id: null,
        full_name: data.full_name,
        phone: data.phone,
      };
    }
  }

  // Older imported invoices can be linked to a valid tenancy while both
  // tenant_id and tenant_record_id on the invoice are empty. Resolve the
  // active record through the tenancy so Admin can still submit proof without
  // weakening the invoice, room or tenant association used for audit.
  if (bill.tenancy_id && (!tenant || !tenantRecordId)) {
    const [{ data: tenancy }, { data: tenantRecord }] = await Promise.all([
      supabase
        .from("tenancies")
        .select("tenant_id")
        .eq("id", bill.tenancy_id)
        .maybeSingle(),
      supabase
        .from("tenant_records")
        .select("id, tenant_id, full_name, phone")
        .eq("tenancy_id", bill.tenancy_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    tenantRecordId = tenantRecordId ?? tenantRecord?.id ?? null;
    tenantEntityId = tenantEntityId
      ?? tenantRecord?.tenant_id
      ?? tenancy?.tenant_id
      ?? null;

    if (!tenant && tenantRecord) {
      tenant = {
        id: null,
        full_name: tenantRecord.full_name,
        phone: tenantRecord.phone,
      };
    }
  }

  if (tenantEntityId) {
    const { data: tenantEntity } = await supabase
      .from("tenants")
      .select("profile_id, full_name, phone")
      .eq("id", tenantEntityId)
      .maybeSingle();

    if (tenantEntity) {
      tenant = {
        id: tenantEntity.profile_id ?? tenant?.id ?? null,
        full_name: tenant?.full_name ?? tenantEntity.full_name,
        phone: tenant?.phone ?? tenantEntity.phone,
      };
    }
  }

  return {
    ...bill,
    tenant_record_id: tenantRecordId,
    tenant,
  };
}

async function getPaymentBalances(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  bill: NonNullable<Awaited<ReturnType<typeof getBillContext>>>,
) {
  const { data: tenancy } = bill.tenancy_id
    ? await supabase
        .from("tenancies")
        .select("deposit")
        .eq("id", bill.tenancy_id)
        .maybeSingle()
    : { data: null };
  const depositRequired = Math.max(
    Number(bill.deposit_amount ?? 0),
    Number(tenancy?.deposit ?? 0),
  );
  const depositMaps = await getVerifiedDepositPaymentMaps(
    supabase,
    bill.tenancy_id ? [bill.tenancy_id] : [],
    bill.tenant_record_id ? [bill.tenant_record_id] : [],
  );
  const depositPaid = verifiedDepositPaid(depositMaps, {
    tenancyId: bill.tenancy_id,
    tenantRecordId: bill.tenant_record_id,
    depositAmount: depositRequired,
  });

  return {
    rentOutstanding: Math.max(
      Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0),
      0,
    ),
    depositOutstanding: Math.max(depositRequired - depositPaid, 0),
  };
}

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function sendRentReminder(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "rent_due_tracker",
    level: "manage",
  });
  const user = await getCurrentUser();
  const billId = textValue(formData, "billId");
  const message = textValue(formData, "message");

  if (!user || !billId || !message) {
    redirect("/rent-due-tracker?error=reminder_missing");
  }

  const supabase = await getAdmin();
  const bill = await getBillContext(supabase, billId);
  const tenant = bill?.tenant;
  const phoneNumber = tenant?.phone;

  if (!bill || !phoneNumber) {
    redirect("/rent-due-tracker?error=tenant_phone");
  }

  const stage = reminderStage(dayDifference(bill.due_date));
  const reminderTenantId = tenant.id ?? bill.tenant_id;
  const { data: existing } = await supabase
    .from("rent_reminder_logs")
    .select("id")
    .eq("bill_id", bill.id)
    .eq("reminder_stage", stage)
    .eq("channel", "whatsapp")
    .maybeSingle();

  if (existing) {
    redirect("/rent-due-tracker?error=duplicate_reminder");
  }

  const conversationId = await createOrUpdateConversation(supabase, reminderTenantId, phoneNumber);
  let providerMessageId: string | null = null;
  let status: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;

  try {
    const sent = await sendWhatsAppText(phoneNumber, message);
    providerMessageId = sent.messages?.[0]?.id ?? null;
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : "WhatsApp send failed";
  }

  await logWhatsAppMessage(supabase, {
    conversationId,
    tenantId: reminderTenantId,
    phoneNumber,
    message,
    providerMessageId,
    status,
    errorMessage,
  });

  await supabase.from("rent_reminder_logs").insert({
    bill_id: bill.id,
    tenant_id: reminderTenantId,
    tenant_record_id: bill.tenant_record_id,
    reminder_stage: stage,
    channel: "whatsapp",
    provider_message_id: providerMessageId,
    status,
    error_message: errorMessage,
    created_by: user.id,
  });

  revalidatePath("/rent-due-tracker");
  redirect(status === "sent" ? "/rent-due-tracker?sent=1" : "/rent-due-tracker?error=whatsapp_failed");
}

export async function markRentBillPaid(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "rent_due_tracker",
    level: "manage",
  });
  const user = await getCurrentUser();
  const billId = textValue(formData, "billId");
  const paymentType = textValue(formData, "paymentType");
  const paidAmount = numberValue(formData, "paidAmount");
  const paidDate = textValue(formData, "paidDate") || malaysiaDateString();
  const referenceNumber = textValue(formData, "referenceNumber");
  const notes = textValue(formData, "notes");

  if (!user || !billId || !paymentType || paidAmount <= 0 || (!referenceNumber && !notes)) {
    redirect("/rent-due-tracker?error=mark_paid_missing");
  }

  const supabase = await getAdmin();
  const bill = await getBillContext(supabase, billId);

  if (!bill || ["paid", "cancelled", "waived"].includes(String(bill.status))) {
    redirect("/rent-due-tracker?error=bill_not_found");
  }

  const outstandingAmount = Math.max(Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0), 0);
  if (paidAmount > outstandingAmount) {
    redirect("/rent-due-tracker?error=paid_amount");
  }

  if (referenceNumber) {
    const { data: duplicatePayment } = await supabase
      .from("payments")
      .select("id")
      .eq("rent_bill_id", bill.id)
      .eq("reference_number", referenceNumber)
      .maybeSingle();

    if (duplicatePayment) {
      redirect("/rent-due-tracker?error=duplicate_payment");
    }
  }

  const oldPaidAmount = Number(bill.paid_amount ?? 0);
  const billAmount = Number(bill.amount ?? 0);
  const newPaidAmount = Math.min(oldPaidAmount + paidAmount, billAmount);
  const newStatus = newPaidAmount >= billAmount ? "paid" : "partially_paid";

  const { error: paymentError } = await supabase.from("payments").insert({
    rent_bill_id: bill.id,
    organization_id: null,
    tenant_id: bill.tenant_id,
    tenancy_id: bill.tenancy_id,
    property_id: bill.property_id,
    unit_id: bill.unit_id,
    room_id: bill.room_id,
    category: "monthly_rent",
    amount: paidAmount,
    payment_date: paidDate,
    payment_method: paymentType,
    reference_number: referenceNumber || null,
    notes: notes || "Manual rent due tracker payment",
    status: "confirmed",
    recorded_by: user.id,
    verified_by: user.id,
    verified_at: new Date().toISOString(),
  });

  if (paymentError) {
    redirect("/rent-due-tracker?error=mark_paid_failed");
  }

  await supabase
    .from("rent_bills")
    .update({
      paid_amount: newPaidAmount,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bill.id);

  await supabase.from("rent_bill_audit_logs").insert({
    bill_id: bill.id,
    action: "manual_mark_paid",
    performed_by: user.id,
    old_status: bill.status,
    new_status: newStatus,
    old_paid_amount: oldPaidAmount,
    new_paid_amount: newPaidAmount,
    reason: `${paymentType}: ${notes || referenceNumber}`,
  });

  revalidatePath("/rent-due-tracker");
  revalidatePath("/dashboard");
  revalidatePath("/payments");
  redirect("/rent-due-tracker?paid=1");
}

export async function uploadRentPaymentSlip(formData: FormData) {
  // Management staff can submit proof from their dashboard without receiving
  // access to the separate Rent Due Tracker administration module.
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const billId = textValue(formData, "billId");
  const amount = numberValue(formData, "amount");
  const paymentDate = textValue(formData, "paymentDate") || malaysiaDateString();
  const paymentMethod = textValue(formData, "paymentMethod") || "bank_transfer";
  const requestedPurpose = textValue(formData, "paymentPurpose");
  const paymentPurpose: PaymentPurpose = isPaymentPurpose(requestedPurpose)
    ? requestedPurpose
    : "monthly_rent";
  const referenceNumber = textValue(formData, "referenceNumber");
  const receipt = fileValue(formData, "receipt");

  if (!user || !billId || amount <= 0 || !receipt) {
    redirect(rentTrackerPath(formData, "error", "proof_missing"));
  }

  const isSupportedFile = receipt.type.startsWith("image/")
    || receipt.type === "application/pdf"
    || /\.(jpe?g|png|webp|heic|pdf)$/i.test(receipt.name);

  if (!isSupportedFile) {
    redirect(rentTrackerPath(formData, "error", "proof_type"));
  }

  if (receipt.size > 10 * 1024 * 1024) {
    redirect(rentTrackerPath(formData, "error", "proof_size"));
  }

  console.info("[payment-slip] submission started", {
    billId,
    fileSize: receipt.size,
    fileType: receipt.type || "unknown",
    paymentPurpose,
    submittedBy: user.id,
  });

  const supabase = await getAdmin();
  const bill = await getBillContext(supabase, billId);

  const submissionTenantId = bill?.tenant_id ?? bill?.tenant?.id ?? null;
  if (!bill || (!submissionTenantId && !bill.tenant_record_id) || ["cancelled", "waived"].includes(String(bill.status))) {
    console.warn("[payment-slip] bill is not eligible for submission", {
      billId,
      billStatus: bill?.status,
      hasTenantId: Boolean(submissionTenantId),
      hasTenantRecordId: Boolean(bill?.tenant_record_id),
    });
    redirect(rentTrackerPath(formData, "error", "bill_not_found"));
  }

  const balances = await getPaymentBalances(supabase, bill);
  const purposeAvailable =
    (paymentPurpose === "monthly_rent" && balances.rentOutstanding > 0.005) ||
    (paymentPurpose === "deposit" && balances.depositOutstanding > 0.005) ||
    (paymentPurpose === "rent_and_deposit" &&
      balances.rentOutstanding > 0.005 &&
      balances.depositOutstanding > 0.005) ||
    paymentPurpose === "other";
  if (!purposeAvailable) {
    console.warn("[payment-slip] selected purpose has no outstanding balance", {
      billId,
      paymentPurpose,
      rentOutstanding: balances.rentOutstanding,
      depositOutstanding: balances.depositOutstanding,
    });
    redirect(rentTrackerPath(formData, "error", "bill_not_found"));
  }

  const { data: pendingSubmission } = await supabase
    .from("payment_submissions")
    .select("id")
    .eq("rent_bill_id", bill.id)
    .eq("verification_status", "pending_verification")
    .limit(1)
    .maybeSingle();

  if (pendingSubmission) {
    console.info("[payment-slip] pending submission already exists", {
      billId,
      submissionId: pendingSubmission.id,
    });
    redirect(rentTrackerPath(formData, "error", "proof_pending"));
  }

  const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${user.id}/${bill.id}/${paymentPurpose}-${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await receipt.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("payment-receipts")
    .upload(path, bytes, {
      contentType: receipt.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    console.error("[payment-slip] storage upload failed", {
      billId,
      code: "statusCode" in uploadError ? uploadError.statusCode : undefined,
      message: uploadError.message,
    });
    redirect(rentTrackerPath(formData, "error", "proof_upload"));
  }

  const { data: submission, error: submissionError } = await supabase
    .from("payment_submissions")
    .insert({
      tenant_id: submissionTenantId,
      tenant_record_id: bill.tenant_record_id,
      tenancy_id: bill.tenancy_id,
      rent_bill_id: bill.id,
      property_id: bill.property_id,
      unit_id: bill.unit_id,
      room_id: bill.room_id,
      bill_month: bill.bill_month,
      bill_type:
        paymentPurpose === "deposit"
          ? "deposit"
          : paymentPurpose === "other"
            ? "other"
            : "monthly_rent",
      payment_type: paymentPurpose,
      amount,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      reference_number: referenceNumber || null,
      receipt_url: path,
      verification_status: "pending_verification",
    })
    .select("id")
    .single();

  if (submissionError || !submission) {
    console.error("[payment-slip] submission insert failed", {
      billId,
      code: submissionError?.code,
      message: submissionError?.message,
    });
    await supabase.storage.from("payment-receipts").remove([path]);
    redirect(rentTrackerPath(formData, "error", "proof_create"));
  }

  const { error: attachmentError } = await supabase.from("payment_attachments").insert({
    payment_submission_id: submission.id,
    tenant_id: submissionTenantId,
    tenant_record_id: bill.tenant_record_id,
    file_path: path,
    file_name: receipt.name,
    content_type: receipt.type || null,
  });

  if (attachmentError) {
    console.error("[payment-slip] attachment insert failed", {
      billId,
      code: attachmentError.code,
      message: attachmentError.message,
      submissionId: submission.id,
    });
    await supabase.from("payment_submissions").delete().eq("id", submission.id);
    await supabase.storage.from("payment-receipts").remove([path]);
    redirect(rentTrackerPath(formData, "error", "proof_create"));
  }

  if (
    paymentPurpose === "monthly_rent" ||
    paymentPurpose === "rent_and_deposit"
  ) {
    await supabase
      .from("rent_bills")
      .update({
        status: "payment_submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bill.id);
  }

  revalidatePath("/rent-due-tracker");
  revalidatePath("/payment-verification");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  console.info("[payment-slip] submission completed", {
    billId,
    submissionId: submission.id,
  });
  redirect(rentTrackerPath(formData, "uploaded", "1"));
}

export async function verifyRentSubmission(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "rent_due_tracker",
    level: "manage",
  });
  const user = await getCurrentUser();
  const submissionId = textValue(formData, "submissionId");

  if (!user || !submissionId) {
    redirect("/rent-due-tracker?error=verify_missing");
  }

  const supabase = await getAdmin();
  const { data: submission } = await supabase
    .from("payment_submissions")
    .select("id, tenant_id, tenancy_id, rent_bill_id, property_id, unit_id, room_id, bill_type, payment_type, amount, payment_date, payment_method, reference_number, verification_status")
    .eq("id", submissionId)
    .single();

  if (!submission || submission.verification_status === "verified") {
    redirect("/rent-due-tracker?error=already_verified");
  }

  if (
    submission.payment_type === "deposit" ||
    submission.payment_type === "rent_and_deposit"
  ) {
    redirect("/payment-verification?status=pending_verification");
  }

  const bill = submission.rent_bill_id ? await getBillContext(supabase, submission.rent_bill_id) : null;
  if (!bill) {
    redirect("/rent-due-tracker?error=bill_not_found");
  }

  const oldPaidAmount = Number(bill.paid_amount ?? 0);
  const { data: extraChargeItems } = await supabase
    .from("rental_invoice_line_items")
    .select("amount")
    .eq("rent_bill_id", bill.id);
  const billAmount =
    Number(bill.amount ?? 0) +
    Number(bill.deposit_amount ?? 0) +
    (extraChargeItems ?? []).reduce(
      (total, item) => total + Number(item.amount ?? 0),
      0,
    );
  const submittedAmount = Number(submission.amount ?? 0);
  const outstandingAmount = Math.max(billAmount - oldPaidAmount, 0);
  if (submittedAmount - outstandingAmount > 0.005) {
    redirect("/payment-verification?error=extra_purpose");
  }
  const newPaidAmount = Math.min(oldPaidAmount + submittedAmount, billAmount);
  const newStatus = newPaidAmount >= billAmount ? "paid" : "partially_paid";

  await supabase
    .from("payment_submissions")
    .update({
      verification_status: "verified",
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submission.id);

  await supabase
    .from("rent_bills")
    .update({
      paid_amount: newPaidAmount,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bill.id);

  await supabase.from("payments").insert({
    rent_bill_id: bill.id,
    organization_id: null,
    tenant_id: submission.tenant_id,
    tenancy_id: submission.tenancy_id,
    property_id: submission.property_id,
    unit_id: submission.unit_id,
    room_id: submission.room_id,
    category: submission.bill_type === "monthly_rent" ? "monthly_rent" : submission.payment_type,
    amount: submittedAmount,
    payment_date: submission.payment_date,
    payment_method: submission.payment_method,
    reference_number: submission.reference_number,
    notes: "Verified from rent due tracker",
    status: "confirmed",
    recorded_by: user.id,
    verified_by: user.id,
    verified_at: new Date().toISOString(),
  });

  await supabase.from("payment_verification_audit_logs").insert({
    payment_submission_id: submission.id,
    action: "verified",
    performed_by: user.id,
    old_status: submission.verification_status,
    new_status: "verified",
    reason: "Verified from rent due tracker",
  });

  await supabase.from("rent_bill_audit_logs").insert({
    bill_id: bill.id,
    action: "verify_payment_submission",
    performed_by: user.id,
    old_status: bill.status,
    new_status: newStatus,
    old_paid_amount: oldPaidAmount,
    new_paid_amount: newPaidAmount,
    reason: submission.reference_number || "Tenant payment proof verified",
  });

  const fingerprintResult = bill.tenancy_id
    ? await extendFingerprintAccessAfterPayment({
        tenancyId: bill.tenancy_id,
        paymentSubmissionId: submission.id,
        performedBy: user.id,
      }).catch((fingerprintError) => {
        console.error("Verified rent could not update TTLock fingerprint access.", {
          tenancyId: bill.tenancy_id,
          paymentSubmissionId: submission.id,
          error: fingerprintError,
        });
        return null;
      })
    : null;
  if (fingerprintResult?.errors.length) {
    console.error("Some TTLock fingerprint credentials need attention.", {
      tenancyId: bill.tenancy_id,
      errors: fingerprintResult.errors,
    });
  }

  revalidatePath("/rent-due-tracker");
  revalidatePath("/dashboard");
  revalidatePath("/payment-verification");
  revalidatePath("/payments");
  redirect("/rent-due-tracker?verified=1");
}

export async function rejectRentSubmission(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "rent_due_tracker",
    level: "manage",
  });
  const user = await getCurrentUser();
  const submissionId = textValue(formData, "submissionId");
  const reason = textValue(formData, "reason");

  if (!user || !submissionId || !reason) {
    redirect("/rent-due-tracker?error=reject_missing");
  }

  const supabase = await getAdmin();
  const { data: submission } = await supabase
    .from("payment_submissions")
    .select("id, rent_bill_id, payment_type, verification_status")
    .eq("id", submissionId)
    .single();

  if (!submission || submission.verification_status === "verified") {
    redirect("/rent-due-tracker?error=already_verified");
  }

  if (
    submission.payment_type === "deposit" ||
    submission.payment_type === "rent_and_deposit"
  ) {
    redirect("/payment-verification?status=pending_verification");
  }

  await supabase
    .from("payment_submissions")
    .update({
      verification_status: "rejected",
      rejection_reason: reason,
      verified_by: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submission.id);

  if (submission.rent_bill_id) {
    const { data: bill } = await supabase
      .from("rent_bills")
      .select("paid_amount")
      .eq("id", submission.rent_bill_id)
      .single();

    await supabase
      .from("rent_bills")
      .update({
        status: Number(bill?.paid_amount ?? 0) > 0 ? "partially_paid" : "unpaid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.rent_bill_id)
      .neq("status", "paid");
  }

  await supabase.from("payment_verification_audit_logs").insert({
    payment_submission_id: submission.id,
    action: "rejected",
    performed_by: user.id,
    old_status: submission.verification_status,
    new_status: "rejected",
    reason,
  });

  revalidatePath("/rent-due-tracker");
  revalidatePath("/payment-verification");
  revalidatePath("/payments");
  redirect("/rent-due-tracker?rejected=1");
}
