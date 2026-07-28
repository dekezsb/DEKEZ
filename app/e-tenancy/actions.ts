"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { agreementPdfName } from "@/lib/tenancy/agreement-filename";
import { createSignedAgreementPdf } from "@/lib/tenancy/agreement-pdf";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function single<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
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
    redirect(`/e-tenancy/${agreementId}?error=signature_missing`);
  }

  const supabase = await getAdmin();
  const { data: agreement } = await supabase
    .from("tenancy_agreements")
    .select("id, rendered_content, tenancy_id, agreement_type, term_start_date, term_end_date, tenancies(tenant_id, tenants(profile_id, full_name), properties(property_code, name), rooms(room_number, name))")
    .eq("id", agreementId)
    .single();

  const tenancy = Array.isArray(agreement?.tenancies) ? agreement?.tenancies[0] : agreement?.tenancies;
  const tenant = single(tenancy?.tenants);
  const property = single(tenancy?.properties);
  const room = single(tenancy?.rooms);
  if (!agreement || tenant?.profile_id !== user.id) {
    redirect("/dashboard");
  }

  const signedAt = new Date().toISOString();
  const signatureBytes = Buffer.from(signatureData.split(",")[1] ?? "", "base64");
  const signaturePath = `${user.id}/${agreement.id}/signature-${Date.now()}.png`;
  await supabase.storage.from("tenancy-signatures").upload(signaturePath, signatureBytes, {
    contentType: "image/png",
    upsert: true,
  });

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
  const pdfBytes = await createSignedAgreementPdf({
    content: signedContent,
    signerName,
    signedAt,
    signatureBytes,
  });
  const pdfFileName = agreementPdfName({
    tenantName: tenant.full_name,
    propertyCode: property?.property_code ?? property?.name,
    roomNumber: room?.room_number ?? room?.name,
    termStartDate: agreement.term_start_date,
  });
  const pdfPath = `${user.id}/${agreement.id}/${pdfFileName}`;
  await supabase.storage.from("tenancy-agreements").upload(pdfPath, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });

  const requestHeaders = await headers();
  await supabase.from("tenancy_agreement_signatures").insert({
    agreement_id: agreement.id,
    tenant_id: user.id,
    signature_url: signaturePath,
    signed_at: signedAt,
    ip_address: requestHeaders.get("x-forwarded-for") ?? null,
    user_agent: requestHeaders.get("user-agent") ?? null,
  });

  await supabase
    .from("tenancy_agreements")
    .update({
      status: agreement.agreement_type === "renewal" ? "renewal_signed" : "signed",
      signed_at: signedAt,
      pdf_url: pdfPath,
      rendered_content: signedContent,
    })
    .eq("id", agreement.id);

  if (
    agreement.agreement_type === "renewal" &&
    agreement.term_start_date &&
    agreement.term_end_date
  ) {
    await supabase
      .from("tenancies")
      .update({
        tenancy_start_date: agreement.term_start_date,
        tenancy_end_date: agreement.term_end_date,
        contract_start: agreement.term_start_date,
        contract_end: agreement.term_end_date,
        renewal_status: "signed",
        updated_at: signedAt,
      })
      .eq("id", agreement.tenancy_id);
  }

  revalidatePath("/e-tenancy");
  revalidatePath("/verification");
  revalidatePath("/verification?view=agreements");
  revalidatePath(`/e-tenancy/${agreement.id}`);
  redirect(`/e-tenancy/${agreement.id}?signed=1`);
}
