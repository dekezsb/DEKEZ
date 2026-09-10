"use server";

import { revalidatePath } from "next/cache";
import { supportsReservations } from "@/lib/tenancy/reservation-policy";
import { malaysiaDateString } from "@/lib/data/rent-due";
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
import { agreementTypeForProperty } from "@/lib/tenancy/agreement-types";
import {
  commercialDepositSchedule,
} from "@/lib/tenancy/commercial-deposit-policy";
import { PAYMENT_PURPOSES, type PaymentPurpose } from "@/lib/payments/payment-purpose";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

function paymentPurposeValue(formData: FormData) {
  const value = textValue(formData, "paymentPurpose");
  if ((PAYMENT_PURPOSES as readonly string[]).includes(value)) {
    return value as PaymentPurpose;
  }
  return null;
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
  await requireRole(["super_admin", "admin"], {
    module: "properties",
    level: "manage",
  });
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  const fullName = textValue(formData, "fullName");
  const identityType = textValue(formData, "identityType");
  const identificationNumber = textValue(formData, "identificationNumber");
  const phone = textValue(formData, "phone");
  const emergencyContactName = textValue(formData, "emergencyContactName");
  const emergencyContactNumber = textValue(
    formData,
    "emergencyContactNumber",
  );
  const submittedMonthlyRent = Math.max(
    0,
    numberValue(formData, "monthlyRent"),
  );
  const statedDeposit = Math.max(0, numberValue(formData, "deposit"));
  const contractStart = textValue(formData, "contractStart");
  const contractEnd = textValue(formData, "contractEnd") || null;
  const tenantType = textValue(formData, "tenantType") || "individual";
  const businessName = textValue(formData, "businessName");
  const businessRegistrationNumber = textValue(
    formData,
    "businessRegistrationNumber",
  );
  const registeredAddress = textValue(formData, "registeredAddress");
  const authorisedRepresentativeName = textValue(
    formData,
    "authorisedRepresentativeName",
  );
  const representativeIdentityNumber = textValue(
    formData,
    "representativeIdentityNumber",
  );
  const businessContactNumber = textValue(
    formData,
    "businessContactNumber",
  );
  const businessEmail = textValue(formData, "businessEmail");
  const icFront = formFile(formData, "icFront");
  const icBack = formFile(formData, "icBack");
  const passportPhoto = formFile(formData, "passportPhoto");
  const commercialSupportingDocument = formFile(
    formData,
    "commercialSupportingDocument",
  );
  const paymentSlip = formFile(formData, "paymentSlip");
  const paymentMethod = textValue(formData, "paymentMethod") || "online_payment";
  const selectedPaymentPurpose = paymentPurposeValue(formData);
  const paymentAmount = Math.max(0, numberValue(formData, "paymentAmount"));
  const paymentNote = textValue(formData, "paymentNote");
  const hasPaymentSlip = Boolean(paymentSlip);

  if (
    !user ||
    !propertyId ||
    !roomId ||
    !fullName ||
    !identificationNumber ||
    !phone ||
    !emergencyContactName ||
    !emergencyContactNumber ||
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
    ![
      icFront,
      icBack,
      passportPhoto,
      commercialSupportingDocument,
      paymentSlip,
    ].every(
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
  const isMonthlyStay = property.rental_model === "monthly_stay";
  const flexible = supportsReservations(property.property_code);
  const registrationMode = textValue(formData, "registrationMode") === "reservation" ? "reservation" : "check_in";
  if (registrationMode === "reservation" && !flexible) fail("property", propertyId, roomId);
  if (isMonthlyStay && !flexible && !paymentSlip) {
    fail("payment", propertyId, roomId);
  }
  if (flexible) {
    if (hasPaymentSlip && (!selectedPaymentPurpose || paymentAmount <= 0)) {
      fail("payment", propertyId, roomId);
    }
    if (paymentAmount > 0 && !hasPaymentSlip) {
      fail("payment", propertyId, roomId);
    }
  }
  if (property.is_commercial && !commercialSupportingDocument) {
    fail("commercial_document", propertyId, roomId);
  }
  if (
    property.is_commercial &&
    (!["company", "sole_proprietor"].includes(tenantType) ||
      !businessName ||
      !businessRegistrationNumber ||
      !registeredAddress ||
      !authorisedRepresentativeName ||
      !representativeIdentityNumber ||
      !businessContactNumber ||
      !businessEmail)
  ) {
    fail("missing", propertyId, roomId);
  }

  const supabase = await getAdmin();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, property_id, unit_id, status, monthly_rent")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();

  if (!room || room.status !== "vacant") {
    fail("occupied", propertyId);
  }

  const monthlyRent = property.is_commercial
    ? Math.max(0, Number(room.monthly_rent ?? 0))
    : submittedMonthlyRent;
  if (monthlyRent <= 0) {
    fail("missing", propertyId, roomId);
  }
  const commercialDeposits = commercialDepositSchedule(monthlyRent);
  const securityDeposit = isMonthlyStay
    ? 0
    : property.is_commercial
      ? commercialDeposits.securityDeposit
      : statedDeposit;
  const utilityDeposit =
    !isMonthlyStay && property.is_commercial
      ? commercialDeposits.utilityDeposit
      : 0;

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
      agreement_type: agreementTypeForProperty(property.is_commercial),
      tenant_type: property.is_commercial ? tenantType : "individual",
      business_name: property.is_commercial ? businessName : null,
      business_registration_number: property.is_commercial
        ? businessRegistrationNumber
        : null,
      registered_address: property.is_commercial ? registeredAddress : null,
      authorised_representative_name: property.is_commercial
        ? authorisedRepresentativeName
        : null,
      representative_identity_number: property.is_commercial
        ? representativeIdentityNumber
        : null,
      business_contact_number: property.is_commercial
        ? businessContactNumber
        : null,
      business_email: property.is_commercial ? businessEmail : null,
      submitted_by: user.id,
      submission_source: "admin_assisted",
      registration_mode: registrationMode,
      identity_type: identityType,
      property_id: property.id,
      unit_id: room.unit_id,
      room_id: room.id,
      full_name: fullName,
      ic_passport_number: identificationNumber,
      whatsapp_number: phone,
      emergency_contact_name: emergencyContactName,
      emergency_contact_number: emergencyContactNumber,
      proposed_start_date: contractStart,
      proposed_end_date: isMonthlyStay ? null : contractEnd,
      monthly_rent: monthlyRent,
      deposit: securityDeposit,
      utility_deposit: utilityDeposit,
      contract_duration_months: isMonthlyStay ? 1 : undefined,
      rental_model: property.rental_model,
      status: "submitted",
      verification_status: "pending_verification",
      payment_status: paymentSlip ? "pending_verification" : "unpaid",
      admin_notes:
        paymentNote ? `Registration payment note: ${paymentNote}` : null,
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

  if (hasPaymentSlip && paymentSlip) {
    const extension = paymentSlip.name.split(".").pop()?.toLowerCase() || "jpg";
    const receiptPath = `${user.id}/admin-registration/${application.id}/first-month-${crypto.randomUUID()}.${extension}`;
    const { error: receiptUploadError } = await supabase.storage
      .from("payment-receipts")
      .upload(receiptPath, Buffer.from(await paymentSlip.arrayBuffer()), {
        contentType: paymentSlip.type,
        upsert: false,
      });

    if (receiptUploadError) {
      await Promise.all([
        supabase.storage
          .from("tenant-documents")
          .remove(uploadedDocuments.map((document) => document.file_path)),
        supabase.from("tenant_documents").delete().eq("tenant_application_id", application.id),
        supabase.from("tenant_applications").delete().eq("id", application.id),
      ]);
      fail("payment", propertyId, roomId);
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payment_submissions")
      .insert({
        tenant_id: null,
        tenant_application_id: application.id,
        property_id: property.id,
        unit_id: room.unit_id,
        room_id: room.id,
        bill_type: "check_in",
        payment_type: selectedPaymentPurpose ?? "monthly_rent",
        instalment: flexible,
        payment_note: paymentNote || null,
        amount: paymentAmount,
        payment_date: textValue(formData, "paymentDate") || malaysiaDateString(),
        payment_method: paymentMethod,
        receipt_url: receiptPath,
        verification_status: "pending_verification",
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      await Promise.all([
        supabase.storage.from("payment-receipts").remove([receiptPath]),
        supabase.storage
          .from("tenant-documents")
          .remove(uploadedDocuments.map((document) => document.file_path)),
        supabase.from("tenant_documents").delete().eq("tenant_application_id", application.id),
        supabase.from("tenant_applications").delete().eq("id", application.id),
      ]);
      fail("payment", propertyId, roomId);
    }

    const { error: attachmentError } = await supabase
      .from("payment_attachments")
      .insert({
        payment_submission_id: payment.id,
        tenant_id: null,
        file_path: receiptPath,
        file_name: paymentSlip.name,
        content_type: paymentSlip.type,
      });

    if (attachmentError) {
      await Promise.all([
        supabase.from("payment_submissions").delete().eq("id", payment.id),
        supabase.storage.from("payment-receipts").remove([receiptPath]),
        supabase.storage
          .from("tenant-documents")
          .remove(uploadedDocuments.map((document) => document.file_path)),
        supabase.from("tenant_documents").delete().eq("tenant_application_id", application.id),
        supabase.from("tenant_applications").delete().eq("id", application.id),
      ]);
      fail("payment", propertyId, roomId);
    }
  }

  if (registrationMode === "reservation") {
    await supabase.from("rooms").update({ status: "reserved", updated_at: new Date().toISOString() }).eq("id", room.id).eq("status", "vacant");
    revalidatePath("/reservations");
  }
  revalidatePath("/register-tenant");
  revalidatePath("/verification");
  revalidatePath("/tenant-verification");
  revalidatePath("/properties");
  redirect("/register-tenant?submitted=1");
}
