"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import {
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

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

function monthlyBillDate(dateText: string | null | undefined) {
  const date = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

async function ensureTenancyAndAgreement(
  supabase: Awaited<ReturnType<typeof getAdmin>>,
  applicationId: string,
  adminUserId: string,
) {
  const { data: application } = await supabase
    .from("tenant_applications")
    .select("id, tenant_id, property_id, unit_id, room_id, full_name, ic_passport_number, whatsapp_number, contract_duration_months, proposed_start_date, proposed_end_date, monthly_rent, deposit, utility_deposit, verification_status, payment_status")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application || application.verification_status !== "verified" || application.payment_status !== "verified") {
    return;
  }

  const { data: existingTenancy } = await supabase
    .from("tenancies")
    .select("id")
    .eq("tenant_id", application.tenant_id)
    .eq("room_id", application.room_id)
    .eq("status", "active")
    .maybeSingle();

  let tenancyId = existingTenancy?.id;

  if (!tenancyId) {
    const { data: tenancy } = await supabase
      .from("tenancies")
      .insert({
        organization_id: null,
        tenant_id: application.tenant_id,
        property_id: application.property_id,
        unit_id: application.unit_id,
        room_id: application.room_id,
        monthly_rental: application.monthly_rent,
        deposit: application.deposit,
        contract_start: application.proposed_start_date,
        contract_end: application.proposed_end_date,
        tenancy_start_date: application.proposed_start_date,
        tenancy_end_date: application.proposed_end_date,
        contract_duration_months: application.contract_duration_months,
        due_day: 1,
        status: "active",
        created_by: adminUserId,
      })
      .select("id")
      .single();
    tenancyId = tenancy?.id;
  }

  if (!tenancyId) {
    return;
  }

  await supabase
    .from("rooms")
    .update({ status: "occupied", updated_at: new Date().toISOString() })
    .eq("id", application.room_id);

  await supabase
    .from("tenant_applications")
    .update({ status: "converted_to_tenancy", updated_at: new Date().toISOString() })
    .eq("id", application.id);

  await supabase.from("rent_bills").upsert({
    tenancy_id: tenancyId,
    tenant_id: application.tenant_id,
    property_id: application.property_id,
    unit_id: application.unit_id,
    room_id: application.room_id,
    bill_month: monthlyBillDate(application.proposed_start_date),
    due_date: application.proposed_start_date,
    amount: application.monthly_rent,
    paid_amount: 0,
    status: "unpaid",
    created_by: adminUserId,
  }, {
    onConflict: "tenancy_id,bill_month",
  });

  const { data: existingAgreement } = await supabase
    .from("tenancy_agreements")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("agreement_type", "original")
    .maybeSingle();

  if (existingAgreement) {
    return;
  }

  const [{ data: tenant }, { data: property }, { data: unit }, { data: room }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", application.tenant_id).maybeSingle(),
    supabase.from("properties").select("name, address, default_ta_template_id").eq("id", application.property_id).maybeSingle(),
    application.unit_id ? supabase.from("units").select("name").eq("id", application.unit_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("rooms").select("name, room_number").eq("id", application.room_id).maybeSingle(),
  ]);

  let template: { id: string; template_content: string } | null = null;
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
        property_id: application.property_id,
        name: `${property?.name ?? "Property"} Default TA`,
        template_content: defaultAgreementTemplate,
        is_active: true,
        created_by: adminUserId,
      })
      .select("id, template_content")
      .single();
    template = data;
    if (template?.id) {
      await supabase
        .from("properties")
        .update({ default_ta_template_id: template.id })
        .eq("id", application.property_id);
    }
  }

  const rendered = renderAgreementTemplate(template?.template_content ?? defaultAgreementTemplate, {
    tenant_name: tenant?.full_name ?? application.full_name,
    tenant_ic_passport: application.ic_passport_number,
    tenant_phone: tenant?.phone ?? application.whatsapp_number,
    property_name: property?.name,
    property_address: property?.address,
    unit_number: unit?.name,
    room_number: room?.room_number ?? room?.name,
    monthly_rent: money(application.monthly_rent),
    deposit_amount: money(application.deposit),
    utility_deposit: money(application.utility_deposit),
    tenancy_start_date: application.proposed_start_date,
    tenancy_end_date: application.proposed_end_date,
    contract_duration_months: application.contract_duration_months,
    agreement_date: new Date().toISOString().slice(0, 10),
    tenant_signature: "[Pending tenant signature]",
  });

  await supabase.from("tenancy_agreements").insert({
    tenancy_id: tenancyId,
    template_id: template?.id ?? null,
    agreement_type: "original",
    version_number: 1,
    status: "pending_signature",
    rendered_content: rendered,
    created_by: adminUserId,
  });
}

export async function reviewPaymentSubmission(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const submissionId = textValue(formData, "submissionId");
  const decision = textValue(formData, "decision");
  const notes = textValue(formData, "notes");

  if (!user || !submissionId || !["verified", "rejected", "more_information_required"].includes(decision)) {
    redirect("/payment-verification?error=missing");
  }

  const supabase = await getAdmin();
  const { data: submission, error } = await supabase
    .from("payment_submissions")
    .update({
      verification_status: decision,
      verified_by: decision === "verified" ? user.id : null,
      verified_at: decision === "verified" ? new Date().toISOString() : null,
      rejection_reason: decision === "verified" ? null : notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .select("id, tenant_id, tenant_application_id, tenancy_id, rent_bill_id, property_id, unit_id, room_id, bill_type, payment_type, amount, payment_date, payment_method, reference_number")
    .single();

  if (error || !submission) {
    redirect("/payment-verification?error=review");
  }

  if (decision === "verified") {
    if (submission.rent_bill_id) {
      await supabase
        .from("rent_bills")
        .update({
          paid_amount: submission.amount,
          status: "paid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", submission.rent_bill_id);
    }

    await supabase.from("payments").insert({
      organization_id: null,
      tenant_id: submission.tenant_id,
      tenancy_id: submission.tenancy_id,
      property_id: submission.property_id,
      unit_id: submission.unit_id,
      room_id: submission.room_id,
      category: submission.bill_type === "monthly_rent" ? "monthly_rent" : submission.payment_type,
      amount: submission.amount,
      payment_date: submission.payment_date,
      payment_method: submission.payment_method,
      reference_number: submission.reference_number,
      notes: "Verified tenant uploaded payment proof",
      status: "confirmed",
      recorded_by: user.id,
    });

    if (submission.tenant_application_id) {
      await supabase
        .from("tenant_applications")
        .update({ payment_status: "verified", updated_at: new Date().toISOString() })
        .eq("id", submission.tenant_application_id);

      await ensureTenancyAndAgreement(supabase, submission.tenant_application_id, user.id);
    }
  } else if (submission.tenant_application_id) {
    await supabase
      .from("tenant_applications")
      .update({ payment_status: decision, updated_at: new Date().toISOString() })
      .eq("id", submission.tenant_application_id);
  }

  revalidatePath("/payment-verification");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/e-tenancy");
  revalidatePath("/onboarding");
  redirect("/payment-verification?reviewed=1");
}
