"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { generateRecurringRentBills } from "@/lib/billing/rent-billing";
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

function returnPath(formData: FormData) {
  return textValue(formData, "returnTo") === "/verification?view=payments"
    ? "/verification?view=payments"
    : "/payment-verification";
}

function withResult(path: string, result: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${result}`;
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
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
  const dueDay = Number(application.proposed_start_date.slice(8, 10));

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
        due_day: dueDay,
        rent_due_day: dueDay,
        check_in_date: application.proposed_start_date,
        checkout_date: null,
        billing_status: "active",
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

  await generateRecurringRentBills(supabase, {
    currentDate: application.proposed_start_date,
    createdBy: adminUserId,
    tenancyId,
    includeTenantRecords: false,
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
  const role = await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const submissionId = textValue(formData, "submissionId");
  const decision = textValue(formData, "decision");
  const notes = textValue(formData, "notes");
  const returnTo = returnPath(formData);

  if (!user || !submissionId || !["verified", "rejected"].includes(decision)) {
    redirect(withResult(returnTo, "error=missing"));
  }

  if (decision === "rejected" && !notes) {
    redirect(withResult(returnTo, "error=reason"));
  }

  const supabase = await getAdmin();
  const { data: currentSubmission } = await supabase
    .from("payment_submissions")
    .select("id, verification_status")
    .eq("id", submissionId)
    .single();

  if (!currentSubmission) {
    redirect(withResult(returnTo, "error=review"));
  }

  if (currentSubmission.verification_status === "verified" && role !== "super_admin") {
    redirect(withResult(returnTo, "error=already_verified"));
  }

  if (currentSubmission.verification_status === "verified" && role === "super_admin" && decision !== "verified" && !notes) {
    redirect(withResult(returnTo, "error=reason"));
  }

  if (currentSubmission.verification_status === "verified" && decision === "verified") {
    redirect(withResult(returnTo, "error=already_verified"));
  }

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
    redirect(withResult(returnTo, "error=review"));
  }

  await supabase.from("payment_verification_audit_logs").insert({
    payment_submission_id: submission.id,
    action: currentSubmission.verification_status === "verified" && decision !== "verified" ? "reversed" : decision,
    performed_by: user.id,
    old_status: currentSubmission.verification_status,
    new_status: decision,
    reason: notes || null,
  });

  if (decision === "verified") {
    if (submission.rent_bill_id) {
      const { data: bill } = await supabase
        .from("rent_bills")
        .select("id, amount, paid_amount, status")
        .eq("id", submission.rent_bill_id)
        .single();
      const oldPaidAmount = Number(bill?.paid_amount ?? 0);
      const billAmount = Number(bill?.amount ?? 0);
      const newPaidAmount = Math.min(oldPaidAmount + Number(submission.amount ?? 0), billAmount);
      const newStatus = newPaidAmount >= billAmount ? "paid" : "partially_paid";

      await supabase
        .from("rent_bills")
        .update({
          paid_amount: newPaidAmount,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", submission.rent_bill_id);

      await supabase.from("rent_bill_audit_logs").insert({
        bill_id: submission.rent_bill_id,
        action: "verify_payment_submission",
        performed_by: user.id,
        old_status: bill?.status ?? null,
        new_status: newStatus,
        old_paid_amount: oldPaidAmount,
        new_paid_amount: newPaidAmount,
        reason: submission.reference_number || "Tenant payment proof verified",
      });
    }

    await supabase.from("payments").insert({
      rent_bill_id: submission.rent_bill_id,
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
      verified_by: user.id,
      verified_at: new Date().toISOString(),
    });

    if (submission.tenant_application_id) {
      await supabase
        .from("tenant_applications")
        .update({ payment_status: "verified", updated_at: new Date().toISOString() })
        .eq("id", submission.tenant_application_id);

      await ensureTenancyAndAgreement(supabase, submission.tenant_application_id, user.id);
    }
  } else {
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

    if (submission.tenant_application_id) {
      await supabase
        .from("tenant_applications")
        .update({ payment_status: decision, updated_at: new Date().toISOString() })
        .eq("id", submission.tenant_application_id);
    }
  }

  revalidatePath("/payment-verification");
  revalidatePath("/verification");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/e-tenancy");
  revalidatePath("/onboarding");
  redirect(withResult(returnTo, "reviewed=1"));
}
