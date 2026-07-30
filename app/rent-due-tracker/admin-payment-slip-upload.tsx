"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  allocatePaymentPurpose,
  paymentPurposeTotal,
  type PaymentPurpose,
} from "@/lib/payments/payment-purpose";
import { uploadRentPaymentSlip } from "./actions";

const moneyFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

type AdminPaymentSlipUploadProps = {
  billId: string;
  tenantName: string;
  propertyName: string;
  roomName: string;
  rentOutstanding: number;
  depositOutstanding: number;
  outstandingLabel: string;
  paymentDateDefault: string;
  selectedMonth: string;
  selectedProperty: string;
};

export function AdminPaymentSlipUpload({
  billId,
  tenantName,
  propertyName,
  roomName,
  rentOutstanding,
  depositOutstanding,
  outstandingLabel,
  paymentDateDefault,
  selectedMonth,
  selectedProperty,
}: AdminPaymentSlipUploadProps) {
  const [open, setOpen] = useState(false);
  const defaultPurpose: PaymentPurpose =
    rentOutstanding > 0.005 && depositOutstanding > 0.005
      ? "rent_and_deposit"
      : depositOutstanding > 0.005
        ? "deposit"
        : "monthly_rent";
  const [paymentPurpose, setPaymentPurpose] =
    useState<PaymentPurpose>(defaultPurpose);
  const [amount, setAmount] = useState(
    paymentPurposeTotal(
      defaultPurpose,
      rentOutstanding,
      depositOutstanding,
    ).toFixed(2),
  );
  const numericAmount = Number(amount);
  const submittedAmount =
    Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0;
  const allocation = allocatePaymentPurpose({
    purpose: paymentPurpose,
    amount: submittedAmount,
    rentOutstanding,
    depositOutstanding,
  });
  const selectedOutstanding = paymentPurposeTotal(
    paymentPurpose,
    rentOutstanding,
    depositOutstanding,
  );
  const remainingAmount = Math.max(selectedOutstanding - submittedAmount, 0);

  return (
    <>
      <Button
        className="whitespace-nowrap border-[#d9bf84] text-[#8a641d] hover:bg-[#fff8e8]"
        onClick={() => {
          setPaymentPurpose(defaultPurpose);
          setAmount(
            paymentPurposeTotal(
              defaultPurpose,
              rentOutstanding,
              depositOutstanding,
            ).toFixed(2),
          );
          setOpen(true);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <Paperclip aria-hidden="true" className="size-4" />
        Upload Slip
      </Button>

      {open ? (
        <div
          aria-labelledby={`upload-slip-${billId}`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-950" id={`upload-slip-${billId}`}>
                Upload tenant payment slip
              </h2>
              <Button onClick={() => setOpen(false)} type="button" variant="outline">
                Close
              </Button>
            </div>

            <div className="mb-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
              <p>Tenant: <span className="font-medium text-gray-950">{tenantName}</span></p>
              <p>Property: <span className="font-medium text-gray-950">{propertyName}</span></p>
              <p>Room: <span className="font-medium text-gray-950">{roomName}</span></p>
              <p>Outstanding: <span className="font-medium text-red-700">{outstandingLabel}</span></p>
              <p>Rent owing: <span className="font-medium text-gray-950">{moneyFormatter.format(rentOutstanding)}</span></p>
              <p>Deposit owing: <span className="font-medium text-amber-700">{moneyFormatter.format(depositOutstanding)}</span></p>
            </div>

            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              The slip moves to Payment Verification after submission. The
              official balance changes only after an authorized Admin verifies
              the amount. A partial balance remains open until fully paid.
            </p>

            <form action={uploadRentPaymentSlip} className="grid gap-4 sm:grid-cols-2">
              <input name="billId" type="hidden" value={billId} />
              <input name="returnMonth" type="hidden" value={selectedMonth} />
              <input name="returnProperty" type="hidden" value={selectedProperty} />
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-700">
                  What is this payment for?
                </span>
                <select
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  name="paymentPurpose"
                  onChange={(event) => {
                    const purpose = event.target.value as PaymentPurpose;
                    setPaymentPurpose(purpose);
                    setAmount(
                      purpose === "other"
                        ? ""
                        : paymentPurposeTotal(
                            purpose,
                            rentOutstanding,
                            depositOutstanding,
                          ).toFixed(2),
                    );
                  }}
                  value={paymentPurpose}
                >
                  <option
                    disabled={rentOutstanding <= 0.005}
                    value="monthly_rent"
                  >
                    Monthly Rent
                    {rentOutstanding <= 0.005 ? " - no rent owing" : ""}
                  </option>
                  <option
                    disabled={depositOutstanding <= 0.005}
                    value="deposit"
                  >
                    Deposit Only
                    {depositOutstanding <= 0.005 ? " - no deposit owing" : ""}
                  </option>
                  <option
                    disabled={
                      rentOutstanding <= 0.005
                      || depositOutstanding <= 0.005
                    }
                    value="rent_and_deposit"
                  >
                    Rent + Deposit
                    {rentOutstanding <= 0.005
                      || depositOutstanding <= 0.005
                      ? " - both balances required"
                      : ""}
                  </option>
                  <option value="other">Other / Extra Charge</option>
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  {paymentPurpose === "other"
                    ? "Enter the separate charge amount. Super Admin will confirm its exact category and description."
                    : "Choose how the verified payment should reduce the tenant's balance."}
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Amount submitted RM</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  value={amount}
                  min="0.01"
                  name="amount"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                />
                <span
                  aria-live="polite"
                  className={`mt-2 block text-xs font-medium ${
                    remainingAmount > 0.005
                      ? "text-amber-700"
                      : "text-emerald-700"
                  }`}
                >
                  {allocation.extra > 0.005
                    ? `Extra amount for Admin to classify: ${moneyFormatter.format(allocation.extra)}`
                    : `Remaining for this selection: ${moneyFormatter.format(remainingAmount)}`}
                </span>
                <span className="mt-1 block text-xs text-gray-600">
                  Rent allocation: {moneyFormatter.format(allocation.rent)} · Deposit allocation: {moneyFormatter.format(allocation.deposit)}
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Payment date</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  defaultValue={paymentDateDefault}
                  name="paymentDate"
                  required
                  type="date"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Payment method</span>
                <select
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  defaultValue="bank_transfer"
                  name="paymentMethod"
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="duitnow">DuitNow</option>
                  <option value="online_payment">Online payment</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Reference number (optional)</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  name="referenceNumber"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-gray-700">Payment slip</span>
                <input
                  accept="image/*,.pdf"
                  capture="environment"
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  name="receipt"
                  required
                  type="file"
                />
                <span className="mt-1 block text-xs text-gray-500">Image or PDF, maximum 10 MB.</span>
              </label>
              <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
                <Button onClick={() => setOpen(false)} type="button" variant="outline">
                  Cancel
                </Button>
                <UploadSubmitButton />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function UploadSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit">
      {pending ? "Uploading..." : "Submit for Verification"}
    </Button>
  );
}
