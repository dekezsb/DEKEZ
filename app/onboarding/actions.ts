"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { addMonths } from "@/lib/e-tenancy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

async function uploadDocument(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  userId: string,
  applicationId: string,
  documentType: "ic_front" | "ic_back" | "passport_photo_page",
  file: File,
) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${userId}/${applicationId}/${documentType}-${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from("tenant-documents").upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });

  if (error) {
    throw error;
  }

  await supabase.from("tenant_documents").insert({
    tenant_application_id: applicationId,
    tenant_id: userId,
    document_type: documentType,
    file_path: path,
    file_name: file.name,
    content_type: file.type || null,
  });
}

export async function submitTenantApplication(formData: FormData) {
  await requireRole(["tenant"]);
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const propertyId = textValue(formData, "propertyId");
  const unitId = textValue(formData, "unitId");
  const roomId = textValue(formData, "roomId");
  const fullName = textValue(formData, "fullName");
  const duration = numberValue(formData, "contractDurationMonths", 12);
  const proposedStartDate = textValue(formData, "proposedStartDate") || new Date().toISOString().slice(0, 10);
  const monthlyRent = numberValue(formData, "monthlyRent");
  const deposit = numberValue(formData, "deposit");
  const utilityDeposit = numberValue(formData, "utilityDeposit");

  if (!propertyId || !roomId || !fullName || ![6, 12].includes(duration)) {
    redirect("/onboarding?error=missing");
  }

  const icFront = fileValue(formData, "icFront");
  const icBack = fileValue(formData, "icBack");
  const passportPhoto = fileValue(formData, "passportPhoto");

  if (!icFront && !passportPhoto) {
    redirect("/onboarding?error=document");
  }

  const supabase = await getAdmin();
  const [{ data: room }, { data: property }] = await Promise.all([
    supabase.from("rooms").select("id, status, monthly_rent").eq("id", roomId).maybeSingle(),
    supabase.from("properties").select("id, default_contract_duration_months").eq("id", propertyId).maybeSingle(),
  ]);

  if (!room || !property || room.status === "occupied") {
    redirect("/onboarding?error=room");
  }

  const finalDuration = [6, 12].includes(duration) ? duration : Number(property.default_contract_duration_months ?? 12);
  const { data: application, error } = await supabase
    .from("tenant_applications")
    .insert({
      tenant_id: user.id,
      property_id: propertyId,
      unit_id: unitId || null,
      room_id: roomId,
      full_name: fullName,
      ic_passport_number: textValue(formData, "icPassportNumber") || null,
      nationality: textValue(formData, "nationality") || null,
      date_of_birth: textValue(formData, "dateOfBirth") || null,
      whatsapp_number: textValue(formData, "whatsappNumber") || user.phone || null,
      emergency_contact_name: textValue(formData, "emergencyContactName") || null,
      emergency_contact_number: textValue(formData, "emergencyContactNumber") || null,
      contract_duration_months: finalDuration,
      proposed_start_date: proposedStartDate,
      proposed_end_date: addMonths(proposedStartDate, finalDuration),
      monthly_rent: monthlyRent || Number(room.monthly_rent ?? 0),
      deposit,
      utility_deposit: utilityDeposit,
      status: "pending_verification",
      verification_status: "pending_verification",
      payment_status: "unpaid",
    })
    .select("id")
    .single();

  if (error || !application) {
    redirect("/onboarding?error=create");
  }

  await supabase.from("profiles").upsert({
    id: user.id,
    full_name: fullName,
    phone: textValue(formData, "whatsappNumber") || user.phone || null,
    role: "tenant",
  });

  try {
    if (icFront) {
      await uploadDocument(supabase, user.id, application.id, "ic_front", icFront);
    }
    if (icBack) {
      await uploadDocument(supabase, user.id, application.id, "ic_back", icBack);
    }
    if (passportPhoto) {
      await uploadDocument(supabase, user.id, application.id, "passport_photo_page", passportPhoto);
    }
  } catch {
    redirect("/onboarding?error=upload");
  }

  revalidatePath("/onboarding");
  revalidatePath("/tenant-verification");
  redirect("/onboarding?submitted=1");
}

export async function submitCheckInPayment(formData: FormData) {
  await requireRole(["tenant"]);
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const applicationId = textValue(formData, "applicationId");
  const amount = numberValue(formData, "amount");
  const receipt = fileValue(formData, "receipt");

  if (!applicationId || amount <= 0 || !receipt) {
    redirect("/onboarding?error=payment_missing");
  }

  const supabase = await getAdmin();
  const { data: application } = await supabase
    .from("tenant_applications")
    .select("id, tenant_id, property_id, unit_id, room_id")
    .eq("id", applicationId)
    .eq("tenant_id", user.id)
    .maybeSingle();

  if (!application) {
    redirect("/onboarding?error=payment_missing");
  }

  const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${user.id}/${application.id}/check-in-${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await receipt.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from("payment-receipts").upload(path, bytes, {
    contentType: receipt.type || "application/octet-stream",
    upsert: true,
  });

  if (uploadError) {
    redirect("/onboarding?error=payment_upload");
  }

  const { data: submission, error } = await supabase
    .from("payment_submissions")
    .insert({
      tenant_id: user.id,
      tenant_application_id: application.id,
      property_id: application.property_id,
      unit_id: application.unit_id,
      room_id: application.room_id,
      bill_type: "check_in",
      payment_type: textValue(formData, "paymentType") || "rental_deposit",
      amount,
      payment_date: textValue(formData, "paymentDate") || new Date().toISOString().slice(0, 10),
      payment_method: textValue(formData, "paymentMethod") || "bank_transfer",
      reference_number: textValue(formData, "referenceNumber") || null,
      receipt_url: path,
      verification_status: "pending_verification",
    })
    .select("id")
    .single();

  if (error || !submission) {
    redirect("/onboarding?error=payment_create");
  }

  await supabase.from("payment_attachments").insert({
    payment_submission_id: submission.id,
    tenant_id: user.id,
    file_path: path,
    file_name: receipt.name,
    content_type: receipt.type || null,
  });

  await supabase
    .from("tenant_applications")
    .update({ payment_status: "pending_verification", updated_at: new Date().toISOString() })
    .eq("id", application.id);

  revalidatePath("/onboarding");
  revalidatePath("/payment-verification");
  redirect("/onboarding?payment=1");
}
