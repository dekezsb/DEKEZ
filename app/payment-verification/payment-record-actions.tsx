"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMalaysiaDateTime } from "@/lib/date-format";
import { EXTRA_CHARGE_OPTIONS } from "@/lib/payments/extra-charges";
import {
  allocatePaymentPurpose,
  isPaymentPurpose,
  PAYMENT_PURPOSES,
  paymentPurposeLabel,
} from "@/lib/payments/payment-purpose";
import { statusBadgeClass } from "@/lib/status-styles";
import {
  reviewPaymentSubmission,
  reversePaymentSubmission,
} from "./actions";

type PaymentRecordActionsProps = {
  submissionId: string;
  status: string;
  tenantName: string;
  propertyName: string;
  roomName: string;
  billMonth: string;
  paymentDate: string;
  amountSubmitted: string;
  amountSubmittedValue: number;
  paymentPurpose: string;
  invoiceOutstanding: number;
  rentOutstanding: number;
  depositOutstanding: number;
  referenceNumber: string;
  receiptUrl?: string | null;
  receiptIsImage: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
  canCorrectPurpose?: boolean;
  canReverse?: boolean;
  returnTo?: string;
};

function statusLabel(status: string) {
  if (status === "verified") {
    return "✓ Verified";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  return "Pending Verification";
}

export function PaymentRecordActions({
  submissionId,
  status,
  tenantName,
  propertyName,
  roomName,
  billMonth,
  paymentDate,
  amountSubmitted,
  amountSubmittedValue,
  paymentPurpose,
  invoiceOutstanding,
  rentOutstanding,
  depositOutstanding,
  referenceNumber,
  receiptUrl,
  receiptIsImage,
  verifiedBy,
  verifiedAt,
  rejectionReason,
  canCorrectPurpose = false,
  canReverse = false,
  returnTo = "/payment-verification",
}: PaymentRecordActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [selectedPurpose, setSelectedPurpose] = useState(paymentPurpose);
  const [correctedPaymentDate, setCorrectedPaymentDate] = useState(paymentDate);
  const originalBillingMonth = billMonth === "-" ? "" : billMonth.slice(0, 7);
  const [correctedBillingMonth, setCorrectedBillingMonth] =
    useState(originalBillingMonth);
  const [correctedAmount, setCorrectedAmount] = useState(
    amountSubmittedValue.toFixed(2),
  );
  const correctedAmountValue = Math.max(Number(correctedAmount) || 0, 0);
  const defaultAllocation = allocatePaymentPurpose({
    purpose: isPaymentPurpose(paymentPurpose) ? paymentPurpose : "monthly_rent",
    amount: amountSubmittedValue,
    rentOutstanding,
    depositOutstanding,
  });
  const [rentalAmount, setRentalAmount] = useState(
    defaultAllocation.rent.toFixed(2),
  );
  const [depositAmount, setDepositAmount] = useState(
    defaultAllocation.deposit.toFixed(2),
  );
  const [extraChargeAmount, setExtraChargeAmount] = useState(
    defaultAllocation.extra.toFixed(2),
  );
  const [rentPricingMode, setRentPricingMode] = useState("one_time");
  const [recurringMonthlyRent, setRecurringMonthlyRent] = useState(
    defaultAllocation.rent.toFixed(2),
  );
  const selectedRentalAmount = Math.max(Number(rentalAmount) || 0, 0);
  const selectedDepositAmount = Math.max(Number(depositAmount) || 0, 0);
  const selectedExtraAmount = Math.max(Number(extraChargeAmount) || 0, 0);
  const totalAllocated =
    selectedRentalAmount + selectedDepositAmount + selectedExtraAmount;
  const allocationDifference = correctedAmountValue - totalAllocated;
  const hasExtraAmount = selectedExtraAmount > 0.005;
  const amountApplied = selectedRentalAmount + selectedExtraAmount;
  const remainingAfterVerification = Math.max(
    invoiceOutstanding + selectedExtraAmount - amountApplied,
    0,
  );
  const hasCorrection =
    selectedPurpose !== paymentPurpose ||
    correctedPaymentDate !== paymentDate ||
    correctedBillingMonth !== originalBillingMonth ||
    Math.abs(correctedAmountValue - amountSubmittedValue) > 0.005;

  return (
    <div className="space-y-3">
      <Badge className={statusBadgeClass(status)}>{statusLabel(status)}</Badge>
      {status === "verified" ? (
        <>
          <div className="text-xs leading-5 text-gray-500">
            <p>Verified by {verifiedBy ?? "-"}</p>
            <p>{formatMalaysiaDateTime(verifiedAt)}</p>
          </div>
          {canReverse ? (
            <Button
              className="border-amber-300 text-amber-800 hover:bg-amber-50"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setReverseOpen(true)}
            >
              Undo verification
            </Button>
          ) : null}
        </>
      ) : null}
      {status === "rejected" ? (
        <p className="text-xs leading-5 text-red-600">{rejectionReason ?? "Payment proof rejected."}</p>
      ) : null}
      {status !== "verified" ? (
        <div className="grid gap-2">
          <Button size="sm" type="button" onClick={() => setConfirmOpen(true)}>Verify</Button>
          <Button className="border-red-200 text-red-700 hover:bg-red-50" size="sm" type="button" variant="outline" onClick={() => setRejectOpen(true)}>
            Reject
          </Button>
        </div>
      ) : null}

      {receiptUrl ? (
        <Button size="sm" type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
          Preview slip
        </Button>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-950">Confirm that this payment has been received?</h2>
            <div className="mt-4 grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
              <p>Tenant: <span className="font-medium text-gray-950">{tenantName}</span></p>
              <p>Property: <span className="font-medium text-gray-950">{propertyName}</span></p>
              <p>Room: <span className="font-medium text-gray-950">{roomName}</span></p>
              <p>Bill month: <span className="font-medium text-gray-950">{billMonth}</span></p>
              <p>Amount submitted: <span className="font-medium text-gray-950">{amountSubmitted}</span></p>
              <p>Submitted for: <span className="font-medium text-gray-950">{paymentPurposeLabel(paymentPurpose)}</span></p>
              <p>Reference: <span className="font-medium text-gray-950">{referenceNumber || "-"}</span></p>
            </div>
            {hasExtraAmount ? (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
                <p className="font-semibold text-amber-950">
                  This payment includes an extra charge
                </p>
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm text-amber-950">
                  <dt>Current invoice outstanding</dt>
                  <dd className="font-semibold">RM {invoiceOutstanding.toFixed(2)}</dd>
                  <dt>Applied to current invoice</dt>
                  <dd className="font-semibold">RM {amountApplied.toFixed(2)}</dd>
                  <dt>Extra charge to add</dt>
                  <dd className="font-bold">
                    RM {selectedExtraAmount.toFixed(2)}
                  </dd>
                  <dt>Invoice balance after verification</dt>
                  <dd className="font-bold">
                    RM {remainingAfterVerification.toFixed(2)}
                  </dd>
                  {Math.abs(allocationDifference) > 0.005 ? (
                    <>
                      <dt>Receipt / allocation difference</dt>
                      <dd className="font-bold">
                        RM {allocationDifference.toFixed(2)}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <p className="mt-3 text-sm text-amber-900">
                  Select the charge type and write exactly what it is for. The
                  extra amount will appear as a separate item on this
                  month&apos;s invoice.
                </p>
              </div>
            ) : null}
            <ReceiptPreview receiptUrl={receiptUrl} receiptIsImage={receiptIsImage} />
            <form action={reviewPaymentSubmission} className="mt-5 space-y-4">
              <input name="submissionId" type="hidden" value={submissionId} />
              <input name="decision" type="hidden" value="verified" />
              <input name="returnTo" type="hidden" value={returnTo} />
              {canCorrectPurpose ? (
                <div className="rounded-md border border-[#d7dde5] bg-gray-50 p-4">
                  <p className="font-semibold text-gray-950">
                    Correct payment details
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Super Admin may correct details selected wrongly by the
                    tenant before verification.
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-800">
                        Amount submitted (RM)
                      </span>
                      <input
                        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
                        min="0.01"
                        name="amountSubmittedOverride"
                        step="0.01"
                        type="number"
                        value={correctedAmount}
                        onChange={(event) => {
                          const nextAmount = event.target.value;
                          setCorrectedAmount(nextAmount);
                          if (selectedPurpose === "other") {
                            setRentalAmount("0");
                            setDepositAmount("0");
                            setExtraChargeAmount(nextAmount);
                          }
                        }}
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-800">
                        Payment for
                      </span>
                      <select
                        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
                        name="paymentPurposeOverride"
                        value={selectedPurpose}
                        onChange={(event) => {
                          const nextPurpose = event.target.value;
                          setSelectedPurpose(nextPurpose);
                          if (nextPurpose === "other") {
                            setRentalAmount("0");
                            setDepositAmount("0");
                            setExtraChargeAmount(correctedAmount);
                          }
                        }}
                      >
                        {PAYMENT_PURPOSES.map((purpose) => (
                          <option key={purpose} value={purpose}>
                            {paymentPurposeLabel(purpose)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-800">
                        Payment date
                      </span>
                      <input
                        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
                        name="paymentDateOverride"
                        type="date"
                        value={correctedPaymentDate}
                        onChange={(event) =>
                          setCorrectedPaymentDate(event.target.value)
                        }
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-800">
                        Billing month
                      </span>
                      <input
                        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
                        name="billMonthOverride"
                        type="month"
                        value={correctedBillingMonth}
                        onChange={(event) =>
                          setCorrectedBillingMonth(event.target.value)
                        }
                        required
                      />
                    </label>
                    {hasCorrection ? (
                      <label className="block">
                        <span className="text-sm font-medium text-gray-800">
                          Reason for correction
                        </span>
                        <input
                          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
                          maxLength={300}
                          name="correctionReason"
                          placeholder="Example: Tenant selected the wrong month"
                          required
                        />
                      </label>
                    ) : null}
                  </div>
                </div>
              ) : (
                <input
                  name="paymentPurposeOverride"
                  type="hidden"
                  value={paymentPurpose}
                />
              )}
              {!hasExtraAmount ? (
                <div className="rounded-md border border-[#d7dde5] bg-white p-4">
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-gray-600">Amount applied</dt>
                    <dd className="font-semibold text-gray-950">
                      RM {amountApplied.toFixed(2)}
                    </dd>
                    <dt className="text-gray-600">
                      Remaining invoice balance
                    </dt>
                    <dd className="font-bold text-red-600">
                      RM {remainingAfterVerification.toFixed(2)}
                    </dd>
                  </dl>
                </div>
              ) : null}
              {canCorrectPurpose ? (
                <div className="rounded-md border border-[#d7dde5] bg-white p-4">
                  <p className="font-semibold text-gray-950">
                    Allocate verified payment
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Enter the exact amounts. Super Admin values are not capped
                    by the submitted receipt or invoice balance.
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-800">
                        Rental amount (RM)
                      </span>
                      <input
                        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 font-semibold"
                        min="0"
                        name="rentalAmount"
                        step="0.01"
                        type="number"
                        value={rentalAmount}
                        onChange={(event) => {
                          setRentalAmount(event.target.value);
                          if (rentPricingMode === "recurring") {
                            setRecurringMonthlyRent(event.target.value);
                          }
                        }}
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-800">
                        Deposit amount (RM)
                      </span>
                      <input
                        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 font-semibold"
                        min="0"
                        name="depositAmount"
                        step="0.01"
                        type="number"
                        value={depositAmount}
                        onChange={(event) => setDepositAmount(event.target.value)}
                        required
                      />
                    </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-800">
                      Extra-charge amount (RM)
                    </span>
                    <input
                      className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 font-semibold"
                      min="0"
                      name="extraChargeAmount"
                      step="0.01"
                      type="number"
                      value={extraChargeAmount}
                      onChange={(event) =>
                        setExtraChargeAmount(event.target.value)
                      }
                      required
                    />
                  </label>
                  </div>
                  <dl className="mt-4 grid grid-cols-[1fr_auto] gap-2 border-t border-[#e3e8ef] pt-3 text-sm">
                    <dt>Total allocated</dt>
                    <dd className="font-semibold">
                      RM {totalAllocated.toFixed(2)}
                    </dd>
                    <dt>Submitted receipt</dt>
                    <dd className="font-semibold">
                      RM {correctedAmountValue.toFixed(2)}
                    </dd>
                    <dt>Difference</dt>
                    <dd
                      className={
                        Math.abs(allocationDifference) > 0.005
                          ? "font-bold text-amber-700"
                          : "font-bold text-emerald-700"
                      }
                    >
                      RM {allocationDifference.toFixed(2)}
                    </dd>
                  </dl>
                </div>
              ) : null}
              {canCorrectPurpose && selectedRentalAmount > 0.005 ? (
                <div className="rounded-md border border-[#d7dde5] bg-[#fbfcfe] p-4">
                  <p className="font-semibold text-gray-950">
                    Rental price after this verification
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Choose whether this is only for this payment or becomes the
                    tenant&apos;s recurring room rental from the next billing
                    month.
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-800">
                        Price treatment
                      </span>
                      <select
                        className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
                        name="rentPricingMode"
                        value={rentPricingMode}
                        onChange={(event) => {
                          const nextMode = event.target.value;
                          setRentPricingMode(nextMode);
                          if (nextMode === "recurring") {
                            setRecurringMonthlyRent(rentalAmount);
                          }
                        }}
                      >
                        <option value="one_time">
                          This payment only — do not change monthly rent
                        </option>
                        <option value="recurring">
                          New recurring monthly rent
                        </option>
                      </select>
                    </label>
                    {rentPricingMode === "recurring" ? (
                      <label className="block">
                        <span className="text-sm font-medium text-gray-800">
                          New monthly rental (RM)
                        </span>
                        <input
                          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 font-semibold"
                          min="0.01"
                          name="recurringMonthlyRent"
                          onChange={(event) =>
                            setRecurringMonthlyRent(event.target.value)
                          }
                          required
                          step="0.01"
                          type="number"
                          value={recurringMonthlyRent}
                        />
                      </label>
                    ) : null}
                    {rentPricingMode === "recurring" ? (
                      <label className="block sm:col-span-2">
                        <span className="text-sm font-medium text-gray-800">
                          Reason for recurring price change
                        </span>
                        <input
                          className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
                          maxLength={300}
                          name="recurringRentReason"
                          placeholder="Example: Approved recurring discount or revised room rate"
                          required
                        />
                      </label>
                    ) : null}
                  </div>
                  {rentPricingMode === "recurring" ? (
                    <p className="mt-3 text-sm font-medium text-amber-800">
                      After verification, this updates the room, tenancy,
                      future invoices and the current unsigned agreement. A
                      signed historical agreement remains protected.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {hasExtraAmount ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-gray-800">
                      Extra payment for
                    </span>
                    <select
                      className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                      name="extraChargeCategory"
                      required
                    >
                      <option value="">Choose purpose</option>
                      {EXTRA_CHARGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-800">
                      What is this extra charge for?
                    </span>
                    <input
                      className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                      name="extraChargeDescription"
                      placeholder="Example: Key lock replacement for Room 1"
                      required
                    />
                  </label>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                <Button type="submit">Confirm & Verify</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {rejectOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-950">Reject payment proof</h2>
            <p className="mt-2 text-sm text-gray-600">Please enter the rejection reason so the tenant knows what to fix.</p>
            <form action={reviewPaymentSubmission} className="mt-5 space-y-3">
              <input name="submissionId" type="hidden" value={submissionId} />
              <input name="decision" type="hidden" value="rejected" />
              <input name="returnTo" type="hidden" value={returnTo} />
              <select className="w-full rounded-md border border-[#d7dde5] px-3 py-2" name="notes" required>
                <option value="">Choose reason</option>
                <option value="Amount not received">Amount not received</option>
                <option value="Wrong amount">Wrong amount</option>
                <option value="Duplicate slip">Duplicate slip</option>
                <option value="Invalid receipt">Invalid receipt</option>
                <option value="Wrong bank account">Wrong bank account</option>
              </select>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
                <Button className="bg-red-600 text-white hover:bg-red-700" type="submit">Reject payment</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-950">Payment slip</h2>
              <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            </div>
            <ReceiptPreview receiptUrl={receiptUrl} receiptIsImage={receiptIsImage} large />
          </div>
        </div>
      ) : null}

      {reverseOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-950">
              Undo this verification?
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              This restores the invoice balance and returns the slip to Pending
              Verification. The payment and audit history will be retained.
            </p>
            <form action={reversePaymentSubmission} className="mt-5 space-y-4">
              <input name="submissionId" type="hidden" value={submissionId} />
              <input name="returnTo" type="hidden" value={returnTo} />
              <label className="block">
                <span className="text-sm font-medium text-gray-800">
                  Reason for undo
                </span>
                <textarea
                  className="mt-2 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  name="reason"
                  placeholder="Explain what was verified incorrectly"
                  required
                />
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReverseOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-amber-600 text-white hover:bg-amber-700"
                  type="submit"
                >
                  Confirm Undo
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReceiptPreview({
  receiptUrl,
  receiptIsImage,
  large,
}: {
  receiptUrl?: string | null;
  receiptIsImage: boolean;
  large?: boolean;
}) {
  if (!receiptUrl) {
    return <p className="mt-4 text-sm text-gray-500">No receipt uploaded.</p>;
  }

  return (
    <div className="mt-4 rounded-lg border border-[#d7dde5] bg-[#f4f6f8] p-3">
      {receiptIsImage ? (
        <img
          alt="Payment receipt"
          className={large ? "max-h-[70vh] w-full object-contain" : "max-h-80 w-full object-contain"}
          src={receiptUrl}
        />
      ) : (
        <p className="text-sm text-gray-600">This receipt is a PDF or document.</p>
      )}
      <a className="mt-3 inline-flex text-sm font-medium text-[#126b5f]" href={receiptUrl} target="_blank">
        Open full receipt
      </a>
    </div>
  );
}
