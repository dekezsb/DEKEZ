"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const documentTypes = new Set([
  "ic_front",
  "ic_back",
  "passport_photo_page",
]);
const allowedContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function updateManagementBankDetails(formData: FormData) {
  const { role, user } = await getCurrentUserAccess();

  if (role !== "admin") {
    redirect("/dashboard?error=access_denied");
  }

  const bankName = String(formData.get("bankName") ?? "").trim();
  const accountHolder = String(formData.get("accountHolder") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();

  if (!bankName || !accountHolder || !accountNumber) {
    redirect("/staff/profile?error=bank_required");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      bank_name: bankName,
      bank_account_holder: accountHolder,
      bank_account_number: accountNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    redirect("/staff/profile?error=bank_save");
  }

  revalidatePath("/staff/profile");
  redirect("/staff/profile?saved=bank");
}

export async function uploadManagementIdentityDocument(formData: FormData) {
  const { role, user } = await getCurrentUserAccess();

  if (role !== "admin") {
    redirect("/dashboard?error=access_denied");
  }

  const documentType = String(formData.get("documentType") ?? "");
  const file = formData.get("document");

  if (
    !documentTypes.has(documentType) ||
    !(file instanceof File) ||
    file.size === 0
  ) {
    redirect("/staff/profile?error=document_required");
  }

  if (
    file.size > 10 * 1024 * 1024 ||
    !allowedContentTypes.has(file.type)
  ) {
    redirect("/staff/profile?error=document_invalid");
  }

  const admin = createAdminClient();
  const filePath = `profiles/${user.id}/${documentType}/${randomUUID()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await admin.storage
    .from("tenant-documents")
    .upload(filePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    redirect("/staff/profile?error=document_upload");
  }

  const { error: recordError } = await admin.from("profile_documents").insert({
    profile_id: user.id,
    document_type: documentType,
    file_path: filePath,
    file_name: file.name,
    content_type: file.type,
    verification_status: "pending_verification",
  });

  if (recordError) {
    await admin.storage.from("tenant-documents").remove([filePath]);
    redirect("/staff/profile?error=document_save");
  }

  revalidatePath("/staff/profile");
  redirect("/staff/profile?uploaded=1");
}
