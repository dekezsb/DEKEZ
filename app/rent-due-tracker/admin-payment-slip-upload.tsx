"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  outstandingAmount: number;
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
  outstandingAmount,
  outstandingLabel,
  paymentDateDefault,
  selectedMonth,
  selectedProperty,
}: AdminPaymentSlipUploadProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(outstandingAmount.toFixed(2));
  const numericAmount = Number(amount);
  const submittedAmount =
    Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0;
  const remainingAmount = Math.max(
    outstandingAmount - submittedAmount,
    0,
  );

  return (
    <>
      <Button
        className="whitespace-nowrap border-[#d9bf84] text-[#8a641d] hover:bg-[#fff8e8]"
        onClick={() => {
          setAmount(outstandingAmount.toFixed(2));
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
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Amount submitted RM</span>
                <input
                  className="mt-2 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                  value={amount}
                  max={outstandingAmount}
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
                  Remaining after verification:{" "}
                  {moneyFormatter.format(remainingAmount)}
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
