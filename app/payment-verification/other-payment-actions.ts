"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { billMonthForDate } from "@/lib/billing/rent-billing";
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
  otherPaymentDescriptionFromNote,
  otherPaymentInvoiceCharge,
  otherPaymentTypeLabel,
  settleInvoiceForOtherCharge,
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

const UNUSABLE_BILL_STATUSES = new Set(["cancelled", "waived", "draft"]);

/**
 * Verify or reject an "other payment" slip (key replacement, top-up, deposit
 * balance, other).
 *
 * Separate from the rent verification action so a slip can never be applied as
 * monthly rent. On verify:
 *  - key replacement and "other" add an invoice other-charge line (income in
 *    Other Tenant Charges Income) on that month's room invoice;
 *  - an electricity top-up adds a top_up_utilities line (Top Up Utilities
 *    Income);
 *  - the payment settles only that new charge, so unpaid rent is unchanged;
 *  - a deposit-balance payment posts a deposit liability only, with no invoice
 *    line and no income.
 * Undo uses reverse_verified_payment_submission, which deletes the invoice
 * line, cancels the payment and recalculates the invoice.
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
  // A pending other payment must not already be tied to a rent invoice.
  if (current.rent_bill_id) return fail("other_payment_review");

  const previousStatus = current.verification_status;
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
      .eq("verification_status", previousStatus)
      .select("id")
      .maybeSingle();
    if (!rejected) return fail("review");
    await db.from("payment_verification_audit_logs").insert({
      payment_submission_id: current.id,
      action: "rejected",
      performed_by: user.id,
      old_status: previousStatus,
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

  const invoiceCharge = otherPaymentInvoiceCharge(
    type,
    otherPaymentDescriptionFromNote(current.payment_note),
  );
  const billMonth = current.payment_date
    ? billMonthForDate(String(current.payment_date).slice(0, 10))
    : "";

  let bill: {
    id: string;
    amount: number | string | null;
    deposit_amount: number | string | null;
    paid_amount: number | string | null;
    status: string | null;
  } | null = null;
  let existingExtraTotal = 0;
  let existingDepositPaid = 0;

  if (invoiceCharge) {
    if (!billMonth) return fail("other_payment_invoice");
    const { data: bills } = await db
      .from("rent_bills")
      .select("id, amount, deposit_amount, paid_amount, status, removed_at")
      .eq("tenancy_id", tenancy.id)
      .eq("bill_month", billMonth)
      .is("removed_at", null);
    const usable = (bills ?? []).filter(
      (row) => !UNUSABLE_BILL_STATUSES.has(String(row.status ?? "")),
    );
    if (usable.length !== 1) return fail("other_payment_invoice");
    bill = usable[0];

    const [{ data: existingItems }, { data: billPayments }] = await Promise.all([
      db
        .from("rental_invoice_line_items")
        .select("amount")
        .eq("rent_bill_id", bill.id),
      db
        .from("payments")
        .select("amount, category")
        .eq("rent_bill_id", bill.id)
        .in("status", ["confirmed", "paid"])
        .is("reversed_at", null),
    ]);
    existingExtraTotal = (existingItems ?? []).reduce(
      (total, item) => total + Number(item.amount ?? 0),
      0,
    );
    existingDepositPaid = (billPayments ?? []).reduce((total, payment) => {
      return payment.category === "deposit"
        ? total + Number(payment.amount ?? 0)
        : total;
    }, 0);
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

  const settlement = invoiceCharge && bill
    ? settleInvoiceForOtherCharge({
        rentAmount: Number(bill.amount ?? 0),
        depositAmount: Number(bill.deposit_amount ?? 0),
        existingExtraTotal,
        existingPaidAmount: Number(bill.paid_amount ?? 0),
        existingDepositPaid,
        chargeAmount: amount,
      })
    : null;

  const { data: verified, error: verifyError } = await db
    .from("payment_submissions")
    .update({
      tenancy_id: tenancy.id,
      rent_bill_id: bill?.id ?? null,
      bill_month: bill ? billMonth : null,
      reference_number: reference,
      verification_status: "verified",
      verified_by: user.id,
      verified_at: reviewedAt,
      rejection_reason: null,
      updated_at: reviewedAt,
    })
    .eq("id", current.id)
    .eq("verification_status", previousStatus)
    .select("id")
    .maybeSingle();
  if (verifyError || !verified) {
    return fail(bankReferenceResult(verifyError?.message, "review").replace("error=", ""));
  }

  let billSettled = false;
  const rollback = async () => {
    if (invoiceCharge) {
      await db
        .from("rental_invoice_line_items")
        .delete()
        .eq("payment_submission_id", current.id);
    }
    if (bill && billSettled) {
      await db
        .from("rent_bills")
        .update({
          paid_amount: bill.paid_amount,
          status: bill.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bill.id);
    }
    await db
      .from("payments")
      .update({
        status: "cancelled",
        reversed_at: new Date().toISOString(),
        reversed_by: user.id,
        reversal_reason: "Other payment posting rolled back",
        updated_at: new Date().toISOString(),
      })
      .eq("payment_submission_id", current.id)
      .in("status", ["confirmed", "paid"]);
    await db
      .from("payment_submissions")
      .update({
        verification_status: previousStatus,
        verified_by: null,
        verified_at: null,
        rent_bill_id: null,
        tenancy_id: null,
        bill_month: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id);
  };

  if (invoiceCharge && bill) {
    const { data: existingLine } = await db
      .from("rental_invoice_line_items")
      .select("id")
      .eq("payment_submission_id", current.id)
      .maybeSingle();
    if (!existingLine) {
      const { error: lineError } = await db.from("rental_invoice_line_items").insert({
        rent_bill_id: bill.id,
        payment_submission_id: current.id,
        category: invoiceCharge.category,
        description: invoiceCharge.description,
        amount,
        created_by: user.id,
        updated_at: reviewedAt,
      });
      if (lineError) {
        await rollback();
        return fail("review");
      }
    }
  }

  const { error: paymentError } = await db.from("payments").insert({
    company_id: tenancy.company_id,
    organization_id: tenancy.organization_id,
    payment_submission_id: current.id,
    rent_bill_id: bill?.id ?? null,
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
    await rollback();
    return fail("review");
  }

  if (invoiceCharge && bill && settlement) {
    const { error: billError } = await db
      .from("rent_bills")
      .update({
        paid_amount: settlement.newPaidAmount,
        status: settlement.status,
        updated_at: reviewedAt,
      })
      .eq("id", bill.id);
    if (billError) {
      await rollback();
      return fail("review");
    }
    billSettled = true;
    await db.from("rent_bill_audit_logs").insert({
      bill_id: bill.id,
      action: "verify_payment_submission",
      performed_by: user.id,
      old_status: bill.status ?? null,
      new_status: settlement.status,
      old_paid_amount: Number(bill.paid_amount ?? 0),
      new_paid_amount: settlement.newPaidAmount,
      reason: `${invoiceCharge.description} (other payment)`,
    });
  }

  await db.from("payment_verification_audit_logs").insert({
    payment_submission_id: current.id,
    action: "verified",
    performed_by: user.id,
    old_status: previousStatus,
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
