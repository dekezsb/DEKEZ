"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import {
  isPaymentCategory,
  paymentCategoryLabel,
} from "@/lib/payments/payment-category";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const documentTypes = new Set([
  "ic_front",
  "ic_back",
  "passport_photo_page",
  "commercial_supporting_document",
]);

const allowedContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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

function destination(
  tenantKey: string,
  propertyId: string,
  roomId: string,
  returnView: string,
  result: string,
) {
  const base =
    returnView === "room"
      ? `/properties/${propertyId}/rooms/${roomId}`
      : `/tenants/${tenantKey}`;
  return `${base}?document=${result}`;
}

export async function uploadTenantDocument(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const tenantKey = textValue(formData, "tenantKey");
  const tenantRecordId = textValue(formData, "tenantRecordId");
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const returnView = textValue(formData, "returnView");
  const documentType = textValue(formData, "documentType");
  const document = fileValue(formData, "document");
  const fallbackDestination = destination(
    tenantKey,
    propertyId,
    roomId,
    returnView,
    "invalid",
  );

  if (
    !user ||
    !tenantKey ||
    !tenantRecordId ||
    !propertyId ||
    !roomId ||
    !documentTypes.has(documentType) ||
    !document
  ) {
    redirect(fallbackDestination);
  }

  if (
    document.size > 10 * 1024 * 1024 ||
    !allowedContentTypes.has(document.type)
  ) {
    redirect(
      destination(tenantKey, propertyId, roomId, returnView, "file_type"),
    );
  }

  const property = (await getProperties()).find((item) => item.id === propertyId);
  if (!property) {
    redirect("/properties");
  }

  const supabase = await getAdmin();
  const { data: tenantRecord } = await supabase
    .from("tenant_records")
    .select("id")
    .eq("id", tenantRecordId)
    .eq("property_id", propertyId)
    .eq("room_id", roomId)
    .maybeSingle();

  if (!tenantRecord) {
    redirect(fallbackDestination);
  }

  const safeName = document.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = `${user.id}/profiles/${tenantRecord.id}/${crypto.randomUUID()}/${documentType}-${safeName}`;
  const bytes = Buffer.from(await document.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("tenant-documents")
    .upload(filePath, bytes, {
      contentType: document.type,
      upsert: false,
    });

  if (uploadError) {
    redirect(destination(tenantKey, propertyId, roomId, returnView, "upload"));
  }

  const { error: recordError } = await supabase.from("tenant_documents").insert({
    tenant_application_id: null,
    tenant_id: null,
    tenant_record_id: tenantRecord.id,
    document_type: documentType,
    file_path: filePath,
    file_name: document.name,
    content_type: document.type,
    verification_status: "pending_verification",
    uploaded_by: user.id,
  });

  if (recordError) {
    await supabase.storage.from("tenant-documents").remove([filePath]);
    redirect(destination(tenantKey, propertyId, roomId, returnView, "upload"));
  }

  revalidatePath(`/tenants/${tenantKey}`);
  revalidatePath(`/properties/${propertyId}/rooms/${roomId}`);
  redirect(destination(tenantKey, propertyId, roomId, returnView, "uploaded"));
}

export async function deleteTenantDocument(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const documentId = textValue(formData, "documentId");
  const tenantKey = textValue(formData, "tenantKey");
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const returnView = textValue(formData, "returnView");
  const go = (result: string) =>
    destination(tenantKey, propertyId, roomId, returnView, result);

  if (!user || !documentId || !tenantKey || !propertyId || !roomId) {
    redirect(go("delete_invalid"));
  }

  const property = (await getProperties()).find((item) => item.id === propertyId);
  if (!property) {
    redirect("/properties");
  }

  const supabase = await getAdmin();
  const [documentResult, selectedRecordResult, selectedTenancyResult] =
    await Promise.all([
      supabase
        .from("tenant_documents")
        .select(
          "id, tenant_application_id, tenant_id, tenant_record_id, document_type, file_path, file_name, verification_status",
        )
        .eq("id", documentId)
        .maybeSingle(),
      supabase
        .from("tenant_records")
        .select("id, tenant_id")
        .eq("id", tenantKey)
        .eq("property_id", propertyId)
        .eq("room_id", roomId)
        .maybeSingle(),
      supabase
        .from("tenancies")
        .select("tenant_id")
        .eq("tenant_id", tenantKey)
        .eq("property_id", propertyId)
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  const document = documentResult.data;
  const selectedRecord = selectedRecordResult.data;
  const selectedTenantId =
    selectedRecord?.tenant_id ?? selectedTenancyResult.data?.tenant_id ?? null;

  if (
    documentResult.error ||
    selectedRecordResult.error ||
    selectedTenancyResult.error ||
    !document ||
    (!selectedRecord && !selectedTenantId)
  ) {
    redirect(go("delete_invalid"));
  }

  const [relatedRecordsResult, relatedTenantResult] = await Promise.all([
    selectedTenantId
      ? supabase
          .from("tenant_records")
          .select("id")
          .eq("tenant_id", selectedTenantId)
      : Promise.resolve({
          data: selectedRecord ? [{ id: selectedRecord.id }] : [],
          error: null,
        }),
    selectedTenantId
      ? supabase
          .from("tenants")
          .select("id, profile_id")
          .eq("id", selectedTenantId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (relatedRecordsResult.error || relatedTenantResult.error) {
    redirect(go("delete_invalid"));
  }

  const tenantRecordIds = new Set(
    (relatedRecordsResult.data ?? []).map((record) => record.id),
  );
  const allowedTenantDocumentIds = new Set(
    [selectedTenantId, relatedTenantResult.data?.profile_id].filter(
      (id): id is string => Boolean(id),
    ),
  );
  let applicationMatchesRoom = false;

  if (document.tenant_application_id) {
    const { data: application } = await supabase
      .from("tenant_applications")
      .select("id, tenant_id")
      .eq("id", document.tenant_application_id)
      .eq("property_id", propertyId)
      .eq("room_id", roomId)
      .maybeSingle();
    applicationMatchesRoom = Boolean(
      application && allowedTenantDocumentIds.has(application.tenant_id),
    );
  }

  const belongsToDisplayedTenant =
    (document.tenant_record_id &&
      tenantRecordIds.has(document.tenant_record_id)) ||
    (document.tenant_id &&
      allowedTenantDocumentIds.has(document.tenant_id)) ||
    applicationMatchesRoom;

  if (!belongsToDisplayedTenant) {
    redirect(go("delete_invalid"));
  }

  const { error: deleteError } = await supabase
    .from("tenant_documents")
    .delete()
    .eq("id", document.id);

  if (deleteError) {
    redirect(go("delete_failed"));
  }

  const { error: storageError } = await supabase.storage
    .from("tenant-documents")
    .remove([document.file_path]);

  await supabase.from("audit_logs").insert({
    company_id: property.company_id,
    actor_profile_id: user.id,
    action: "tenant_document_deleted",
    entity_table: "tenant_documents",
    entity_id: document.id,
    metadata: {
      document_type: document.document_type,
      file_name: document.file_name,
      previous_status: document.verification_status,
      property_id: propertyId,
      room_id: roomId,
      storage_removed: !storageError,
    },
  });

  revalidatePath(`/tenants/${tenantKey}`);
  revalidatePath(`/properties/${propertyId}/rooms/${roomId}`);
  redirect(go(storageError ? "delete_cleanup" : "deleted"));
}

function paymentDestination(
  tenantKey: string,
  propertyId: string,
  roomId: string,
  returnView: string,
  result: string,
) {
  const base =
    returnView === "room"
      ? `/properties/${propertyId}/rooms/${roomId}`
      : `/tenants/${tenantKey}`;
  return `${base}?payment=${result}`;
}

export async function updatePaymentPurpose(formData: FormData) {
  await requireRole(["super_admin"]);
  const user = await getCurrentUser();
  const paymentId = textValue(formData, "paymentId");
  const tenantKey = textValue(formData, "tenantKey");
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const returnView = textValue(formData, "returnView");
  const category = textValue(formData, "category");
  const correctionReason = textValue(formData, "correctionReason");
  const go = (result: string) =>
    paymentDestination(
      tenantKey,
      propertyId,
      roomId,
      returnView,
      result,
    );

  if (
    !user ||
    !paymentId ||
    !tenantKey ||
    !propertyId ||
    !roomId ||
    !isPaymentCategory(category) ||
    !correctionReason
  ) {
    redirect(go("invalid"));
  }

  const supabase = await getAdmin();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, category, notes, status, reversed_at")
    .eq("id", paymentId)
    .eq("property_id", propertyId)
    .eq("room_id", roomId)
    .maybeSingle();

  if (!payment) {
    redirect(go("missing"));
  }

  if (payment.status === "cancelled" || payment.reversed_at) {
    redirect(go("locked"));
  }

  const oldCategory = payment.category ?? "not_categorised";
  const auditEntry = [
    `[${new Date().toISOString()}] Purpose corrected by Super Admin ${user.id}:`,
    `${paymentCategoryLabel(oldCategory)} -> ${paymentCategoryLabel(category)}.`,
    `Reason: ${correctionReason}`,
  ].join(" ");
  const notes = [payment.notes?.trim(), auditEntry].filter(Boolean).join("\n");

  const { error } = await supabase
    .from("payments")
    .update({
      category,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);

  if (error) {
    redirect(go("failed"));
  }

  revalidatePath(`/tenants/${tenantKey}`);
  revalidatePath(`/properties/${propertyId}/rooms/${roomId}`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/payment-verification");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/dashboard");
  redirect(go("updated"));
}
