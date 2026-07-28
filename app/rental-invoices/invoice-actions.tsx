"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeRentalInvoice } from "./actions";

type InvoiceActionsProps = {
  invoiceId: string;
  invoiceNumber: string;
  tenantName: string;
};

export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  tenantName,
}: InvoiceActionsProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        className="text-red-700 hover:bg-red-50"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Trash2 className="h-4 w-4" />
        Remove Invoice
      </Button>

      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-lg border border-[#d7dde5] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">
                  Remove rental invoice?
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {invoiceNumber} / {tenantName}
                </p>
              </div>
              <button
                aria-label="Close confirmation"
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Only a clean, unpaid draft is permanently deleted. Paid,
              verified, issued, or linked invoices are marked Cancelled and
              retained with their full audit history.
            </div>

            <form action={removeRentalInvoice} className="mt-5 space-y-4">
              <input name="invoiceId" type="hidden" value={invoiceId} />
              <label className="block text-sm font-medium text-gray-700">
                Removal or void reason
                <textarea
                  className="mt-1.5 min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  name="reason"
                  placeholder="Explain why this invoice is being removed"
                  required
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setOpen(false)}
                  type="button"
                  variant="outline"
                >
                  Keep Invoice
                </Button>
                <Button
                  className="bg-red-600 text-white hover:bg-red-700"
                  type="submit"
                >
                  Confirm Remove Invoice
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
