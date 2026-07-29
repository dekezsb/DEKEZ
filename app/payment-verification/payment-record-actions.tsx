"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMalaysiaDateTime } from "@/lib/date-format";
import { EXTRA_CHARGE_OPTIONS } from "@/lib/payments/extra-charges";
import { paymentPurposeLabel } from "@/lib/payments/payment-purpose";
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
  amountSubmitted: string;
  amountSubmittedValue: number;
  paymentPurpose: string;
  invoiceOutstanding: number;
  referenceNumber: string;
  receiptUrl?: string | null;
  receiptIsImage: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
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
  amountSubmitted,
  amountSubmittedValue,
  paymentPurpose,
  invoiceOutstanding,
  referenceNumber,
  receiptUrl,
  receiptIsImage,
  verifiedBy,
  verifiedAt,
  rejectionReason,
  canReverse = false,
  returnTo = "/payment-verification",
}: PaymentRecordActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const extraAmount = Math.max(
    amountSubmittedValue - invoiceOutstanding,
    0,
  );
  const hasExtraAmount = extraAmount > 0.005;

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
              <p>Payment for: <span className="font-medium text-gray-950">{paymentPurposeLabel(paymentPurpose)}</span></p>
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
                  <dd className="font-semibold">
                    RM {Math.min(amountSubmittedValue, invoiceOutstanding).toFixed(2)}
                  </dd>
                  <dt>Extra charge to add</dt>
                  <dd className="font-bold">RM {extraAmount.toFixed(2)}</dd>
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
