"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import {
  getVerifiedDepositPaymentMaps,
  verifiedDepositPaid,
} from "@/lib/invoices/deposit-payments";
import {
  extraChargeLabel,
  isExtraChargeCategory,
  type ExtraChargeCategory,
} from "@/lib/payments/extra-charges";
import {
  allocatePaymentPurpose,
  isPaymentPurpose,
} from "@/lib/payments/payment-purpose";
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
  const paymentPurposeOverride = textValue(
    formData,
    "paymentPurposeOverride",
  );
  const purposeCorrectionReason = textValue(
    formData,
    "purposeCorrectionReason",
  );
  const correctionReason =
    textValue(formData, "correctionReason") || purposeCorrectionReason;
  const paymentDateOverride = textValue(formData, "paymentDateOverride");
  const billMonthOverride = textValue(formData, "billMonthOverride");
  const amountSubmittedOverride = textValue(
    formData,
    "amountSubmittedOverride",
  );
  const extraChargeCategory = textValue(
    formData,
    "extraChargeCategory",
  );
  const extraChargeDescription = textValue(
    formData,
    "extraChargeDescription",
  );
  const extraChargeAmountInput = textValue(formData, "extraChargeAmount");
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
    .select("id, verification_status, rent_bill_id, tenancy_id, tenant_record_id, payment_type, amount, payment_date, bill_month")
    .eq("id", submissionId)
    .single();

  if (!currentSubmission) {
    redirect(withResult(returnTo, "error=review"));
  }

  if (currentSubmission.verification_status === "verified") {
    redirect(withResult(returnTo, "error=already_verified"));
  }

  let effectivePaymentType = currentSubmission.payment_type;
  let effectivePaymentDate = currentSubmission.payment_date;
  let effectiveBillMonth = currentSubmission.bill_month;
  let effectiveRentBillId = currentSubmission.rent_bill_id;
  let effectiveAmount = Number(currentSubmission.amount ?? 0);
  const purposeWasCorrected =
    decision === "verified" &&
    paymentPurposeOverride &&
    paymentPurposeOverride !== currentSubmission.payment_type;
  const paymentDateWasCorrected =
    decision === "verified" &&
    paymentDateOverride &&
    paymentDateOverride !== currentSubmission.payment_date;
  const normalizedBillMonth = billMonthOverride
    ? `${billMonthOverride}-01`
    : "";
  const billMonthWasCorrected =
    decision === "verified" &&
    normalizedBillMonth &&
    normalizedBillMonth !== currentSubmission.bill_month;
  const requestedAmount = Number(amountSubmittedOverride);
  const amountWasCorrected =
    decision === "verified" &&
    amountSubmittedOverride !== "" &&
    Number.isFinite(requestedAmount) &&
    Math.abs(requestedAmount - effectiveAmount) > 0.005;
  const paymentDetailsWereCorrected =
    purposeWasCorrected ||
    paymentDateWasCorrected ||
    billMonthWasCorrected ||
    amountWasCorrected;

  if (paymentDetailsWereCorrected) {
    if (
      role !== "super_admin" ||
      !correctionReason
    ) {
      redirect(withResult(returnTo, "error=purpose_correction"));
    }
  }

  if (purposeWasCorrected) {
    if (!isPaymentPurpose(paymentPurposeOverride)) {
      redirect(withResult(returnTo, "error=purpose_correction"));
    }
    effectivePaymentType = paymentPurposeOverride;
  }

  if (paymentDateWasCorrected) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(paymentDateOverride) ||
      Number.isNaN(Date.parse(`${paymentDateOverride}T00:00:00Z`))
    ) {
      redirect(withResult(returnTo, "error=correction_date"));
    }
    effectivePaymentDate = paymentDateOverride;
  }

  if (billMonthOverride && !/^\d{4}-\d{2}$/.test(billMonthOverride)) {
    redirect(withResult(returnTo, "error=correction_month"));
  }

  if (
    decision === "verified" &&
    amountSubmittedOverride !== "" &&
    (!Number.isFinite(requestedAmount) || requestedAmount <= 0)
  ) {
    redirect(withResult(returnTo, "error=correction_amount"));
  }

  if (amountWasCorrected) {
    effectiveAmount = requestedAmount;
  }

  if (billMonthWasCorrected) {
    if (!currentSubmission.tenancy_id) {
      redirect(withResult(returnTo, "error=correction_bill_missing"));
    }

    const { data: targetBill } = await supabase
      .from("rent_bills")
      .select("id, bill_month, status")
      .eq("tenancy_id", currentSubmission.tenancy_id)
      .eq("bill_month", normalizedBillMonth)
      .maybeSingle();

    if (!targetBill) {
      redirect(withResult(returnTo, "error=correction_bill_missing"));
    }
    if (targetBill.status === "paid") {
      redirect(withResult(returnTo, "error=correction_bill_paid"));
    }

    const { data: existingPending } = await supabase
      .from("payment_submissions")
      .select("id")
      .eq("rent_bill_id", targetBill.id)
      .eq("verification_status", "pending_verification")
      .neq("id", submissionId)
      .limit(1)
      .maybeSingle();

    if (existingPending) {
      redirect(withResult(returnTo, "error=correction_bill_pending"));
    }

    effectiveRentBillId = targetBill.id;
    effectiveBillMonth = targetBill.bill_month;
  }

  let verifiedExtraCharge: {
    amount: number;
    category: ExtraChargeCategory;
    description: string;
  } | null = null;
  let verifiedAllocation:
    | { rent: number; deposit: number; extra: number }
    | null = null;
  let verifiedDepositRequired = 0;
  let verifiedDepositPaidBefore = 0;

  if (
    decision === "verified" &&
    effectiveRentBillId
  ) {
    const [{ data: bill }, { data: existingItems }, { data: tenancy }] = await Promise.all([
      supabase
        .from("rent_bills")
        .select("amount, deposit_amount, paid_amount")
        .eq("id", effectiveRentBillId)
        .single(),
      supabase
        .from("rental_invoice_line_items")
        .select("amount")
        .eq("rent_bill_id", effectiveRentBillId),
      currentSubmission.tenancy_id
        ? supabase
            .from("tenancies")
            .select("deposit")
            .eq("id", currentSubmission.tenancy_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const existingExtraTotal = (existingItems ?? []).reduce(
      (total, item) => total + Number(item.amount ?? 0),
      0,
    );
    let extraAmount = 0;

    if (isPaymentPurpose(effectivePaymentType)) {
      verifiedDepositRequired = Math.max(
        Number(bill?.deposit_amount ?? 0),
        Number(tenancy?.deposit ?? 0),
      );
      const depositMaps = await getVerifiedDepositPaymentMaps(
        supabase,
        currentSubmission.tenancy_id ? [currentSubmission.tenancy_id] : [],
        currentSubmission.tenant_record_id
          ? [currentSubmission.tenant_record_id]
          : [],
      );
      verifiedDepositPaidBefore = verifiedDepositPaid(depositMaps, {
        tenancyId: currentSubmission.tenancy_id,
        tenantRecordId: currentSubmission.tenant_record_id,
        depositAmount: verifiedDepositRequired,
      });
      verifiedAllocation = allocatePaymentPurpose({
        purpose: effectivePaymentType,
        amount: effectiveAmount,
        rentOutstanding: Math.max(
          Number(bill?.amount ?? 0) - Number(bill?.paid_amount ?? 0),
          0,
        ),
        depositOutstanding: Math.max(
          verifiedDepositRequired - verifiedDepositPaidBefore,
          0,
        ),
      });
      extraAmount = verifiedAllocation.extra;
    } else {
      const invoiceTotal =
        Number(bill?.amount ?? 0) +
        Number(bill?.deposit_amount ?? 0) +
        existingExtraTotal;
      const outstanding = Math.max(
        invoiceTotal - Number(bill?.paid_amount ?? 0),
        0,
      );
      extraAmount = Math.max(
        effectiveAmount - outstanding,
        0,
      );
    }

    if (extraAmount > 0.005) {
      const submittedAmount = effectiveAmount;
      const requestedExtraAmount = Number(extraChargeAmountInput);

      if (
        !Number.isFinite(requestedExtraAmount) ||
        requestedExtraAmount < extraAmount - 0.005 ||
        requestedExtraAmount > submittedAmount + 0.005
      ) {
        redirect(withResult(returnTo, "error=extra_amount"));
      }

      extraAmount = requestedExtraAmount;

      if (isPaymentPurpose(effectivePaymentType)) {
        const allocationWithoutExtra = allocatePaymentPurpose({
          purpose: effectivePaymentType,
          amount: Math.max(submittedAmount - extraAmount, 0),
          rentOutstanding: Math.max(
            Number(bill?.amount ?? 0) - Number(bill?.paid_amount ?? 0),
            0,
          ),
          depositOutstanding: Math.max(
            verifiedDepositRequired - verifiedDepositPaidBefore,
            0,
          ),
        });
        verifiedAllocation = {
          ...allocationWithoutExtra,
          extra: extraAmount,
        };
      }

      if (
        !isExtraChargeCategory(extraChargeCategory) ||
        !extraChargeDescription
      ) {
        redirect(withResult(returnTo, "error=extra_purpose"));
      }
      verifiedExtraCharge = {
        amount: extraAmount,
        category: extraChargeCategory,
        description: extraChargeDescription,
      };
    }
  }

  const { data: submission, error } = await supabase
    .from("payment_submissions")
    .update({
      payment_type: effectivePaymentType,
      payment_date: effectivePaymentDate,
      bill_month: effectiveBillMonth,
      rent_bill_id: effectiveRentBillId,
      amount: effectiveAmount,
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
    reason: paymentDetailsWereCorrected
      ? [
          purposeWasCorrected
            ? `Purpose: ${currentSubmission.payment_type} to ${effectivePaymentType}.`
            : "",
          paymentDateWasCorrected
            ? `Payment date: ${currentSubmission.payment_date} to ${effectivePaymentDate}.`
            : "",
          billMonthWasCorrected
            ? `Billing month: ${currentSubmission.bill_month} to ${effectiveBillMonth}.`
            : "",
          amountWasCorrected
            ? `Submitted amount: RM ${Number(currentSubmission.amount ?? 0).toFixed(2)} to RM ${effectiveAmount.toFixed(2)}.`
            : "",
          `Reason: ${correctionReason}`,
        ]
          .filter(Boolean)
          .join(" ")
      : notes || null,
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
        .select("id, amount, deposit_amount, paid_amount, status")
        .eq("id", rentBillId)
        .single();
      const { data: existingItems } = await supabase
        .from("rental_invoice_line_items")
        .select("amount")
        .eq("rent_bill_id", rentBillId);
      const existingExtraTotal = (existingItems ?? []).reduce(
        (total, item) => total + Number(item.amount ?? 0),
        0,
      );

      if (verifiedExtraCharge) {
        const { error: extraChargeError } = await supabase
          .from("rental_invoice_line_items")
          .insert({
            rent_bill_id: rentBillId,
            payment_submission_id: submission.id,
            category: verifiedExtraCharge.category,
            description: verifiedExtraCharge.description,
            amount: verifiedExtraCharge.amount,
            created_by: user.id,
            updated_at: new Date().toISOString(),
          });

        if (extraChargeError) {
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
      }

      const oldPaidAmount = Number(bill?.paid_amount ?? 0);
      const billAmount =
        Number(bill?.amount ?? 0) +
        existingExtraTotal +
        Number(verifiedExtraCharge?.amount ?? 0);
      const amountAppliedToBill = verifiedAllocation
        ? verifiedAllocation.rent + verifiedAllocation.extra
        : Number(submission.amount ?? 0);
      const newPaidAmount = Math.min(
        oldPaidAmount + amountAppliedToBill,
        billAmount,
      );
      const depositRequired = verifiedAllocation
        ? verifiedDepositRequired
        : Number(bill?.deposit_amount ?? 0);
      const depositPaidAfter = verifiedAllocation
        ? Math.min(
            verifiedDepositPaidBefore + verifiedAllocation.deposit,
            depositRequired,
          )
        : 0;
      const invoiceTotal = billAmount + depositRequired;
      const invoicePaid = newPaidAmount + depositPaidAfter;
      const newStatus =
        invoicePaid >= invoiceTotal ? "paid" : "partially_paid";

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
        reason: verifiedExtraCharge
          ? `${extraChargeLabel(verifiedExtraCharge.category)}: ${verifiedExtraCharge.description}`
          : submission.reference_number || "Tenant payment proof verified",
      });
    }

    const paymentBase = {
      company_id: tenancy.company_id,
      payment_submission_id: submission.id,
      rent_bill_id: rentBillId,
      organization_id: tenancy.organization_id,
      tenant_id: submission.tenant_id,
      tenancy_id: tenancy.id,
      property_id: tenancy.property_id,
      unit_id: tenancy.unit_id,
      room_id: tenancy.room_id,
      payment_date: submission.payment_date,
      payment_method: submission.payment_method,
      reference_number: submission.reference_number,
      status: "confirmed",
      recorded_by: user.id,
      verified_by: user.id,
      verified_at: new Date().toISOString(),
    };
    const paymentRows = verifiedAllocation
      ? [
          ...(verifiedAllocation.rent > 0.005
            ? [{
                ...paymentBase,
                category: "monthly_rent",
                amount: verifiedAllocation.rent,
                notes: "Verified monthly rent payment proof",
              }]
            : []),
          ...(verifiedAllocation.deposit > 0.005
            ? [{
                ...paymentBase,
                category: "deposit",
                amount: verifiedAllocation.deposit,
                notes: "Verified rental deposit payment proof",
              }]
            : []),
          ...(verifiedAllocation.extra > 0.005 && verifiedExtraCharge
            ? [{
                ...paymentBase,
                category: verifiedExtraCharge.category,
                amount: verifiedAllocation.extra,
                notes: `${extraChargeLabel(verifiedExtraCharge.category)}: ${verifiedExtraCharge.description}`,
              }]
            : []),
        ]
      : [{
          ...paymentBase,
          category:
            submission.bill_type === "monthly_rent"
              ? "monthly_rent"
              : submission.payment_type,
          amount: submission.amount,
          notes: verifiedExtraCharge
            ? `Verified tenant payment; extra ${extraChargeLabel(verifiedExtraCharge.category)} RM ${verifiedExtraCharge.amount.toFixed(2)}`
            : "Verified tenant uploaded payment proof",
        }];

    if (paymentRows.length) {
      await supabase.from("payments").insert(paymentRows);
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
  if (submission.rent_bill_id) {
    revalidatePath(`/invoices/${submission.rent_bill_id}`);
  }
  redirect(withResult(returnTo, "reviewed=1"));
}

export async function reversePaymentSubmission(formData: FormData) {
  await requireRole(["super_admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const submissionId = textValue(formData, "submissionId");
  const reason = textValue(formData, "reason");
  const returnTo = returnPath(formData);

  if (!user || !submissionId || !reason) {
    redirect(withResult(returnTo, "error=reason"));
  }

  const supabase = await getAdmin();
  const { data: submission } = await supabase
    .from("payment_submissions")
    .select("id, verification_status, rent_bill_id")
    .eq("id", submissionId)
    .single();

  if (!submission || submission.verification_status !== "verified") {
    redirect(withResult(returnTo, "error=not_verified"));
  }

  const { error: reversalError } = await supabase.rpc(
    "reverse_verified_payment_submission",
    {
      p_submission_id: submission.id,
      p_actor_id: user.id,
      p_reason: reason,
    },
  );

  if (reversalError) {
    const errorCode = reversalError.message.includes("safely linked")
      ? "reversal_link_missing"
      : "review";
    redirect(withResult(returnTo, `error=${errorCode}`));
  }

  revalidatePath("/payment-verification");
  revalidatePath("/verification");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  if (submission.rent_bill_id) {
    revalidatePath(`/invoices/${submission.rent_bill_id}`);
  }
  redirect(withResult(returnTo, "reversed=1"));
}
