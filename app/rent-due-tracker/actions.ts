"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { dayDifference, malaysiaDateString } from "@/lib/data/rent-due";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
  const { data: bill } = await supabase
    .from("rent_bills")
    .select("id, tenant_id, tenancy_id, tenant_record_id, property_id, unit_id, room_id, bill_month, due_date, amount, paid_amount, status, properties(name), units(name), rooms(name, room_number)")
    .eq("id", billId)
    .single();

  if (!bill) {
    return null;
  }

  let tenant: { id: string | null; full_name: string | null; phone: string | null } | null = null;

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
      tenant = {
        id: data.tenant_id ?? null,
        full_name: data.full_name,
        phone: data.phone,
      };
    }
  }

  return {
    ...bill,
    tenant,
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
  await requireRole(["super_admin", "admin"], {
    module: "rent_due_tracker",
    level: "manage",
  });
  const user = await getCurrentUser();
  const billId = textValue(formData, "billId");
  const amount = numberValue(formData, "amount");
  const paymentDate = textValue(formData, "paymentDate") || malaysiaDateString();
  const paymentMethod = textValue(formData, "paymentMethod") || "bank_transfer";
  const referenceNumber = textValue(formData, "referenceNumber");
  const receipt = fileValue(formData, "receipt");

  if (!user || !billId || amount <= 0 || !receipt) {
    redirect("/rent-due-tracker?error=proof_missing");
  }

  const isSupportedFile = receipt.type.startsWith("image/")
    || receipt.type === "application/pdf"
    || /\.(jpe?g|png|webp|heic|pdf)$/i.test(receipt.name);

  if (!isSupportedFile) {
    redirect("/rent-due-tracker?error=proof_type");
  }

  if (receipt.size > 10 * 1024 * 1024) {
    redirect("/rent-due-tracker?error=proof_size");
  }

  const supabase = await createClient();
  const bill = await getBillContext(supabase, billId);

  const submissionTenantId = bill?.tenant_id ?? bill?.tenant?.id ?? null;
  if (!bill || (!submissionTenantId && !bill.tenant_record_id) || ["paid", "cancelled", "waived"].includes(String(bill.status))) {
    redirect("/rent-due-tracker?error=bill_not_found");
  }

  const outstandingAmount = Math.max(Number(bill.amount ?? 0) - Number(bill.paid_amount ?? 0), 0);
  if (outstandingAmount <= 0.005) {
    redirect("/rent-due-tracker?error=bill_not_found");
  }

  if (amount > outstandingAmount + 0.005) {
    redirect("/rent-due-tracker?error=proof_amount");
  }

  const { data: pendingSubmission } = await supabase
    .from("payment_submissions")
    .select("id")
    .eq("rent_bill_id", bill.id)
    .eq("verification_status", "pending_verification")
    .limit(1)
    .maybeSingle();

  if (pendingSubmission) {
    redirect("/rent-due-tracker?error=proof_pending");
  }

  const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${user.id}/${bill.id}/rent-${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await receipt.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("payment-receipts")
    .upload(path, bytes, {
      contentType: receipt.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    redirect("/rent-due-tracker?error=proof_upload");
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
      bill_type: "monthly_rent",
      payment_type: "monthly_rent",
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
    await supabase.storage.from("payment-receipts").remove([path]);
    redirect("/rent-due-tracker?error=proof_create");
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
    await supabase.from("payment_submissions").delete().eq("id", submission.id);
    await supabase.storage.from("payment-receipts").remove([path]);
    redirect("/rent-due-tracker?error=proof_create");
  }

  await supabase
    .from("rent_bills")
    .update({
      status: "payment_submitted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", bill.id);

  revalidatePath("/rent-due-tracker");
  revalidatePath("/payment-verification");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  redirect("/rent-due-tracker?uploaded=1");
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

  const bill = submission.rent_bill_id ? await getBillContext(supabase, submission.rent_bill_id) : null;
  if (!bill) {
    redirect("/rent-due-tracker?error=bill_not_found");
  }

  const oldPaidAmount = Number(bill.paid_amount ?? 0);
  const billAmount = Number(bill.amount ?? 0);
  const submittedAmount = Number(submission.amount ?? 0);
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
    .select("id, rent_bill_id, verification_status")
    .eq("id", submissionId)
    .single();

  if (!submission || submission.verification_status === "verified") {
    redirect("/rent-due-tracker?error=already_verified");
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
