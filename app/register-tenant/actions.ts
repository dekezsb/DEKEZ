"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  formFile,
  isValidTenantDocument,
  type TenantDocumentType,
  uploadTenantDocuments,
} from "@/lib/tenant-documents";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function fail(code: string, propertyId = "", roomId = ""): never {
  const params = new URLSearchParams({ error: code });
  if (propertyId) params.set("property", propertyId);
  if (roomId) params.set("room", roomId);
  redirect(`/register-tenant?${params.toString()}`);
}

export async function submitAdminTenantApplication(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const fullName = textValue(formData, "fullName");
  const identityType = textValue(formData, "identityType");
  const identificationNumber = textValue(formData, "identificationNumber");
  const phone = textValue(formData, "phone");
  const monthlyRent = Math.max(0, numberValue(formData, "monthlyRent"));
  const deposit = Math.max(0, numberValue(formData, "deposit"));
  const contractStart = textValue(formData, "contractStart");
  const contractEnd = textValue(formData, "contractEnd") || null;
  const icFront = formFile(formData, "icFront");
  const icBack = formFile(formData, "icBack");
  const passportPhoto = formFile(formData, "passportPhoto");
  const commercialSupportingDocument = formFile(
    formData,
    "commercialSupportingDocument",
  );

  if (
    !user ||
    !propertyId ||
    !roomId ||
    !fullName ||
    !identificationNumber ||
    !phone ||
    !contractStart ||
    !["ic", "passport"].includes(identityType)
  ) {
    fail("missing", propertyId, roomId);
  }

  if (contractEnd && contractEnd < contractStart) {
    fail("dates", propertyId, roomId);
  }

  if (
    (identityType === "ic" && !(icFront && icBack)) ||
    (identityType === "passport" && !passportPhoto)
  ) {
    fail("document", propertyId, roomId);
  }

  if (
    ![icFront, icBack, passportPhoto, commercialSupportingDocument].every(
      isValidTenantDocument,
    )
  ) {
    fail("upload", propertyId, roomId);
  }

  const property = (await getProperties()).find(
    (candidate) => candidate.id === propertyId,
  );
  if (!property) {
    fail("property");
  }
  if (property.is_commercial && !commercialSupportingDocument) {
    fail("commercial_document", propertyId, roomId);
  }

  const supabase = await getAdmin();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, property_id, unit_id, status")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();

  if (!room || room.status !== "vacant") {
    fail("occupied", propertyId);
  }

  const { data: existingApplications } = await supabase
    .from("tenant_applications")
    .select("id")
    .eq("room_id", room.id)
    .in("status", ["submitted", "pending_verification", "approved"])
    .limit(1);

  if (existingApplications?.length) {
    fail("pending", propertyId, roomId);
  }

  const documents = [
    icFront ? { documentType: "ic_front" as const, file: icFront } : null,
    icBack ? { documentType: "ic_back" as const, file: icBack } : null,
    passportPhoto
      ? { documentType: "passport_photo_page" as const, file: passportPhoto }
      : null,
    commercialSupportingDocument
      ? {
          documentType: "commercial_supporting_document" as const,
          file: commercialSupportingDocument,
        }
      : null,
  ].filter(
    (
      document,
    ): document is { documentType: TenantDocumentType; file: File } =>
      document !== null,
  );

  let uploadedDocuments: Awaited<ReturnType<typeof uploadTenantDocuments>>;
  try {
    uploadedDocuments = await uploadTenantDocuments(
      supabase,
      user.id,
      crypto.randomUUID(),
      documents,
    );
  } catch {
    fail("upload", propertyId, roomId);
  }

  const { data: application, error: applicationError } = await supabase
    .from("tenant_applications")
    .insert({
      tenant_id: null,
      submitted_by: user.id,
      submission_source: "admin_assisted",
      identity_type: identityType,
      property_id: property.id,
      unit_id: room.unit_id,
      room_id: room.id,
      full_name: fullName,
      ic_passport_number: identificationNumber,
      whatsapp_number: phone,
      proposed_start_date: contractStart,
      proposed_end_date: contractEnd,
      monthly_rent: monthlyRent,
      deposit,
      status: "submitted",
      verification_status: "pending_verification",
      payment_status: "unpaid",
    })
    .select("id")
    .single();

  if (applicationError || !application) {
    await supabase.storage
      .from("tenant-documents")
      .remove(uploadedDocuments.map((document) => document.file_path));
    fail(
      applicationError?.code === "23505" ? "pending" : "submit",
      propertyId,
      roomId,
    );
  }

  const { error: documentError } = await supabase
    .from("tenant_documents")
    .insert(
      uploadedDocuments.map((document) => ({
        ...document,
        tenant_application_id: application.id,
        tenant_id: null,
        tenant_record_id: null,
        uploaded_by: user.id,
      })),
    );

  if (documentError) {
    await Promise.all([
      supabase
        .storage
        .from("tenant-documents")
        .remove(uploadedDocuments.map((document) => document.file_path)),
      supabase.from("tenant_applications").delete().eq("id", application.id),
    ]);
    fail("upload", propertyId, roomId);
  }

  revalidatePath("/register-tenant");
  revalidatePath("/verification");
  revalidatePath("/tenant-verification");
  revalidatePath("/properties");
  redirect("/register-tenant?submitted=1");
}
