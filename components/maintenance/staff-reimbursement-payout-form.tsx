"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ExternalLink, ReceiptText } from "lucide-react";
import { recordStaffReimbursementPayout } from "@/app/verification/actions";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/e-tenancy";

const maxProofSize = 3 * 1024 * 1024;

export type StaffPayableBill = {
  amount: number;
  categoryName: string;
  description: string | null;
  expenseDate: string;
  liabilityId: string;
  propertyName: string;
  receipts: {
    fileName: string;
    url: string;
  }[];
  roomName: string | null;
  supplier: string | null;
};

async function prepareProof(file: File) {
  if (file.size <= maxProofSize) return file;
  if (!file.type.startsWith("image/")) {
    throw new Error("pdf_size");
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("image_decode"));
      nextImage.src = imageUrl;
    });
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 2200 / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image_canvas");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    let quality = 0.86;
    let blob: Blob | null = null;
    do {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      quality -= 0.08;
    } while (blob && blob.size > maxProofSize && quality >= 0.46);

    if (!blob || blob.size > maxProofSize) throw new Error("image_size");
    const baseName = file.name.replace(/\.[^.]+$/, "") || "payout-proof";
    return new File([blob], `${baseName}.jpg`, {
      lastModified: file.lastModified,
      type: "image/jpeg",
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function PayoutButton({
  count,
  preparing,
  total,
}: {
  count: number;
  preparing: boolean;
  total: number;
}) {
  const { pending } = useFormStatus();
  const disabled = pending || preparing || count === 0;

  return (
    <Button
      aria-disabled={disabled}
      className="w-full"
      disabled={disabled}
      type="submit"
    >
      {preparing
        ? "Preparing proof..."
        : pending
          ? "Recording payout..."
          : `Pay & knock off ${count} bill${count === 1 ? "" : "s"} - ${money(total)}`}
    </Button>
  );
}

export function StaffReimbursementPayoutForm({
  bankAccountHolder,
  bankAccountNumber,
  bankName,
  liabilityIds,
  items,
  paidOn,
  returnTo = "verification",
  staffId,
  staffName,
  total,
}: {
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  liabilityIds: string[];
  items?: StaffPayableBill[];
  paidOn: string;
  returnTo?: "expenses" | "verification";
  staffId: string;
  staffName: string;
  total: number;
}) {
  const hasSelectableItems = Boolean(items?.length);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    hasSelectableItems ? [] : liabilityIds,
  );
  const [preparing, setPreparing] = useState(false);
  const [proofName, setProofName] = useState("");
  const [error, setError] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTotal = hasSelectableItems
    ? (items ?? []).reduce(
        (sum, item) =>
          sum + (selected.has(item.liabilityId) ? item.amount : 0),
        0,
      )
    : total;

  return (
    <form
      action={recordStaffReimbursementPayout}
      className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <input name="staffId" type="hidden" value={staffId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      {!hasSelectableItems
        ? liabilityIds.map((id) => (
            <input key={id} name="liabilityIds" type="hidden" value={id} />
          ))
        : null}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-950">{staffName}</p>
          <p className="text-sm text-gray-600">
            Pay to: {staffName} - {liabilityIds.length} verified bill
            {liabilityIds.length === 1 ? "" : "s"} available
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase text-amber-700">
            Company owing this staff
          </p>
          <p className="text-xl font-bold text-red-700">{money(total)}</p>
        </div>
      </div>

      <div className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
        <p className="font-medium">Staff repayment account</p>
        <p className="mt-1 text-gray-600">
          {bankName || "Bank not provided"} -{" "}
          {bankAccountHolder || "Account holder not provided"} -{" "}
          {bankAccountNumber || "Account number not provided"}
        </p>
      </div>

      {hasSelectableItems ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-950">
              Tick the bills covered by this bank slip
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  setSelectedIds(
                    (items ?? [])
                      .filter((item) => item.receipts.length)
                      .map((item) => item.liabilityId),
                  )
                }
                size="sm"
                type="button"
                variant="outline"
              >
                Select all
              </Button>
              <Button
                disabled={!selectedIds.length}
                onClick={() => setSelectedIds([])}
                size="sm"
                type="button"
                variant="outline"
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="max-h-80 divide-y divide-amber-100 overflow-y-auto rounded-md border border-amber-200 bg-white">
            {(items ?? []).map((item) => {
              const checked = selected.has(item.liabilityId);
              return (
                <div
                  className={`grid gap-3 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center ${
                    checked ? "bg-amber-50" : ""
                  }`}
                  key={item.liabilityId}
                >
                  <input
                    aria-label={`Select ${item.description || item.categoryName}`}
                    checked={checked}
                    className="h-5 w-5"
                    disabled={!item.receipts.length}
                    name="liabilityIds"
                    onChange={(event) =>
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, item.liabilityId]
                          : current.filter((id) => id !== item.liabilityId),
                      )
                    }
                    type="checkbox"
                    value={item.liabilityId}
                  />
                  <div>
                    <p className="font-medium text-gray-950">
                      {item.supplier ||
                        item.description ||
                        item.categoryName}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {item.expenseDate} - {item.categoryName} -{" "}
                      {item.propertyName}
                      {item.roomName ? ` / ${item.roomName}` : ""}
                    </p>
                    {item.receipts.length ? (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {item.receipts.map((receipt) => (
                          <a
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#9d7424] underline"
                            href={receipt.url}
                            key={`${item.liabilityId}-${receipt.url}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {receipt.fileName}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-red-700">
                        No receipt attachment found
                      </p>
                    )}
                  </div>
                  <p className="font-semibold text-gray-950">
                    {money(item.amount)}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2">
            <span className="text-sm font-medium text-amber-900">
              Selected {selectedIds.length} bill
              {selectedIds.length === 1 ? "" : "s"}
            </span>
            <span className="text-lg font-bold text-amber-950">
              {money(selectedTotal)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Payout date *
          </span>
          <input
            className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
            defaultValue={paidOn}
            name="paidOn"
            required
            type="date"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Paid from *
          </span>
          <select
            className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
            defaultValue="company_bank"
            name="paymentSource"
            required
          >
            <option value="company_bank">Company bank</option>
            <option value="company_cash">Company cash</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">
          Payment reference
        </span>
        <input
          className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
          name="referenceNumber"
          placeholder="Bank reference or cash voucher number"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">
          Bank slip / payout proof *
        </span>
        <input
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="mt-1 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
          name="payoutProof"
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            setPreparing(true);
            setError("");
            try {
              const prepared = await prepareProof(file);
              const transfer = new DataTransfer();
              transfer.items.add(prepared);
              input.files = transfer.files;
              setProofName(
                `${prepared.name} - ${(prepared.size / 1024 / 1024).toFixed(2)} MB`,
              );
            } catch (nextError) {
              input.value = "";
              setProofName("");
              setError(
                nextError instanceof Error &&
                  nextError.message === "pdf_size"
                  ? "PDF payout proof must be 3 MB or smaller."
                  : "The payout proof could not be prepared. Choose another image.",
              );
            } finally {
              setPreparing(false);
            }
          }}
          required
          type="file"
        />
        {proofName ? (
          <span className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
            <ReceiptText className="h-3.5 w-3.5" />
            {proofName}
          </span>
        ) : null}
        {error ? (
          <span className="mt-1 block text-xs font-medium text-red-600">
            {error}
          </span>
        ) : null}
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Notes</span>
        <textarea
          className="mt-1 min-h-20 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
          name="notes"
          placeholder="Optional payout note"
        />
      </label>

      <PayoutButton
        count={selectedIds.length}
        preparing={preparing}
        total={selectedTotal}
      />
      <p className="text-xs text-amber-800">
        This payout records who was paid, marks only the ticked bills as paid
        back, and keeps the same proof with the permanent audit record.
      </p>
    </form>
  );
}
