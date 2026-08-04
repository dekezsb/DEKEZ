"use client";

import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Gauge,
  ShieldCheck,
  Zap,
} from "lucide-react";
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
  meterNumber?: string | null;
  remainingCredit?: number | null;
  adminPreview?: boolean;
};

export function ElectricityTopUpPilot({
  propertyName,
  roomName,
  meterNumber,
  remainingCredit,
  adminPreview = false,
}: ElectricityTopUpPilotProps) {
  const [selectedAmount, setSelectedAmount] = useState(50);
  const [customAmount, setCustomAmount] = useState("");
  const [step, setStep] = useState<"choose" | "review" | "complete">("choose");

  const parsedCustomAmount = Number(customAmount);
  const amount =
    customAmount && Number.isFinite(parsedCustomAmount)
      ? parsedCustomAmount
      : selectedAmount;
  const validAmount = amount >= 10 && amount <= 500 && amount % 1 === 0;

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
                  BDS PILOT
                </span>
              </div>
              <CardDescription className="mt-1">
                {propertyName} / {roomName}
              </CardDescription>
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-white px-4 py-3 sm:text-right">
            <p className="text-xs font-medium text-gray-500">Available credit</p>
            <p className="mt-1 text-xl font-bold text-gray-950">
              {remainingCredit === null || remainingCredit === undefined
                ? "Not connected"
                : money.format(remainingCredit)}
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

        {step === "choose" ? (
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

        {step === "review" ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                2. Check before payment
              </p>
              <dl className="mt-3 divide-y rounded-lg border border-gray-200 bg-white px-4">
                <ReviewRow label="Property" value={propertyName} />
                <ReviewRow label="Room" value={roomName} />
                <ReviewRow label="Meter" value={meterNumber || "Not assigned yet"} />
                <ReviewRow label="Top-up amount" value={money.format(amount)} strong />
              </dl>
            </div>

            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <p className="font-semibold">How the live version will work</p>
              <p className="mt-1 leading-6">
                Pay securely, wait for successful confirmation, then the meter
                provider adds the credit and returns a transaction reference.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <Button onClick={() => setStep("choose")} type="button" variant="outline">
                <ArrowLeft className="h-4 w-4" />
                Change amount
              </Button>
              <Button
                className="h-12 bg-amber-500 text-base font-bold text-amber-950 hover:bg-amber-400"
                onClick={() => setStep("complete")}
                type="button"
              >
                <CreditCard className="h-5 w-5" />
                Preview secure payment
              </Button>
            </div>
          </div>
        ) : null}

        {step === "complete" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-700" />
            <p className="mt-3 text-lg font-bold text-emerald-950">
              BDS top-up journey is ready for review
            </p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-emerald-900">
              This pilot has not charged a card or changed a meter balance. Add
              the real BDS meter numbers, payment gateway and meter-provider API
              before activating the final payment button.
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
            Admin preview: only BDS tenants will receive this card during the pilot.
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
