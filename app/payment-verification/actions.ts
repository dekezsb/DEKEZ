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
import { createRentChangeAgreement } from "@/lib/tenancy/agreement";
import { convertTenantApplication } from "@/lib/tenancy/convert-application";
import { extendFingerprintAccessAfterPayment } from "@/lib/ttlock/fingerprint";

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

function followingMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function normalizeStoredPaymentType(value: string) {
  return value === "first_month_rental" ? "monthly_rent" : value;
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
  const rentalAmountInput = textValue(formData, "rentalAmount");
  const depositAmountInput = textValue(formData, "depositAmount");
  const rentPricingMode = textValue(formData, "rentPricingMode");
  const recurringMonthlyRentInput = textValue(
    formData,
    "recurringMonthlyRent",
  );
  const recurringRentReason = textValue(formData, "recurringRentReason");
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
    .select("id, verification_status, rent_bill_id, tenant_application_id, tenancy_id, tenant_id, tenant_record_id, property_id, room_id, payment_type, amount, payment_date, bill_month")
    .eq("id", submissionId)
    .single();

  if (!currentSubmission) {
    redirect(withResult(returnTo, "error=review"));
  }

  if (currentSubmission.verification_status === "verified") {
    redirect(withResult(returnTo, "error=already_verified"));
  }

  if (decision === "verified" && currentSubmission.tenant_application_id) {
    const { data: applicationReadiness } = await supabase
      .from("tenant_applications")
      .select("rental_model, verification_status")
      .eq("id", currentSubmission.tenant_application_id)
      .maybeSingle();
    if (
      applicationReadiness?.rental_model === "monthly_stay" &&
      applicationReadiness.verification_status !== "verified"
    ) {
      redirect(withResult(returnTo, "error=identity_first"));
    }
  }

  let effectiveTenancyId = currentSubmission.tenancy_id;
  if (
    decision === "verified" &&
    !effectiveTenancyId &&
    currentSubmission.tenant_id &&
    currentSubmission.property_id &&
    currentSubmission.room_id
  ) {
    const { data: activeTenancy } = await supabase
      .from("tenancies")
      .select("id")
      .eq("tenant_id", currentSubmission.tenant_id)
      .eq("property_id", currentSubmission.property_id)
      .eq("room_id", currentSubmission.room_id)
      .eq("status", "active")
      .is("checkout_date", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    effectiveTenancyId = activeTenancy?.id ?? null;
  }

  let effectivePaymentType = normalizeStoredPaymentType(
    currentSubmission.payment_type,
  );
  let effectivePaymentDate = currentSubmission.payment_date;
  let effectiveBillMonth = currentSubmission.bill_month;
  let effectiveRentBillId = currentSubmission.rent_bill_id;
  let effectiveAmount = Number(currentSubmission.amount ?? 0);
  const purposeWasCorrected =
    decision === "verified" &&
    paymentPurposeOverride &&
    paymentPurposeOverride !== effectivePaymentType;
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
  const recurringRentRequested =
    decision === "verified" && rentPricingMode === "recurring";
  const recurringMonthlyRent = Number(recurringMonthlyRentInput);

  if (
    recurringRentRequested
    && (
      role !== "super_admin"
      || !effectiveTenancyId
      || !Number.isFinite(recurringMonthlyRent)
      || recurringMonthlyRent <= 0
      || !recurringRentReason
    )
  ) {
    redirect(withResult(returnTo, "error=recurring_rent"));
  }
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
    if (!effectiveTenancyId && !currentSubmission.tenant_application_id) {
      redirect(withResult(returnTo, "error=correction_bill_missing"));
    }

    const { data: targetBill } = effectiveTenancyId
      ? await supabase
          .from("rent_bills")
          .select("id, bill_month, status")
          .eq("tenancy_id", effectiveTenancyId)
          .eq("bill_month", normalizedBillMonth)
          .maybeSingle()
      : { data: null };

    if (effectiveTenancyId && !targetBill) {
      redirect(withResult(returnTo, "error=correction_bill_missing"));
    }
    if (targetBill?.status === "paid") {
      redirect(withResult(returnTo, "error=correction_bill_paid"));
    }

    const { data: existingPending } = targetBill
      ? await supabase
          .from("payment_submissions")
          .select("id")
          .eq("rent_bill_id", targetBill.id)
          .eq("verification_status", "pending_verification")
          .neq("id", submissionId)
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (existingPending) {
      redirect(withResult(returnTo, "error=correction_bill_pending"));
    }

    effectiveRentBillId = targetBill?.id ?? null;
    effectiveBillMonth = targetBill?.bill_month ?? normalizedBillMonth;
  }

  let verifiedExtraCharge: {
    amount: number;
    category: ExtraChargeCategory;
    description: string;
  } | null = null;
  let verifiedAllocation:
    | { rent: number; deposit: number; extra: number; credit: number }
    | null = null;
  let verifiedDepositRequired = 0;
  let verifiedDepositPaidBefore = 0;
  const hasManualAllocation =
    decision === "verified" &&
    role === "super_admin" &&
    rentalAmountInput !== "" &&
    depositAmountInput !== "" &&
    extraChargeAmountInput !== "";

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
      effectiveTenancyId
        ? supabase
            .from("tenancies")
            .select("deposit")
            .eq("id", effectiveTenancyId)
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
        effectiveTenancyId ? [effectiveTenancyId] : [],
        currentSubmission.tenant_record_id
          ? [currentSubmission.tenant_record_id]
          : [],
      );
      verifiedDepositPaidBefore = verifiedDepositPaid(depositMaps, {
        tenancyId: effectiveTenancyId,
        tenantRecordId: currentSubmission.tenant_record_id,
        depositAmount: verifiedDepositRequired,
      });
      if (hasManualAllocation) {
        const manualAllocation = {
          rent: Number(rentalAmountInput),
          deposit: Number(depositAmountInput),
          extra: Number(extraChargeAmountInput),
        };
        if (
          Object.values(manualAllocation).some(
            (amount) => !Number.isFinite(amount) || amount < 0,
          ) ||
          manualAllocation.rent +
            manualAllocation.deposit +
            manualAllocation.extra <=
            0
        ) {
          redirect(withResult(returnTo, "error=allocation_amount"));
        }
        verifiedAllocation = {
          ...manualAllocation,
          credit: 0,
        };
        effectiveAmount =
          manualAllocation.rent +
          manualAllocation.deposit +
          manualAllocation.extra;
      } else {
        const initialAllocation = allocatePaymentPurpose({
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
        verifiedAllocation = {
          ...initialAllocation,
          credit: 0,
        };
      }
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
      const requestedExtraAmount = Number(extraChargeAmountInput);

      if (
        !Number.isFinite(requestedExtraAmount) ||
        requestedExtraAmount <= 0
      ) {
        redirect(withResult(returnTo, "error=extra_amount"));
      }

      if (isPaymentPurpose(effectivePaymentType) && !hasManualAllocation) {
        const availableExtraPayment = verifiedAllocation?.extra ?? 0;
        const extraPaymentApplied = Math.min(
          availableExtraPayment,
          requestedExtraAmount,
        );
        verifiedAllocation = {
          rent: verifiedAllocation?.rent ?? 0,
          deposit: verifiedAllocation?.deposit ?? 0,
          extra: extraPaymentApplied,
          credit: Math.max(availableExtraPayment - extraPaymentApplied, 0),
        };
      }

      if (
        !isExtraChargeCategory(extraChargeCategory) ||
        !extraChargeDescription
      ) {
        redirect(withResult(returnTo, "error=extra_purpose"));
      }
      verifiedExtraCharge = {
        amount: requestedExtraAmount,
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
      tenancy_id: effectiveTenancyId,
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
    .select("id, tenant_id, tenant_application_id, tenancy_id, rent_bill_id, property_id, unit_id, room_id, bill_month, bill_type, payment_type, amount, payment_date, payment_method, reference_number")
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
      const { data: applicationBeforeConversion } = await supabase
        .from("tenant_applications")
        .select("tenant_id, rental_model, verification_status")
        .eq("id", submission.tenant_application_id)
        .maybeSingle();

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

      if (applicationBeforeConversion?.tenant_id) {
        const { data: authUser } = await supabase.auth.admin.getUserById(
          applicationBeforeConversion.tenant_id,
        );
        await Promise.all([
          supabase
            .from("profiles")
            .update({
              role: "tenant",
              global_role: "tenant",
              registration_status: "approved",
              registration_reviewed_by: user.id,
              registration_reviewed_at: new Date().toISOString(),
              registration_rejection_reason: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", applicationBeforeConversion.tenant_id),
          supabase.auth.admin.updateUserById(
            applicationBeforeConversion.tenant_id,
            {
              app_metadata: {
                ...(authUser.user?.app_metadata ?? {}),
                role: "tenant",
              },
            },
          ),
        ]);
      }
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

    if (!rentBillId && submission.bill_type === "check_in") {
      const { data: firstBill } = await supabase
        .from("rent_bills")
        .select("id, bill_month")
        .eq("tenancy_id", tenancy.id)
        .order("bill_month", { ascending: true })
        .limit(1)
        .maybeSingle();
      rentBillId = firstBill?.id ?? null;
      effectiveBillMonth = firstBill?.bill_month ?? effectiveBillMonth;
    }

    await supabase
      .from("payment_submissions")
      .update({
        tenancy_id: tenancy.id,
        rent_bill_id: rentBillId,
        bill_month: effectiveBillMonth,
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
          ...(verifiedAllocation.credit > 0.005
            ? [{
                ...paymentBase,
                category: "payment_credit",
                amount: verifiedAllocation.credit,
                notes: "Unallocated verified payment credit",
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

    if (
      recurringRentRequested
      && submission.tenancy_id
      && submission.room_id
    ) {
      const { data: tenancyForRent } = await supabase
        .from("tenancies")
        .select("id, room_id, monthly_rent, monthly_rental, rental_model")
        .eq("id", submission.tenancy_id)
        .single();
      const oldMonthlyRent = Number(
        tenancyForRent?.monthly_rental
        ?? tenancyForRent?.monthly_rent
        ?? 0,
      );
      const effectiveMonth = followingMonth(
        submission.bill_month ?? effectiveBillMonth,
      );

      const coreUpdates = await Promise.all([
        supabase
          .from("tenancies")
          .update({
            monthly_rent: recurringMonthlyRent,
            monthly_rental: recurringMonthlyRent,
            updated_at: new Date().toISOString(),
          })
          .eq("id", submission.tenancy_id),
        supabase
          .from("rooms")
          .update({
            monthly_rent: recurringMonthlyRent,
            updated_at: new Date().toISOString(),
          })
          .eq("id", submission.room_id),
        supabase
          .from("tenant_records")
          .update({
            monthly_rent: recurringMonthlyRent,
            updated_at: new Date().toISOString(),
          })
          .eq("room_id", submission.room_id)
          .eq("status", "active"),
      ]);

      if (coreUpdates.some((result) => result.error)) {
        redirect(withResult(returnTo, "error=recurring_rent"));
      }

      const { data: futureBills } = await supabase
        .from("rent_bills")
        .select("id, paid_amount")
        .eq("tenancy_id", submission.tenancy_id)
        .gte("bill_month", effectiveMonth)
        .not("status", "in", "(paid,cancelled,waived)");

      for (const futureBill of futureBills ?? []) {
        await supabase
          .from("rent_bills")
          .update({
            amount: Math.max(
              recurringMonthlyRent,
              Number(futureBill.paid_amount ?? 0),
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("id", futureBill.id);
      }

      const rentChangeAgreement = tenancyForRent?.rental_model === "monthly_stay"
        ? null
        : await createRentChangeAgreement(
            supabase,
            submission.tenancy_id,
            user.id,
            {
              effectiveStartDate: effectiveMonth,
              monthlyRent: recurringMonthlyRent,
            },
          );
      let agreementSyncStatus:
        | "updated_unsigned"
        | "created_amendment"
        | "signed_history_preserved"
        | "not_found" = "not_found";

      if (rentChangeAgreement) {
        agreementSyncStatus = rentChangeAgreement.created
          ? "created_amendment"
          : "updated_unsigned";
      }

      const { error: adjustmentError } = await supabase
        .from("tenancy_rent_adjustments")
        .insert({
          tenancy_id: submission.tenancy_id,
          room_id: submission.room_id,
          payment_submission_id: submission.id,
          agreement_id: rentChangeAgreement?.id ?? null,
          old_monthly_rent: oldMonthlyRent,
          new_monthly_rent: recurringMonthlyRent,
          effective_month: effectiveMonth,
          change_type:
            recurringMonthlyRent >= oldMonthlyRent ? "increase" : "discount",
          reason: recurringRentReason,
          agreement_sync_status: agreementSyncStatus,
          approved_by: user.id,
        });

      if (adjustmentError) {
        redirect(withResult(returnTo, "error=recurring_rent"));
      }
    }

    if (rentBillId) {
      const fingerprintResult = await extendFingerprintAccessAfterPayment({
        tenancyId: tenancy.id,
        paymentSubmissionId: submission.id,
        performedBy: user.id,
      }).catch((fingerprintError) => {
        console.error("Verified payment could not update TTLock fingerprint access.", {
          tenancyId: tenancy.id,
          paymentSubmissionId: submission.id,
          error: fingerprintError,
        });
        return null;
      });
      if (fingerprintResult?.errors.length) {
        console.error("Some TTLock fingerprint credentials need attention.", {
          tenancyId: tenancy.id,
          errors: fingerprintResult.errors,
        });
      }
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
  revalidatePath("/tenancy-agreements");
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
