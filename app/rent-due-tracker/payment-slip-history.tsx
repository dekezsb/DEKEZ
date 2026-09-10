"use client";

import { useEffect, useState } from "react";
import { getPaymentSlipHistory } from "./actions";

export function PaymentSlipHistory({ billId }: { billId: string }) {
  const [payments, setPayments] = useState<Awaited<ReturnType<typeof getPaymentSlipHistory>> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setPayments(null); setFailed(false);
    getPaymentSlipHistory(billId).then((rows) => { if (active) setPayments(rows); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [billId]);
  return <section className="mb-4 rounded border bg-slate-50 p-3 text-sm">
    <h3 className="font-semibold">Earlier payment slips & notes</h3>
    {failed ? <p role="alert">History could not load. Close and reopen to try again.</p> : payments === null ? <p>Loading payments…</p> : payments.length === 0 ? <p>No slips submitted for this invoice yet.</p> :
      <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">{payments.map((payment) => <li key={payment.id} className="rounded border bg-white p-2">
        <p>{payment.date} · RM {payment.amount.toFixed(2)} · {payment.status.replaceAll("_", " ")}</p>
        {payment.note ? <p className="whitespace-pre-wrap">{payment.note}</p> : null}
        {payment.url ? <a className="underline" href={payment.url} target="_blank" rel="noreferrer">View slip</a> : null}
      </li>)}</ul>}
    <p className="mt-2">Add the next payment below. Previous slips and notes stay saved. Only verified payments reduce the balance.</p>
  </section>;
}
