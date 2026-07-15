"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import {
  addMonths,
  createSignedPdfBytes,
  defaultAgreementTemplate,
  money,
  renderAgreementTemplate,
} from "@/lib/e-tenancy";
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

export async function createAgreementTemplate(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"]);
  const user = await getCurrentUser();
  const propertyId = textValue(formData, "propertyId");
  const name = textValue(formData, "name");
  const content = textValue(formData, "templateContent") || defaultAgreementTemplate;
  const isActive = textValue(formData, "isActive") === "on";

  if (!user || !propertyId || !name) {
    redirect("/e-tenancy?error=template_missing");
  }

  const supabase = await getAdmin();
  const { data, error } = await supabase
    .from("tenancy_agreement_templates")
    .insert({
      property_id: propertyId,
      name,
      template_content: content,
      is_active: isActive,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect("/e-tenancy?error=template_create");
  }

  await supabase
    .from("properties")
    .update({ default_ta_template_id: data.id })
    .eq("id", propertyId);

  revalidatePath("/e-tenancy");
  redirect("/e-tenancy?created=template");
}

export async function generateAgreement(formData: FormData) {
  await requireRole(["super_admin", "owner", "admin"]);
  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  const duration = numberValue(formData, "contractDurationMonths", 12);
  const startDate = textValue(formData, "startDate");

  if (!user || !tenancyId || ![6, 12].includes(duration) || !startDate) {
    redirect("/e-tenancy?error=agreement_missing");
  }

  const supabase = await getAdmin();
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, unit_id, room_id, monthly_rental, deposit, contract_start, contract_end, due_day")
    .eq("id", tenancyId)
    .single();

  if (!tenancy) {
    redirect("/e-tenancy?error=agreement_missing");
  }

  const endDate = addMonths(startDate, duration);
  await supabase
    .from("tenancies")
    .update({
      tenancy_start_date: startDate,
      tenancy_end_date: endDate,
      contract_start: startDate,
      contract_end: endDate,
      contract_duration_months: duration,
    })
    .eq("id", tenancy.id);

  const [{ data: tenant }, { data: property }, { data: unit }, { data: room }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", tenancy.tenant_id).maybeSingle(),
    supabase.from("properties").select("name, address, default_ta_template_id").eq("id", tenancy.property_id).maybeSingle(),
    tenancy.unit_id ? supabase.from("units").select("name").eq("id", tenancy.unit_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("rooms").select("name, room_number").eq("id", tenancy.room_id).maybeSingle(),
  ]);

  let template = null;
  if (property?.default_ta_template_id) {
    const { data } = await supabase
      .from("tenancy_agreement_templates")
      .select("id, template_content")
      .eq("id", property.default_ta_template_id)
      .maybeSingle();
    template = data;
  }

  if (!template) {
    const { data } = await supabase
      .from("tenancy_agreement_templates")
      .insert({
        property_id: tenancy.property_id,
        name: "Default Tenancy Agreement",
        template_content: defaultAgreementTemplate,
        is_active: true,
        created_by: user.id,
      })
      .select("id, template_content")
      .single();
    template = data;
  }

  const rendered = renderAgreementTemplate(template?.template_content ?? defaultAgreementTemplate, {
    tenant_name: tenant?.full_name,
    tenant_ic_passport: "-",
    tenant_phone: tenant?.phone,
    property_name: property?.name,
    property_address: property?.address,
    unit_number: unit?.name,
    room_number: room?.room_number ?? room?.name,
    monthly_rent: money(tenancy.monthly_rental),
    deposit_amount: money(tenancy.deposit),
    utility_deposit: money(0),
    tenancy_start_date: startDate,
    tenancy_end_date: endDate,
    contract_duration_months: duration,
    agreement_date: new Date().toISOString().slice(0, 10),
    tenant_signature: "[Pending tenant signature]",
  });

  const { error } = await supabase.from("tenancy_agreements").insert({
    tenancy_id: tenancy.id,
    template_id: template?.id ?? null,
    agreement_type: "original",
    version_number: 1,
    status: "pending_signature",
    rendered_content: rendered,
    created_by: user.id,
  });

  if (error) {
    redirect("/e-tenancy?error=agreement_create");
  }

  revalidatePath("/e-tenancy");
  redirect("/e-tenancy?created=agreement");
}

export async function refreshAgreementExpiry() {
  await requireRole(["super_admin", "owner", "admin"]);
  const supabase = await getAdmin();
  await supabase.rpc("refresh_tenancy_agreement_expiry");
  revalidatePath("/e-tenancy");
  redirect("/e-tenancy?created=expiry");
}

export async function signAgreement(formData: FormData) {
  await requireRole(["tenant"]);
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
    .select("id, rendered_content, tenancy_id, tenancies(tenant_id)")
    .eq("id", agreementId)
    .single();

  const tenancy = Array.isArray(agreement?.tenancies) ? agreement?.tenancies[0] : agreement?.tenancies;
  if (!agreement || tenancy?.tenant_id !== user.id) {
    redirect("/dashboard");
  }

  const signedAt = new Date().toISOString();
  const signatureBytes = Buffer.from(signatureData.split(",")[1] ?? "", "base64");
  const signaturePath = `${user.id}/${agreement.id}/signature-${Date.now()}.png`;
  await supabase.storage.from("tenancy-signatures").upload(signaturePath, signatureBytes, {
    contentType: "image/png",
    upsert: true,
  });

  const signedContent = agreement.rendered_content.replace("[Pending tenant signature]", `Signed digitally by ${user.email ?? user.phone ?? user.id}`);
  const pdfBytes = createSignedPdfBytes(signedContent, user.user_metadata?.full_name ?? user.email ?? user.id, signedAt);
  const pdfPath = `${user.id}/${agreement.id}/signed-ta-${Date.now()}.pdf`;
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
      status: "signed",
      signed_at: signedAt,
      pdf_url: pdfPath,
      rendered_content: signedContent,
    })
    .eq("id", agreement.id);

  revalidatePath("/e-tenancy");
  revalidatePath(`/e-tenancy/${agreement.id}`);
  redirect(`/e-tenancy/${agreement.id}?signed=1`);
}
