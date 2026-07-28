"use client";

import { useState } from "react";

type PaymentBillOption = {
  id: string;
  label: string;
  outstanding: number;
};

type PaymentAmountFieldsProps = {
  bills: PaymentBillOption[];
};

const moneyFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export function PaymentAmountFields({ bills }: PaymentAmountFieldsProps) {
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");
  const selectedBill = bills.find((bill) => bill.id === billId) ?? null;
  const numericAmount = Number(amount);
  const submittedAmount =
    Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0;
  const remaining = selectedBill
    ? Math.max(selectedBill.outstanding - submittedAmount, 0)
    : 0;

  function selectBill(nextBillId: string) {
    const nextBill = bills.find((bill) => bill.id === nextBillId);
    setBillId(nextBillId);
    setAmount(nextBill ? nextBill.outstanding.toFixed(2) : "");
  }

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="text-sm font-semibold text-gray-800">
          What are you paying?
        </span>
        <select
          className="mt-2 h-12 w-full rounded-md border border-[#cfd8e5] bg-white px-3 text-base"
          name="rentBillId"
          onChange={(event) => selectBill(event.target.value)}
          required
          value={billId}
        >
          <option value="">Select a rent bill</option>
          {bills.map((bill) => (
            <option key={bill.id} value={bill.id}>
              {bill.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-gray-800">
          Amount paid (RM)
        </span>
        <input
          className="mt-2 h-12 w-full rounded-md border border-[#cfd8e5] px-3 text-base"
          max={selectedBill?.outstanding}
          min="0.01"
          name="amount"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          required
          step="0.01"
          type="number"
          value={amount}
        />
      </label>

      {selectedBill ? (
        <div
          aria-live="polite"
          className="grid gap-3 rounded-md border border-[#eadcb9] bg-[#fbf8f1] p-4 text-sm sm:grid-cols-2"
        >
          <div>
            <p className="text-gray-600">Current outstanding</p>
            <p className="mt-1 font-semibold text-red-700">
              {moneyFormatter.format(selectedBill.outstanding)}
            </p>
          </div>
          <div>
            <p className="text-gray-600">Remaining after verification</p>
            <p
              className={`mt-1 font-semibold ${
                remaining > 0.005 ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {moneyFormatter.format(remaining)}
            </p>
          </div>
          {remaining > 0.005 ? (
            <p className="sm:col-span-2">
              Partial payment accepted. The remaining balance stays open until
              it is fully paid.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
