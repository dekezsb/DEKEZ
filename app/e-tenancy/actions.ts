"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { agreementPdfName } from "@/lib/tenancy/agreement-filename";
import { loadAgreementAppendixDocuments } from "@/lib/tenancy/agreement-appendix";
import { createSignedAgreementPdf } from "@/lib/tenancy/agreement-pdf";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function signingError(
  agreementId: string,
  code:
    | "agreement_unavailable"
    | "already_signed"
    | "configuration"
    | "pdf_generation"
    | "save_failed"
    | "signature_invalid"
    | "signature_missing"
    | "upload_failed",
): never {
  redirect(
    `/e-tenancy/${encodeURIComponent(agreementId)}?error=${encodeURIComponent(code)}`,
  );
}

export async function signAgreement(formData: FormData) {
  await requireRole(["tenant"], {
    module: "tenancy_agreements",
    level: "manage",
  });
  const user = await getCurrentUser();
  const agreementId = textValue(formData, "agreementId");
  const signatureData = textValue(formData, "signatureData");
  const confirm = textValue(formData, "confirmAgreement");

  if (!user || !agreementId || !signatureData || confirm !== "on") {
    signingError(agreementId, "signature_missing");
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    console.error("Unable to initialize tenancy signing.", error);
    signingError(agreementId, "configuration");
  }

  const { data: agreement, error: agreementError } = await supabase
    .from("tenancy_agreements")
    .select(
      "id, rendered_content, tenancy_id, term_type, agreement_type, status, term_start_date, term_end_date, monthly_rent_snapshot",
    )
    .eq("id", agreementId)
    .maybeSingle();

  if (agreementError || !agreement) {
    console.error("Unable to load agreement for signing.", {
      agreementId,
      error: agreementError?.message,
    });
    signingError(agreementId, "agreement_unavailable");
  }

  if (["signed", "renewal_signed"].includes(agreement.status)) {
    signingError(agreementId, "already_signed");
  }

  const signableStatuses = [
    "pending_signature",
    "renewal_pending",
    "renewal_sent",
  ];
  if (!signableStatuses.includes(agreement.status)) {
    signingError(agreementId, "agreement_unavailable");
  }

  const { data: tenancy, error: tenancyError } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, room_id")
    .eq("id", agreement.tenancy_id)
    .maybeSingle();

  if (tenancyError || !tenancy) {
    console.error("Unable to load tenancy for signing.", {
      agreementId,
      error: tenancyError?.message,
    });
    signingError(agreementId, "agreement_unavailable");
  }

  const [tenantResult, propertyResult, roomResult, signatureResult] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("id, profile_id, full_name")
        .eq("id", tenancy.tenant_id)
        .maybeSingle(),
      supabase
        .from("properties")
        .select("id, property_code, name")
        .eq("id", tenancy.property_id)
        .maybeSingle(),
      supabase
        .from("rooms")
        .select("id, room_number, name")
        .eq("id", tenancy.room_id)
        .maybeSingle(),
      supabase
        .from("tenancy_agreement_signatures")
        .select("id")
        .eq("agreement_id", agreement.id)
        .maybeSingle(),
    ]);

  const tenant = tenantResult.data;
  const property = propertyResult.data;
  const room = roomResult.data;

  if (
    tenantResult.error ||
    !tenant ||
    tenant.profile_id !== user.id
  ) {
    console.error("Tenant is not authorized to sign this agreement.", {
      agreementId,
      tenantError: tenantResult.error?.message,
    });
    signingError(agreementId, "agreement_unavailable");
  }

  if (signatureResult.error) {
    console.error("Unable to check existing agreement signature.", {
      agreementId,
      error: signatureResult.error.message,
    });
    signingError(agreementId, "save_failed");
  }
  if (signatureResult.data) {
    signingError(agreementId, "already_signed");
  }

  const signatureMatch = signatureData.match(
    /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!signatureMatch) {
    signingError(agreementId, "signature_invalid");
  }

  const signatureBytes = Buffer.from(signatureMatch[1], "base64");
  if (signatureBytes.length < 100 || signatureBytes.length > 5 * 1024 * 1024) {
    signingError(agreementId, "signature_invalid");
  }

  const signedAt = new Date().toISOString();
  const signaturePath = `${user.id}/${agreement.id}/signature-${Date.now()}.png`;
  const { error: signatureUploadError } = await supabase.storage
    .from("tenancy-signatures")
    .upload(signaturePath, signatureBytes, {
      contentType: "image/png",
      upsert: false,
    });

  if (signatureUploadError) {
    console.error("Unable to upload tenancy signature.", {
      agreementId,
      error: signatureUploadError.message,
    });
    signingError(agreementId, "upload_failed");
  }

  const signerName =
    tenant.full_name ??
    user.user_metadata?.full_name ??
    user.phone ??
    user.email ??
    user.id;
  const signedContent = agreement.rendered_content.replace(
    "[Pending tenant signature]",
    `Signed digitally by ${signerName}`,
  );
  const appendixDocuments = await loadAgreementAppendixDocuments(supabase, {
    tenancyId: agreement.tenancy_id,
    tenantProfileId: tenant.profile_id,
  });
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await createSignedAgreementPdf({
      content: signedContent,
      signerName,
      signedAt,
      signatureBytes,
      appendixDocuments,
    });
  } catch (error) {
    await supabase.storage
      .from("tenancy-signatures")
      .remove([signaturePath]);
    console.error("Unable to generate signed tenancy agreement PDF.", {
      agreementId,
      error,
    });
    signingError(agreementId, "pdf_generation");
  }

  const pdfFileName = agreementPdfName({
    tenantName: tenant.full_name,
    propertyCode: property?.property_code ?? property?.name,
    roomNumber: room?.room_number ?? room?.name,
    termStartDate: agreement.term_start_date,
  });
  const pdfPath = `${user.id}/${agreement.id}/${pdfFileName}`;
  const { error: pdfUploadError } = await supabase.storage
    .from("tenancy-agreements")
    .upload(pdfPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (pdfUploadError) {
    await supabase.storage
      .from("tenancy-signatures")
      .remove([signaturePath]);
    console.error("Unable to upload signed tenancy agreement PDF.", {
      agreementId,
      error: pdfUploadError.message,
    });
    signingError(agreementId, "upload_failed");
  }

  const requestHeaders = await headers();
  const { data: signatureRecord, error: signatureInsertError } = await supabase
    .from("tenancy_agreement_signatures")
    .insert({
      agreement_id: agreement.id,
      tenant_id: user.id,
      signature_url: signaturePath,
      signed_at: signedAt,
      ip_address: requestHeaders.get("x-forwarded-for") ?? null,
      user_agent: requestHeaders.get("user-agent") ?? null,
    })
    .select("id")
    .single();

  if (signatureInsertError || !signatureRecord) {
    await Promise.all([
      supabase.storage.from("tenancy-signatures").remove([signaturePath]),
      supabase.storage.from("tenancy-agreements").remove([pdfPath]),
    ]);
    console.error("Unable to save tenancy signature record.", {
      agreementId,
      error: signatureInsertError?.message,
    });
    signingError(agreementId, "save_failed");
  }

  const { data: updatedAgreement, error: agreementUpdateError } = await supabase
    .from("tenancy_agreements")
    .update({
      status: agreement.term_type === "renewal" ? "renewal_signed" : "signed",
      signed_at: signedAt,
      pdf_url: pdfPath,
      rendered_content: signedContent,
    })
    .eq("id", agreement.id)
    .in("status", signableStatuses)
    .select("id")
    .maybeSingle();

  if (agreementUpdateError || !updatedAgreement) {
    await Promise.all([
      supabase
        .from("tenancy_agreement_signatures")
        .delete()
        .eq("id", signatureRecord.id),
      supabase.storage.from("tenancy-signatures").remove([signaturePath]),
      supabase.storage.from("tenancy-agreements").remove([pdfPath]),
    ]);
    console.error("Unable to finalize signed tenancy agreement.", {
      agreementId,
      error: agreementUpdateError?.message,
    });
    signingError(agreementId, "save_failed");
  }

  if (
    agreement.term_type === "renewal" &&
    agreement.term_start_date &&
    agreement.term_end_date
  ) {
    const { error: renewalUpdateError } = await supabase
      .from("tenancies")
      .update({
        tenancy_start_date: agreement.term_start_date,
        tenancy_end_date: agreement.term_end_date,
        contract_start: agreement.term_start_date,
        contract_end: agreement.term_end_date,
        monthly_rental: agreement.monthly_rent_snapshot,
        renewal_status: "signed",
        updated_at: signedAt,
      })
      .eq("id", agreement.tenancy_id);

    if (renewalUpdateError) {
      console.error("Signed renewal did not update the tenancy dates.", {
        agreementId,
        error: renewalUpdateError.message,
      });
    }
  }

  revalidatePath("/e-tenancy");
  revalidatePath("/verification");
  revalidatePath("/verification?view=agreements");
  revalidatePath(`/e-tenancy/${agreement.id}`);
  redirect(`/e-tenancy/${agreement.id}?signed=1`);
}
