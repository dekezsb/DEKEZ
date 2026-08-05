"use client";

import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Gauge,
  Paperclip,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { submitSmartMeterTopUp } from "@/app/smart-meter-top-up/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const presetAmounts = [50, 100];

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 2,
});

type ElectricityTopUpPilotProps = {
  propertyName: string;
  roomName: string;
  tenancyId?: string | null;
  meterNumber?: string | null;
  remainingUnits?: number | null;
  unitLabel?: string | null;
  latestRequest?: {
    amount: number;
    status: string;
    rejectionReason?: string | null;
  } | null;
  adminPreview?: boolean;
};

export function ElectricityTopUpPilot({
  propertyName,
  roomName,
  tenancyId,
  meterNumber,
  remainingUnits,
  unitLabel,
  latestRequest,
  adminPreview = false,
}: ElectricityTopUpPilotProps) {
  const [selectedAmount, setSelectedAmount] = useState(50);
  const [customAmount, setCustomAmount] = useState("");
  const [receiptName, setReceiptName] = useState("");
  const [step, setStep] = useState<"choose" | "review" | "complete">("choose");

  const parsedCustomAmount = Number(customAmount);
  const amount =
    customAmount && Number.isFinite(parsedCustomAmount)
      ? parsedCustomAmount
      : selectedAmount;
  const validAmount = amount >= 10 && amount <= 500 && amount % 1 === 0;
  const openRequest = latestRequest && [
    "pending_verification",
    "approved_awaiting_top_up",
  ].includes(latestRequest.status);

  function choosePreset(value: number) {
    setSelectedAmount(value);
    setCustomAmount("");
  }

  return (
    <Card className="overflow-hidden border-amber-300 shadow-sm">
      <CardHeader className="border-b border-amber-200 bg-gradient-to-r from-amber-50 to-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950">
              <Zap className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Top Up Electricity</CardTitle>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                  BANK SLIP REQUIRED
                </span>
              </div>
              <CardDescription className="mt-1">
                {propertyName} / {roomName}
              </CardDescription>
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-white px-4 py-3 sm:text-right">
            <p className="text-xs font-medium text-gray-500">Meter remaining</p>
            <p className="mt-1 text-xl font-bold text-gray-950">
              {remainingUnits === null || remainingUnits === undefined
                ? "Not connected"
                : `${remainingUnits.toFixed(2)} ${unitLabel ?? "kWh"}`}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-3">
            <Gauge className="h-5 w-5 text-amber-700" />
            <div>
              <p className="text-gray-500">Smart meter</p>
              <p className="font-semibold text-gray-950">
                {meterNumber || "Waiting for meter assignment"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-700" />
            <div>
              <p className="text-gray-500">Safety</p>
              <p className="font-semibold text-gray-950">
                Credit only after payment confirmation
              </p>
            </div>
          </div>
        </div>

        {openRequest ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" />
              <div>
                <p className="font-bold text-amber-950">
                  {latestRequest.status === "pending_verification"
                    ? "Payment slip pending verification"
                    : "Payment approved — awaiting meter top-up"}
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  {money.format(latestRequest.amount)} will not be added to the
                  meter until the payment and physical meter credit are both confirmed.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {latestRequest?.status === "rejected" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">Previous payment slip was rejected.</p>
            <p className="mt-1">
              {latestRequest.rejectionReason || "Please attach the correct payment slip and submit again."}
            </p>
          </div>
        ) : null}

        {!openRequest && step === "choose" ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                1. Choose your top-up amount
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {presetAmounts.map((preset) => (
                  <button
                    aria-pressed={!customAmount && selectedAmount === preset}
                    className={`min-h-16 rounded-lg border-2 px-4 text-lg font-bold transition focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                      !customAmount && selectedAmount === preset
                        ? "border-amber-500 bg-amber-50 text-amber-900"
                        : "border-gray-200 bg-white text-gray-900 hover:border-amber-300"
                    }`}
                    key={preset}
                    onClick={() => choosePreset(preset)}
                    type="button"
                  >
                    RM {preset}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-gray-900">
                Or enter another amount
              </span>
              <div className="mt-2 flex h-12 items-center rounded-lg border border-gray-300 bg-white px-3 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20">
                <span className="font-semibold text-gray-500">RM</span>
                <input
                  aria-describedby="top-up-limit"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-base font-semibold outline-none"
                  inputMode="numeric"
                  max="500"
                  min="10"
                  onChange={(event) => setCustomAmount(event.target.value)}
                  placeholder="Example: 30"
                  step="1"
                  type="number"
                  value={customAmount}
                />
              </div>
              <span className="mt-1 block text-xs text-gray-500" id="top-up-limit">
                Pilot range: RM 10 to RM 500 in whole Ringgit.
              </span>
            </label>

            <Button
              className="h-12 w-full bg-amber-500 text-base font-bold text-amber-950 hover:bg-amber-400"
              disabled={!validAmount}
              onClick={() => setStep("review")}
              type="button"
            >
              Continue with {validAmount ? money.format(amount) : "amount"}
            </Button>
          </div>
        ) : null}

        {!openRequest && step === "review" ? (
          <form
            action={adminPreview ? undefined : submitSmartMeterTopUp}
            className="space-y-5"
            onSubmit={(event) => {
              if (!adminPreview) return;
              event.preventDefault();
              setStep("complete");
            }}
          >
            <input name="tenancyId" type="hidden" value={tenancyId ?? ""} />
            <input name="amount" type="hidden" value={String(amount)} />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                2. Check details and attach your payment slip
              </p>
              <dl className="mt-3 divide-y rounded-lg border border-gray-200 bg-white px-4">
                <ReviewRow label="Property" value={propertyName} />
                <ReviewRow label="Room" value={roomName} />
                <ReviewRow label="Meter" value={meterNumber || "Not assigned yet"} />
                <ReviewRow label="Top-up amount" value={money.format(amount)} strong />
              </dl>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-gray-900">
                Bank-transfer payment slip
              </span>
              <span className="mt-2 flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 px-4 text-sm text-amber-900">
                <Paperclip className="h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1 font-semibold">
                  {receiptName || "Choose an image or PDF up to 5 MB"}
                </span>
                <input
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  name="paymentSlip"
                  onChange={(event) =>
                    setReceiptName(event.target.files?.[0]?.name ?? "")
                  }
                  required
                  type="file"
                />
              </span>
            </label>

            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <p className="font-semibold">Protected verification flow</p>
              <p className="mt-1 leading-6">
                Uploading the slip does not top up the meter. DEKEZ must verify
                the payment first, then confirm the physical meter credit with
                a provider reference.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <Button onClick={() => setStep("choose")} type="button" variant="outline">
                <ArrowLeft className="h-4 w-4" />
                Change amount
              </Button>
              <Button
                className="h-12 bg-amber-500 text-base font-bold text-amber-950 hover:bg-amber-400"
                disabled={!receiptName || (!adminPreview && !tenancyId)}
                type="submit"
              >
                <ShieldCheck className="h-5 w-5" />
                Submit for verification
              </Button>
            </div>
          </form>
        ) : null}

        {!openRequest && step === "complete" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-700" />
            <p className="mt-3 text-lg font-bold text-emerald-950">
              Payment slip submitted — Pending Verification
            </p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-emerald-900">
              Preview only: no file was uploaded and no meter balance changed.
              In the tenant portal, Admin must verify the slip before the meter
              can be topped up.
            </p>
            <Button
              className="mt-4"
              onClick={() => setStep("choose")}
              type="button"
              variant="outline"
            >
              Try another amount
            </Button>
          </div>
        ) : null}

        {adminPreview ? (
          <p className="rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-xs font-medium text-violet-800">
            Admin preview: every active tenant receives this card.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReviewRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className={strong ? "text-lg font-bold text-gray-950" : "font-semibold text-gray-950"}>
        {value}
      </dd>
    </div>
  );
}
