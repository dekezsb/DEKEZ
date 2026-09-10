"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { addReservationPayment } from "./actions";
import { PaymentSlipFile } from "@/components/payment-slip-file";

function Submit() {
  const { pending } = useFormStatus();
  return <button className="rounded bg-[#b98a2c] px-4 py-2 text-white" disabled={pending}>{pending ? "Saving..." : "Save instalment & slip"}</button>;
}
export function ReservationPaymentForm({ applicationId, date }: { applicationId: string; date: string }) {
  const [key, setKey] = useState("");
  useEffect(() => setKey(crypto.randomUUID()), []);
  return <form action={addReservationPayment} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="applicationId" value={applicationId} />
    <input type="hidden" name="submissionKey" value={key} />
    <label>Amount received RM<input className="block w-full rounded border p-2" type="number" name="amount" min="0.01" step="0.01" required /></label>
    <label>Payment date<input className="block w-full rounded border p-2" type="date" name="paymentDate" defaultValue={date} required /></label>
    <label>Apply towards<select className="block w-full rounded border p-2" name="paymentPurpose"><option value="monthly_rent">First rent / room booking</option><option value="deposit">Deposit instalment</option><option value="rent_and_deposit">Rent + deposit</option><option value="other">Other charge</option></select></label>
    <label>Bank reference<input className="block w-full rounded border p-2" name="referenceNumber" /></label>
    <label>Note<input className="block w-full rounded border p-2" name="paymentNote" /></label>
    <label>Bank-in slip<PaymentSlipFile /></label>
    <Submit />
  </form>;
}
