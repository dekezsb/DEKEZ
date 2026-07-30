"use client";

import { useState } from "react";
import {
  allocatePaymentPurpose,
  paymentPurposeTotal,
  type PaymentPurpose,
} from "@/lib/payments/payment-purpose";

type PaymentBillOption = {
  id: string;
  label: string;
  invoiceDate: string;
  dueDate: string;
  propertyName: string;
  roomName: string;
  rentOutstanding: number;
  depositOutstanding: number;
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
  const [paymentPurpose, setPaymentPurpose] =
    useState<PaymentPurpose>("monthly_rent");
  const selectedBill = bills.find((bill) => bill.id === billId) ?? null;
  const numericAmount = Number(amount);
  const submittedAmount =
    Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0;
  const selectedOutstanding = selectedBill
    ? paymentPurposeTotal(
        paymentPurpose,
        selectedBill.rentOutstanding,
        selectedBill.depositOutstanding,
      )
    : 0;
  const remaining = selectedBill
    ? Math.max(selectedOutstanding - submittedAmount, 0)
    : 0;
  const allocation = selectedBill
    ? allocatePaymentPurpose({
        purpose: paymentPurpose,
        amount: submittedAmount,
        rentOutstanding: selectedBill.rentOutstanding,
        depositOutstanding: selectedBill.depositOutstanding,
      })
    : { rent: 0, deposit: 0, extra: 0 };

  function selectBill(nextBillId: string) {
    const nextBill = bills.find((bill) => bill.id === nextBillId);
    const nextPurpose: PaymentPurpose =
      nextBill && nextBill.rentOutstanding > 0.005
        ? "monthly_rent"
        : "deposit";
    setBillId(nextBillId);
    setPaymentPurpose(nextPurpose);
    setAmount(
      nextBill
        ? paymentPurposeTotal(
            nextPurpose,
            nextBill.rentOutstanding,
            nextBill.depositOutstanding,
          ).toFixed(2)
        : "",
    );
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

      {selectedBill ? (
        <div className="grid gap-3 rounded-md border border-[#d7dee8] bg-white p-4 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="text-gray-600">Selected invoice</p>
            <p className="mt-1 font-semibold text-gray-950">
              {selectedBill.propertyName} / {selectedBill.roomName}
            </p>
          </div>
          <div>
            <p className="text-gray-600">Invoice date</p>
            <p className="mt-1 font-semibold text-gray-950">
              {selectedBill.invoiceDate}
            </p>
          </div>
          <div>
            <p className="text-gray-600">Due date</p>
            <p className="mt-1 font-semibold text-red-700">
              {selectedBill.dueDate}
            </p>
          </div>
        </div>
      ) : null}

      {selectedBill ? (
        <label className="block">
          <span className="text-sm font-semibold text-gray-800">
            Payment for
          </span>
          <select
            className="mt-2 h-12 w-full rounded-md border border-[#cfd8e5] bg-white px-3 text-base"
            name="paymentPurpose"
            onChange={(event) => {
              const purpose = event.target.value as PaymentPurpose;
              setPaymentPurpose(purpose);
              setAmount(
                paymentPurposeTotal(
                  purpose,
                  selectedBill.rentOutstanding,
                  selectedBill.depositOutstanding,
                ).toFixed(2),
              );
            }}
            value={paymentPurpose}
          >
            {selectedBill.rentOutstanding > 0.005 ? (
              <option value="monthly_rent">Monthly Rent</option>
            ) : null}
            {selectedBill.depositOutstanding > 0.005 ? (
              <option value="deposit">Deposit</option>
            ) : null}
            {selectedBill.rentOutstanding > 0.005 &&
            selectedBill.depositOutstanding > 0.005 ? (
              <option value="rent_and_deposit">Rent + Deposit</option>
            ) : null}
          </select>
        </label>
      ) : null}

      <label className="block">
        <span className="text-sm font-semibold text-gray-800">
          Amount paid (RM)
        </span>
        <input
          className="mt-2 h-12 w-full rounded-md border border-[#cfd8e5] px-3 text-base"
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
              {moneyFormatter.format(selectedOutstanding)}
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
          <p className="sm:col-span-2 text-gray-700">
            Rent: {moneyFormatter.format(allocation.rent)} · Deposit: {moneyFormatter.format(allocation.deposit)}
          </p>
          {allocation.extra > 0.005 ? (
            <p className="sm:col-span-2 font-medium text-amber-800">
              Extra amount submitted: {moneyFormatter.format(allocation.extra)}.
              Admin will confirm its purpose before verification and add it to
              this invoice.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
