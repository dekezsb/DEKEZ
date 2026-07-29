"use client";

import { ExternalLink, Paperclip, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/ui/document-preview";
import type { RentalInvoiceReceipt } from "@/lib/data/rental-invoices";

type InvoiceReceiptPreviewProps = {
  receipts: RentalInvoiceReceipt[];
};

export function InvoiceReceiptPreview({
  receipts,
}: InvoiceReceiptPreviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const availableReceipts = receipts.filter((receipt) => receipt.signedUrl);

  useEffect(() => {
    if (isOpen && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [isOpen]);

  if (!availableReceipts.length) {
    return <span className="text-gray-400">-</span>;
  }

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Paperclip aria-hidden="true" className="h-4 w-4" />
        Preview
        {availableReceipts.length > 1
          ? ` (${availableReceipts.length})`
          : ""}
      </Button>

      <dialog
        aria-labelledby={titleId}
        className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-md border border-[#d7dde5] bg-white p-0 text-gray-950 shadow-2xl backdrop:bg-black/50"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            dialogRef.current?.close();
          }
        }}
        onClose={() => setIsOpen(false)}
        ref={dialogRef}
      >
        {isOpen ? <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                className="text-lg font-semibold"
                id={titleId}
              >
                Verified Payment Slip
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Preview the uploaded receipt, or open it for printing.
              </p>
            </div>
            <button
              aria-label="Close receipt preview"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-950"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {availableReceipts.map((receipt, index) => (
              <section
                className="rounded-md border border-[#d7dde5] p-4"
                key={receipt.id}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    Slip {index + 1}
                  </p>
                  <p className="text-xs text-gray-500">
                    RM {receipt.amount.toFixed(2)}
                  </p>
                </div>
                <DocumentPreview
                  contentType={receipt.contentType}
                  fileName={receipt.fileName}
                  label={`Payment slip ${index + 1}`}
                  showName
                  size="md"
                  url={receipt.signedUrl!}
                />
                <Button asChild className="mt-3 w-full" size="sm" variant="outline">
                  <a
                    href={receipt.signedUrl!}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Open / Print
                  </a>
                </Button>
              </section>
            ))}
          </div>
        </div> : null}
      </dialog>
    </>
  );
}
