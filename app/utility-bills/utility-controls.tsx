"use client";

import { useState } from "react";
import { Check, FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  cancelUtilityBill,
  markUtilityBillPaid,
  uploadUtilityReceipt,
} from "./actions";

type BillActionProps = {
  billId: string;
  propertyId: string;
  propertyName: string;
  utilityLabel: string;
  billMonth: string;
  amount: string;
  isPaid: boolean;
  isCancelled: boolean;
};

function todayMalaysia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function UtilityBillActions({
  billId,
  propertyId,
  propertyName,
  utilityLabel,
  billMonth,
  amount,
  isPaid,
  isCancelled,
}: BillActionProps) {
  const [dialog, setDialog] = useState<"paid" | "cancel" | "receipt" | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!isPaid && !isCancelled ? (
          <Button onClick={() => setDialog("paid")} size="sm" type="button">
            <Check className="h-4 w-4" />
            Mark Paid
          </Button>
        ) : null}
        {!isCancelled ? (
          <Button onClick={() => setDialog("receipt")} size="sm" type="button" variant="outline">
            <FileUp className="h-4 w-4" />
            Upload Receipt
          </Button>
        ) : null}
        {!isCancelled ? (
          <Button onClick={() => setDialog("cancel")} size="sm" type="button" variant="outline">
            <X className="h-4 w-4" />
            Cancel
          </Button>
        ) : null}
      </div>

      {dialog ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-lg border border-[#d7dde5] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">
                  {dialog === "paid"
                    ? "Confirm utility payment"
                    : dialog === "cancel"
                      ? "Cancel utility bill"
                      : "Upload payment receipt"}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {propertyName} · {utilityLabel} · {billMonth}
                </p>
              </div>
              <button
                aria-label="Close dialog"
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
                onClick={() => setDialog(null)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {dialog === "paid" ? (
              <form action={markUtilityBillPaid} className="mt-5 space-y-4">
                <input name="billId" type="hidden" value={billId} />
                <input name="propertyId" type="hidden" value={propertyId} />
                <div className="rounded-md bg-[#f4f7fa] p-4 text-sm text-gray-700">
                  Confirm that <strong>{amount}</strong> has been paid for this property bill.
                </div>
                <label className="block text-sm font-medium text-gray-700">
                  Payment date
                  <input
                    className="mt-1.5 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                    defaultValue={todayMalaysia()}
                    name="paymentDate"
                    required
                    type="date"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Reference number, optional
                  <input
                    className="mt-1.5 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                    name="referenceNumber"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Receipt, optional
                  <input
                    accept="image/*,application/pdf"
                    className="mt-1.5 block w-full text-sm"
                    name="receiptFile"
                    type="file"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setDialog(null)} type="button" variant="outline">Back</Button>
                  <Button type="submit">Confirm & Mark Paid</Button>
                </div>
              </form>
            ) : null}

            {dialog === "receipt" ? (
              <form action={uploadUtilityReceipt} className="mt-5 space-y-4">
                <input name="billId" type="hidden" value={billId} />
                <input name="propertyId" type="hidden" value={propertyId} />
                <label className="block text-sm font-medium text-gray-700">
                  Receipt image or PDF
                  <input
                    accept="image/*,application/pdf"
                    className="mt-1.5 block w-full text-sm"
                    name="receiptFile"
                    required
                    type="file"
                  />
                </label>
                <p className="text-xs text-gray-500">Maximum file size: 10 MB.</p>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setDialog(null)} type="button" variant="outline">Back</Button>
                  <Button type="submit">Upload Receipt</Button>
                </div>
              </form>
            ) : null}

            {dialog === "cancel" ? (
              <form action={cancelUtilityBill} className="mt-5 space-y-4">
                <input name="billId" type="hidden" value={billId} />
                <input name="propertyId" type="hidden" value={propertyId} />
                <p className="text-sm text-gray-600">
                  The record and its payment history will be kept. It will be marked Cancelled.
                </p>
                <label className="block text-sm font-medium text-gray-700">
                  Cancellation reason
                  <textarea
                    className="mt-1.5 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2"
                    name="reason"
                    required
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setDialog(null)} type="button" variant="outline">Back</Button>
                  <Button className="bg-red-600 hover:bg-red-700" type="submit">Confirm Cancellation</Button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
