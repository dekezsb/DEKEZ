import { Pencil, Save } from "lucide-react";
import { updatePaymentPurpose } from "@/app/tenants/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PAYMENT_CATEGORY_OPTIONS,
  paymentCategoryLabel,
} from "@/lib/payments/payment-category";
import { formatMalaysiaDate } from "@/lib/date-format";
import { statusBadgeClass } from "@/lib/status-styles";

type PaymentHistoryItem = {
  amount: number | string | null;
  category: string | null;
  id: string;
  notes: string | null;
  payment_date: string | null;
  payment_method: string | null;
  reference_number: string | null;
  status: string;
};

type PaymentHistoryProps = {
  canEditPurpose: boolean;
  paymentResult?: string;
  payments: PaymentHistoryItem[];
  propertyId: string;
  returnView: "room" | "tenant";
  roomId: string;
  tenantKey: string;
};

const money = new Intl.NumberFormat("en-MY", {
  currency: "MYR",
  style: "currency",
});

const resultMessages: Record<string, { error?: boolean; text: string }> = {
  updated: { text: "Payment purpose updated. The correction is recorded in its history." },
  invalid: { error: true, text: "Choose a valid payment purpose and enter a correction reason." },
  missing: { error: true, text: "The payment record could not be found." },
  locked: { error: true, text: "A cancelled or reversed payment cannot be edited." },
  failed: { error: true, text: "The payment purpose could not be updated." },
};

export function PaymentHistory({
  canEditPurpose,
  paymentResult,
  payments,
  propertyId,
  returnView,
  roomId,
  tenantKey,
}: PaymentHistoryProps) {
  const result = paymentResult ? resultMessages[paymentResult] : null;

  return (
    <div className="space-y-3">
      {result ? (
        <p
          className={`border px-3 py-2 text-sm ${
            result.error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {result.text}
        </p>
      ) : null}

      {payments.length ? payments.map((payment) => (
        <div className="border-b border-[#e5e9ef] pb-3 last:border-0" key={payment.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-gray-950">
                {money.format(Number(payment.amount ?? 0))}
              </p>
              <p className="text-xs text-gray-500">
                {formatMalaysiaDate(payment.payment_date)} / {payment.payment_method ?? "-"}
              </p>
              <p className="text-xs text-gray-500">
                {payment.reference_number ?? "No reference"}
              </p>
              <p className="mt-1 text-sm">
                <span className="text-gray-500">Payment for: </span>
                <span className="font-medium text-gray-950">
                  {paymentCategoryLabel(payment.category)}
                </span>
              </p>
              {payment.notes ? (
                <p className="mt-1 whitespace-pre-line text-xs text-gray-500">
                  {payment.notes}
                </p>
              ) : null}
            </div>
            <Badge className={statusBadgeClass(payment.status)}>{payment.status}</Badge>
          </div>

          {canEditPurpose && !["cancelled"].includes(payment.status) ? (
            <details className="mt-3 border border-[#d6dde6] bg-gray-50 p-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-gray-800">
                <Pencil className="h-4 w-4" />
                Correct payment purpose
              </summary>
              <form action={updatePaymentPurpose} className="mt-3 grid gap-3">
                <input name="paymentId" type="hidden" value={payment.id} />
                <input name="propertyId" type="hidden" value={propertyId} />
                <input name="returnView" type="hidden" value={returnView} />
                <input name="roomId" type="hidden" value={roomId} />
                <input name="tenantKey" type="hidden" value={tenantKey} />
                <label className="grid gap-1 text-sm">
                  <span>Payment purpose</span>
                  <select
                    className="h-10 border border-[#cfd8e3] bg-white px-3"
                    defaultValue={payment.category ?? "monthly_rent"}
                    name="category"
                  >
                    {PAYMENT_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Correction reason / details</span>
                  <input
                    className="h-10 border border-[#cfd8e3] bg-white px-3"
                    maxLength={300}
                    name="correctionReason"
                    placeholder="Example: Extra payment was for a key lock"
                    required
                  />
                </label>
                <p className="text-xs text-gray-500">
                  The amount, receipt and verification status will not change.
                </p>
                <Button className="w-fit" size="sm" type="submit">
                  <Save className="h-4 w-4" />
                  Save correction
                </Button>
              </form>
            </details>
          ) : null}
        </div>
      )) : (
        <p className="text-sm text-gray-500">No payment records found.</p>
      )}
    </div>
  );
}
