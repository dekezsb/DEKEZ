"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  bankReferenceRequired,
  usableBankReference,
} from "@/lib/payments/verification-row";
import { reviewOtherPaymentInline } from "./other-payment-actions";

export type OtherPaymentReviewProps = {
  submissionId: string;
  status: string;
  tenantName: string;
  propertyName: string;
  roomName: string;
  amountSubmitted: string;
  typeLabel: string;
  paymentMethod: string;
  referenceNumber: string;
  rejectionReason?: string | null;
  errorMessages: Record<string, string>;
  onReferenceMissing?: () => void;
};

/**
 * Verify / Reject for an "other payment" slip. Verifying posts one payment of
 * that type. It never changes a rent invoice (see other-payment-actions.ts).
 */
export function OtherPaymentReview({
  submissionId,
  status,
  tenantName,
  propertyName,
  roomName,
  amountSubmitted,
  typeLabel,
  paymentMethod,
  referenceNumber,
  rejectionReason,
  errorMessages,
  onReferenceMissing,
}: OtherPaymentReviewProps) {
  const [mode, setMode] = useState<"" | "verify" | "reject">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(form: FormData) {
    setBusy(true);
    setError("");
    try {
      const result = await reviewOtherPaymentInline(form);
      if (result.error) {
        setError(
          errorMessages[result.error] ??
            "Could not update this payment. Refresh and check it before trying again.",
        );
      } else {
        setMode("");
        router.refresh();
      }
    } catch {
      setError("Could not confirm the result. Refresh to check this slip before retrying.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-other-payment-review>
      {status === "rejected" ? (
        <p className="text-xs leading-5 text-red-600">
          {rejectionReason ?? "Payment proof rejected."}
        </p>
      ) : null}
      <div className="grid gap-2">
        <Button
          size="sm"
          type="button"
          onClick={() => {
            if (
              bankReferenceRequired(paymentMethod) &&
              !usableBankReference(referenceNumber)
            ) {
              onReferenceMissing?.();
              return;
            }
            setError("");
            setMode("verify");
          }}
        >
          Verify
        </Button>
        {status !== "rejected" ? (
          <Button
            className="border-red-200 text-red-700 hover:bg-red-50"
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              setError("");
              setMode("reject");
            }}
          >
            Reject
          </Button>
        ) : null}
      </div>

      {mode === "verify" ? (
        <div className="mt-3 w-[min(32rem,80vw)] rounded-lg border bg-white p-4">
          <h2 className="text-base font-semibold text-gray-950">
            Confirm this other payment has been received?
          </h2>
          <div className="mt-3 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
            <p>Tenant: <span className="font-medium text-gray-950">{tenantName}</span></p>
            <p>Room: <span className="font-medium text-gray-950">{propertyName} / {roomName}</span></p>
            <p>Type: <span className="font-medium text-gray-950">{typeLabel}</span></p>
            <p>Amount: <span className="font-medium text-gray-950">{amountSubmitted}</span></p>
            <p className="sm:col-span-2">Bank code: <span className="font-medium text-gray-950">{referenceNumber || "-"}</span></p>
          </div>
          <p className="mt-3 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
            This is recorded as a separate payment. It does not pay or change any
            monthly rent invoice.
          </p>
          <form action={submit} className="mt-4 space-y-3">
            <input name="submissionId" type="hidden" value={submissionId} />
            <input name="decision" type="hidden" value="verified" />
            <input name="bankReference" type="hidden" value={referenceNumber} />
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button disabled={busy} type="button" variant="outline" onClick={() => setMode("")}>Cancel</Button>
              <Button disabled={busy} type="submit">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" />Verifying…</> : "Confirm payment received"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "reject" ? (
        <div className="mt-3 w-[min(32rem,80vw)] rounded-lg border bg-white p-4">
          <h2 className="text-base font-semibold text-gray-950">Reject this other payment</h2>
          <form action={submit} className="mt-3 space-y-3">
            <input name="submissionId" type="hidden" value={submissionId} />
            <input name="decision" type="hidden" value="rejected" />
            <label className="block">
              <span className="text-sm font-medium text-gray-800">Reason (the tenant can see this)</span>
              <textarea className="mt-2 min-h-20 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" name="notes" required />
            </label>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button disabled={busy} type="button" variant="outline" onClick={() => setMode("")}>Cancel</Button>
              <Button className="bg-red-600 text-white hover:bg-red-700" disabled={busy} type="submit">
                {busy ? "Rejecting…" : "Reject payment"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
