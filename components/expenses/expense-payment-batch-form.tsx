"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { CreditCard, FileCheck2 } from "lucide-react";
import { recordExpensePaymentBatch } from "@/app/expenses/actions";
import { Button } from "@/components/ui/button";

export type PayableExpense = {
  id: string;
  amount: number;
  expenseDate: string;
  supplier: string | null;
  description: string | null;
  categoryName: string;
  propertyName: string;
  roomName: string | null;
};

const maxProofSize = 3 * 1024 * 1024;
const money = new Intl.NumberFormat("en-MY", {
  currency: "MYR",
  style: "currency",
});

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
    const baseName = file.name.replace(/\.[^.]+$/, "") || "payment-proof";
    return new File([blob], `${baseName}.jpg`, {
      lastModified: file.lastModified,
      type: "image/jpeg",
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function SubmitPaymentBatch({
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
      className="w-full sm:w-auto"
      disabled={disabled}
      type="submit"
    >
      {preparing
        ? "Preparing proof..."
        : pending
          ? "Recording payment..."
          : `Knock off ${count} bill${count === 1 ? "" : "s"} — ${money.format(total)}`}
    </Button>
  );
}

export function ExpensePaymentBatchForm({
  expenses,
  paidOn,
}: {
  expenses: PayableExpense[];
  paidOn: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [proofName, setProofName] = useState("");
  const [fileError, setFileError] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const total = expenses.reduce(
    (sum, expense) =>
      sum + (selected.has(expense.id) ? expense.amount : 0),
    0,
  );

  if (!expenses.length) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
        No verified company expense bills are waiting for payment.
      </div>
    );
  }

  return (
    <form action={recordExpensePaymentBatch} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-950">
            Choose every bill covered by the same payment proof
          </p>
          <p className="mt-1 text-sm text-gray-600">
            One bank slip or company-card statement will be linked to all
            selected bills.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setSelectedIds(expenses.map((expense) => expense.id))}
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

      <div className="max-h-[28rem] divide-y divide-[#e3e8ef] overflow-y-auto rounded-lg border border-[#d7dde5]">
        {expenses.map((expense) => {
          const checked = selected.has(expense.id);
          return (
            <label
              className={`grid cursor-pointer gap-3 p-4 transition sm:grid-cols-[auto_1fr_auto] sm:items-center ${
                checked ? "bg-amber-50" : "bg-white hover:bg-gray-50"
              }`}
              key={expense.id}
            >
              <input
                checked={checked}
                className="h-5 w-5"
                name="expenseIds"
                onChange={(event) =>
                  setSelectedIds((current) =>
                    event.target.checked
                      ? [...current, expense.id]
                      : current.filter((id) => id !== expense.id),
                  )
                }
                type="checkbox"
                value={expense.id}
              />
              <span>
                <span className="block font-medium text-gray-950">
                  {expense.supplier || expense.description || expense.categoryName}
                </span>
                <span className="mt-1 block text-sm text-gray-600">
                  {expense.expenseDate} · {expense.categoryName} ·{" "}
                  {expense.propertyName}
                  {expense.roomName ? ` / ${expense.roomName}` : ""}
                </span>
              </span>
              <span className="font-semibold text-gray-950">
                {money.format(expense.amount)}
              </span>
            </label>
          );
        })}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-amber-900">
            Selected {selectedIds.length} bill
            {selectedIds.length === 1 ? "" : "s"}
          </span>
          <span className="text-xl font-bold text-amber-950">
            {money.format(total)}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Payment date *
          </span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
            defaultValue={paidOn}
            name="paidOn"
            required
            type="date"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Paid using *
          </span>
          <select
            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
            defaultValue="company_bank"
            name="paymentMethod"
            required
          >
            <option value="company_bank">Company bank</option>
            <option value="company_card">Company card</option>
            <option value="company_cash">Company cash</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Payment reference *
          </span>
          <input
            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
            name="referenceNumber"
            placeholder="Bank reference or card statement"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Bank slip / card statement *
          </span>
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="mt-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
            name="paymentProof"
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              setPreparing(true);
              setFileError("");
              try {
                const prepared = await prepareProof(file);
                const transfer = new DataTransfer();
                transfer.items.add(prepared);
                input.files = transfer.files;
                setProofName(
                  `${prepared.name} · ${(prepared.size / 1024 / 1024).toFixed(2)} MB`,
                );
              } catch (error) {
                input.value = "";
                setProofName("");
                setFileError(
                  error instanceof Error && error.message === "pdf_size"
                    ? "PDF statements must be 3 MB or smaller."
                    : "This proof could not be prepared. Choose another image or PDF.",
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
              <FileCheck2 className="h-3.5 w-3.5" />
              {proofName}
            </span>
          ) : null}
          {fileError ? (
            <span className="mt-1 block text-xs font-medium text-red-600">
              {fileError}
            </span>
          ) : null}
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Payment notes</span>
        <textarea
          className="mt-2 min-h-20 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2"
          name="notes"
          placeholder="Optional note about this combined payment"
        />
      </label>

      <div className="flex flex-col gap-3 border-t border-[#e3e8ef] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-gray-600">
          <CreditCard className="h-4 w-4 text-[#b98a2c]" />
          The proof and every bill link are retained together for seven years.
        </p>
        <SubmitPaymentBatch
          count={selectedIds.length}
          preparing={preparing}
          total={total}
        />
      </div>
    </form>
  );
}
