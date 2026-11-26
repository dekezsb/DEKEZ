"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Paperclip, Zap } from "lucide-react";
import { Link } from "@/components/app-link";
import { Button } from "@/components/ui/button";
import {
  OTHER_PAYMENT_METHODS,
  OTHER_PAYMENT_TYPES,
  malaysiaToday,
  type OtherPaymentType,
} from "@/lib/payments/other-payment";
import { prepareSlipForUpload } from "@/lib/payments/slip-upload";
import type { OtherPaymentResult } from "@/app/other-payments/actions";

export type OtherPaymentTenancyOption = {
  id: string;
  label: string;
  /** True when the room already has the smart-meter top-up box. */
  hasMeterTopUp?: boolean;
};

type Props = {
  mode: "tenant" | "staff";
  tenancies: OtherPaymentTenancyOption[];
  action: (formData: FormData) => Promise<OtherPaymentResult>;
};

const fieldClass =
  "mt-2 h-12 w-full rounded-md border border-[#cfd8e5] bg-white px-3 text-base";

/**
 * The one "Other payment" form, used by tenants (their own rooms) and by staff
 * (any tenant they can access). The slip is required; phone photos are converted
 * to JPG in the browser before upload.
 */
export function OtherPaymentForm({ mode, tenancies, action }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState("");
  const [type, setType] = useState<OtherPaymentType>("key_replacement");
  const [tenancyId, setTenancyId] = useState(
    tenancies.length === 1 ? tenancies[0].id : "",
  );
  const [search, setSearch] = useState("");
  const [today, setToday] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OtherPaymentResult | null>(null);
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    setKey(crypto.randomUUID());
    setToday(malaysiaToday());
  }, []);

  const selectedType = OTHER_PAYMENT_TYPES.find((item) => item.value === type)!;
  const selectedTenancy = tenancies.find((item) => item.id === tenancyId);
  const useMeterBox =
    mode === "tenant" && type === "top_up" && Boolean(selectedTenancy?.hasMeterTopUp);
  const visibleTenancies = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? tenancies.filter((item) => item.label.toLowerCase().includes(needle))
      : tenancies;
  }, [search, tenancies]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || useMeterBox) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const picked = formData.get("receipt");
    if (!(picked instanceof File) || picked.size === 0) {
      setResult({ ok: false, message: "Attach the payment slip first." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      formData.set("receipt", await prepareSlipForUpload(picked));
      formData.set("submissionKey", key);
      const outcome = await action(formData);
      setResult(outcome);
      if (outcome.ok) {
        form.reset();
        setFileName("");
        setType("key_replacement");
        setTenancyId(tenancies.length === 1 ? tenancies[0].id : "");
        setKey(crypto.randomUUID());
        router.refresh();
      }
    } catch (error) {
      setResult({
        ok: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : "Something went wrong. Your entries are kept — please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit} ref={formRef}>
      {result?.ok ? (
        <div
          className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          {result.message}
        </div>
      ) : null}
      {result && !result.ok ? (
        <p
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          role="alert"
        >
          {result.message}
        </p>
      ) : null}

      {mode === "staff" || tenancies.length > 1 ? (
        <label className="block">
          <span className="text-sm font-semibold text-gray-800">
            {mode === "staff" ? "Tenant and room" : "Which room is this for?"}
          </span>
          {mode === "staff" ? (
            <input
              aria-label="Search tenant or room"
              className="mt-2 h-10 w-full rounded-md border border-[#cfd8e5] bg-white px-3 text-sm"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Type a name or room to search"
              type="search"
              value={search}
            />
          ) : null}
          <select
            className={fieldClass}
            name="tenancyId"
            onChange={(event) => setTenancyId(event.target.value)}
            required
            value={tenancyId}
          >
            <option value="">Choose…</option>
            {visibleTenancies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input name="tenancyId" type="hidden" value={tenancyId} />
      )}

      <label className="block">
        <span className="text-sm font-semibold text-gray-800">
          What is this payment for? <span className="font-normal text-gray-500">(Bayaran untuk apa?)</span>
        </span>
        <select
          className={fieldClass}
          name="paymentType"
          onChange={(event) => setType(event.target.value as OtherPaymentType)}
          value={type}
        >
          {OTHER_PAYMENT_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label} — {item.shortLabel}
            </option>
          ))}
        </select>
        <span className="mt-2 block text-sm text-gray-600">{selectedType.hint}</span>
      </label>

      {useMeterBox ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Zap className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Your room has a smart electricity meter.</p>
            <p className="mt-1">
              Please top up with the Electricity Top-Up box on your Home page. It
              credits the meter after verification.
            </p>
            <Button asChild className="mt-3" size="sm" variant="outline">
              <Link href="/dashboard#electricity-top-up">Open Electricity Top-Up</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {type === "other" ? (
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">
                What is it for? <span className="text-red-600">*</span>
              </span>
              <input
                className={fieldClass}
                maxLength={200}
                name="description"
                placeholder="For example: extra cleaning, parking sticker"
                required
                type="text"
              />
            </label>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">Amount paid (RM)</span>
              <input
                className={fieldClass}
                inputMode="decimal"
                max="50000"
                min="0.01"
                name="amount"
                placeholder="0.00"
                required
                step="0.01"
                type="number"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">Payment date</span>
              <input
                className={fieldClass}
                defaultValue={today}
                key={today}
                max={today || undefined}
                name="paymentDate"
                required
                type="date"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">Payment method</span>
              <select className={fieldClass} defaultValue="bank_transfer" name="paymentMethod">
                {OTHER_PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-gray-800">Reference no. (on the slip)</span>
              <input
                autoComplete="off"
                className={fieldClass}
                maxLength={120}
                name="referenceNumber"
                placeholder="Transaction / reference number"
                type="text"
              />
            </label>
          </div>
          <p className="-mt-2 text-sm text-amber-700">
            Cash payments are not accepted. A payment slip is required.
          </p>

          <label className="block">
            <span className="text-sm font-semibold text-gray-800">
              Payment slip <span className="text-red-600">*</span>
            </span>
            <span className="mt-2 flex min-h-14 items-center gap-3 rounded-md border border-dashed border-[#b8892c] bg-[#fbf6e9] px-4 text-sm font-semibold text-[#8a641d]">
              <Paperclip className="h-4 w-4 shrink-0" />
              <input
                accept="image/*,.heic,.heif,.pdf"
                className="min-w-0 flex-1 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#b8892c] file:px-3 file:py-2 file:font-semibold file:text-white"
                name="receipt"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
                required
                type="file"
              />
            </span>
            <span className="mt-2 block text-xs text-gray-500">
              Photo or PDF. iPhone (HEIC) photos are converted automatically.
              {fileName ? ` Selected: ${fileName}` : ""}
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-gray-800">
              Note <span className="font-normal text-gray-500">(optional)</span>
            </span>
            <textarea
              className="mt-2 min-h-20 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-base"
              maxLength={500}
              name="note"
            />
          </label>

          <Button className="h-12 w-full sm:w-auto" disabled={busy} type="submit">
            {busy
              ? "Submitting..."
              : mode === "staff"
                ? "Submit for tenant"
                : "Submit other payment"}
          </Button>
        </>
      )}
    </form>
  );
}
