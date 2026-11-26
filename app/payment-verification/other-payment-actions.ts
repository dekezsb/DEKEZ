"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import {
  getVerifiedDepositPaymentMaps,
  verifiedDepositPaid,
} from "@/lib/invoices/deposit-payments";
import { verificationBankReference } from "@/lib/payments/bank-reference";
import {
  depositBalanceCheck,
  isOtherPaymentSubmission,
  isOtherPaymentType,
  otherPaymentCategory,
  otherPaymentTypeLabel,
} from "@/lib/payments/other-payment";
import {
  bankReferenceRequired,
  bankReferenceResult,
  usableBankReference,
} from "@/lib/payments/verification-row";
import { createAdminClient } from "@/lib/supabase/admin";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export type OtherPaymentReviewResult = {
  error: string | null;
  verified: boolean;
};

function fail(error: string): OtherPaymentReviewResult {
  return { error, verified: false };
}

/**
 * Verify or reject an "other payment" slip (key replacement, top-up, deposit
 * balance, other).
 *
 * This is deliberately separate from the rent verification action:
 *  - it never reads or writes rent_bills, invoice lines or rent_bill_audit_logs,
 *    so no rent invoice can be marked paid or have its balance changed;
 *  - it posts exactly one `payments` row, category = the slip's type;
 *  - it creates no invoice, receipt, journal or receivable posting.
 */
export async function reviewOtherPaymentInline(
  formData: FormData,
): Promise<OtherPaymentReviewResult> {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const submissionId = textValue(formData, "submissionId");
  const decision = textValue(formData, "decision");
  const notes = textValue(formData, "notes");
  if (!user || !submissionId || !["verified", "rejected"].includes(decision)) {
    return fail("missing");
  }
  if (decision === "rejected" && !notes) return fail("reason");

  const db = createAdminClient();
  const { data: current } = await db
    .from("payment_submissions")
    .select(
      "id, verification_status, bill_type, rent_bill_id, tenant_id, tenant_record_id, tenancy_id, property_id, unit_id, room_id, payment_type, amount, payment_date, payment_method, reference_number, payment_note",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (!current || !isOtherPaymentSubmission(current)) return fail("review");
  if (!(await getProperties()).some((p) => p.id === current.property_id)) {
    return fail("review");
  }
  if (current.verification_status === "verified") return fail("already_verified");
  // An other payment is never tied to a rent invoice. Refuse anything that is.
  if (current.rent_bill_id) return fail("other_payment_review");

  const reviewedAt = new Date().toISOString();

  if (decision === "rejected") {
    const { data: rejected } = await db
      .from("payment_submissions")
      .update({
        verification_status: "rejected",
        verified_by: null,
        verified_at: null,
        rejection_reason: notes,
        updated_at: reviewedAt,
      })
      .eq("id", current.id)
      .eq("verification_status", current.verification_status)
      .select("id")
      .maybeSingle();
    if (!rejected) return fail("review");
    await db.from("payment_verification_audit_logs").insert({
      payment_submission_id: current.id,
      action: "rejected",
      performed_by: user.id,
      old_status: current.verification_status,
      new_status: "rejected",
      reason: notes,
    });
    revalidateAll();
    return { error: null, verified: false };
  }

  if (!isOtherPaymentType(current.payment_type)) return fail("other_payment_review");
  const type = current.payment_type;
  const category = otherPaymentCategory(type);
  const amount = Number(current.amount ?? 0);
  if (!(amount > 0)) return fail("other_payment_review");

  let reference: string | null;
  try {
    reference = verificationBankReference(formData, decision, current.reference_number);
  } catch {
    return fail("bank_reference");
  }
  if (bankReferenceRequired(current.payment_method) && !usableBankReference(reference)) {
    return fail("bank_reference_required");
  }

  // Resolve the tenancy now (the pending slip carries none, so it can never
  // look like a pending rent slip to the rent collection checks).
  let tenancyIdCandidates: string[] = [];
  if (current.tenant_id) {
    const { data: people } = await db
      .from("tenants")
      .select("id")
      .eq("profile_id", current.tenant_id);
    const personIds = (people ?? []).map((person) => person.id);
    if (personIds.length) {
      const { data: rows } = await db
        .from("tenancies")
        .select("id")
        .in("tenant_id", personIds)
        .eq("property_id", current.property_id)
        .eq("room_id", current.room_id)
        .eq("status", "active")
        .is("checkout_date", null);
      tenancyIdCandidates = (rows ?? []).map((row) => row.id);
    }
  } else if (current.tenant_record_id) {
    const { data: record } = await db
      .from("tenant_records")
      .select("tenancy_id")
      .eq("id", current.tenant_record_id)
      .maybeSingle();
    if (record?.tenancy_id) tenancyIdCandidates = [record.tenancy_id];
  }
  if (tenancyIdCandidates.length !== 1) return fail("other_payment_tenancy");

  const { data: tenancy } = await db
    .from("tenancies")
    .select(
      "id, company_id, organization_id, property_id, unit_id, room_id, deposit, status, checkout_date",
    )
    .eq("id", tenancyIdCandidates[0])
    .maybeSingle();
  if (!tenancy || tenancy.status !== "active" || tenancy.checkout_date) {
    return fail("other_payment_tenancy");
  }

  if (category === "deposit") {
    const maps = await getVerifiedDepositPaymentMaps(
      db,
      [tenancy.id],
      current.tenant_record_id ? [current.tenant_record_id] : [],
    );
    const canonical = maps.canonicalByTenancy.get(tenancy.id) ?? 0;
    const slipsOnly = maps.submissionsByTenancy.get(tenancy.id) ?? 0;
    // Deposit already recorded only through old slips (no payment rows): a new
    // deposit payment row would hide it from the deposit totals. Needs a human.
    if (canonical <= 0 && slipsOnly > 0) return fail("other_payment_deposit_review");
    const deposit = Number(tenancy.deposit ?? 0);
    const received = verifiedDepositPaid(maps, {
      tenancyId: tenancy.id,
      tenantRecordId: current.tenant_record_id,
      depositAmount: deposit,
    });
    if (!depositBalanceCheck({ depositRequired: deposit, depositReceived: received, amount }).fits) {
      return fail("other_payment_deposit_amount");
    }
  }

  // Idempotent: a retry after a partial failure must not post a second payment.
  const { data: alreadyPosted } = await db
    .from("payments")
    .select("id")
    .eq("payment_submission_id", current.id)
    .in("status", ["confirmed", "paid"])
    .is("reversed_at", null)
    .limit(1)
    .maybeSingle();
  if (alreadyPosted) return fail("already_verified");

  const { data: verified, error: verifyError } = await db
    .from("payment_submissions")
    .update({
      tenancy_id: tenancy.id,
      reference_number: reference,
      verification_status: "verified",
      verified_by: user.id,
      verified_at: reviewedAt,
      rejection_reason: null,
      updated_at: reviewedAt,
    })
    .eq("id", current.id)
    .eq("verification_status", current.verification_status)
    .select("id")
    .maybeSingle();
  if (verifyError || !verified) {
    return fail(bankReferenceResult(verifyError?.message, "review").replace("error=", ""));
  }

  const { error: paymentError } = await db.from("payments").insert({
    company_id: tenancy.company_id,
    organization_id: tenancy.organization_id,
    payment_submission_id: current.id,
    rent_bill_id: null,
    tenant_id: current.tenant_id,
    tenancy_id: tenancy.id,
    property_id: tenancy.property_id,
    unit_id: tenancy.unit_id,
    room_id: tenancy.room_id,
    category,
    amount,
    payment_date: current.payment_date,
    payment_method: current.payment_method,
    reference_number: reference,
    notes: `Verified other payment: ${otherPaymentTypeLabel(type)}`,
    status: "confirmed",
    recorded_by: user.id,
    verified_by: user.id,
    verified_at: reviewedAt,
  });
  if (paymentError) {
    // Put the slip back so nothing is half-verified.
    await db
      .from("payment_submissions")
      .update({
        verification_status: current.verification_status,
        verified_by: null,
        verified_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id);
    return fail("review");
  }

  await db.from("payment_verification_audit_logs").insert({
    payment_submission_id: current.id,
    action: "verified",
    performed_by: user.id,
    old_status: current.verification_status,
    new_status: "verified",
    reason: notes || `Other payment verified: ${otherPaymentTypeLabel(type)}`,
  });

  revalidateAll();
  return { error: null, verified: true };
}

function revalidateAll() {
  for (const path of [
    "/payment-verification",
    "/verification",
    "/payments",
    "/dashboard",
    "/reports",
  ]) {
    revalidatePath(path);
  }
}
