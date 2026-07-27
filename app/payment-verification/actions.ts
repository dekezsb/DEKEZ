"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { convertTenantApplication } from "@/lib/tenancy/convert-application";

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

export async function reviewPaymentSubmission(formData: FormData) {
  const role = await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
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
    let tenancyId = submission.tenancy_id;
    let rentBillId = submission.rent_bill_id;

    if (submission.tenant_application_id) {
      await supabase
        .from("tenant_applications")
        .update({
          payment_status: "verified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", submission.tenant_application_id);

      const conversion = await convertTenantApplication(supabase, {
        actorId: user.id,
        applicationId: submission.tenant_application_id,
        requireVerifiedPayment: true,
      });

      if (!conversion.ok) {
        await Promise.all([
          supabase
            .from("payment_submissions")
            .update({
              verification_status: "pending_verification",
              verified_by: null,
              verified_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", submission.id),
          supabase
            .from("tenant_applications")
            .update({
              payment_status: "pending_verification",
              updated_at: new Date().toISOString(),
            })
            .eq("id", submission.tenant_application_id),
        ]);
        redirect(withResult(returnTo, "error=review"));
      }
      tenancyId = conversion.tenancyId;
    }

    const { data: tenancy } = tenancyId
      ? await supabase
          .from("tenancies")
          .select(
            "id, company_id, organization_id, property_id, unit_id, room_id",
          )
          .eq("id", tenancyId)
          .maybeSingle()
      : { data: null };

    if (!tenancy) {
      await supabase
        .from("payment_submissions")
        .update({
          verification_status: "pending_verification",
          verified_by: null,
          verified_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", submission.id);
      redirect(withResult(returnTo, "error=review"));
    }

    if (
      !rentBillId &&
      submission.payment_type === "first_month_rental"
    ) {
      const { data: firstBill } = await supabase
        .from("rent_bills")
        .select("id")
        .eq("tenancy_id", tenancy.id)
        .order("bill_month", { ascending: true })
        .limit(1)
        .maybeSingle();
      rentBillId = firstBill?.id ?? null;
    }

    await supabase
      .from("payment_submissions")
      .update({
        tenancy_id: tenancy.id,
        rent_bill_id: rentBillId,
        property_id: tenancy.property_id,
        unit_id: tenancy.unit_id,
        room_id: tenancy.room_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.id);

    if (rentBillId) {
      const { data: bill } = await supabase
        .from("rent_bills")
        .select("id, amount, paid_amount, status")
        .eq("id", rentBillId)
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
        .eq("id", rentBillId);

      await supabase.from("rent_bill_audit_logs").insert({
        bill_id: rentBillId,
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
      company_id: tenancy.company_id,
      rent_bill_id: rentBillId,
      organization_id: tenancy.organization_id,
      tenant_id: submission.tenant_id,
      tenancy_id: tenancy.id,
      property_id: tenancy.property_id,
      unit_id: tenancy.unit_id,
      room_id: tenancy.room_id,
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
