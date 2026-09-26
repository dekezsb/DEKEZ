"use client";

import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocumentPreview } from "@/components/ui/document-preview";
import { TableCell, TableRow } from "@/components/ui/table";
import { statusBadgeClass } from "@/lib/status-styles";
import { paymentPurposeLabel } from "@/lib/payments/payment-purpose";
import { usableBankReference } from "@/lib/payments/verification-row";
import { savePaymentBankReference } from "./reference-actions";
import { PaymentRecordActions, type PaymentRecordActionsProps } from "./payment-record-actions";

type Row = PaymentRecordActionsProps & { checkInSummary?: {
  agreedRent: string; requiredDeposit: string; reportedRent: string; reportedDeposit: string; note: string | null;
} | null };

export function PaymentSlipRow({ row, paymentMethod, paymentNote, canCorrectPurpose, canReverse, returnTo, errorMessages }: {
  row: Row; paymentMethod: string; paymentNote?: string | null;
  canCorrectPurpose: boolean; canReverse: boolean; returnTo: string; errorMessages: Record<string, string>;
}) {
  const [savedReference, setSavedReference] = useState(row.referenceNumber);
  const [reference, setReference] = useState(usableBankReference(row.referenceNumber));
  const [editing, setEditing] = useState(!usableBankReference(row.referenceNumber));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function saveReference() {
    if (busy) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const result = await savePaymentBankReference(row.submissionId, reference, savedReference);
      if (result.error) { setMessage(result.error); setFailed(true); }
      else if (result.reference) {
        setSavedReference(result.reference); setReference(result.reference); setEditing(false);
        setMessage(row.status === "verified" ? "Bank code saved. Payment stays Verified." : "Bank code saved.");
      }
    } catch { setMessage("Could not save bank code. Your entry is kept; please retry."); setFailed(true); }
    finally { setBusy(false); }
  }
  const month = /^\d{4}-\d{2}/.test(row.billMonth) ? new Intl.DateTimeFormat("en-MY", {
    month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(row.billMonth.slice(0, 7) + "-01T00:00:00+08:00")) : "Not assigned";
  return <TableRow className="align-top" data-payment-slip={row.submissionId}>
    <TableCell>{row.receiptUrl ? <DocumentPreview url={row.receiptUrl}
      contentType={row.receiptIsImage ? "image/*" : "application/pdf"} label="View slip" showName={false} size="sm" /> : "No slip"}</TableCell>
    <TableCell className="min-w-44 whitespace-normal font-medium">{row.tenantName}</TableCell>
    <TableCell className="min-w-32 whitespace-normal">{row.propertyName}<br />{row.roomName}</TableCell>
    <TableCell className="whitespace-nowrap">{month}</TableCell>
    <TableCell className="whitespace-nowrap"><strong>{row.amountSubmitted}</strong><p className="mt-1 text-xs">{paymentPurposeLabel(row.paymentPurpose)}</p></TableCell>
    <TableCell className="min-w-56">
      <label htmlFor={`bank-code-${row.submissionId}`} className="block text-xs font-medium">Bank Code</label>
      {editing ? <form onSubmit={event => { event.preventDefault(); void saveReference(); }} className="mt-1 flex gap-1">
        <input ref={input} id={`bank-code-${row.submissionId}`} aria-label={`Bank code for ${row.tenantName}`}
          className="w-36 rounded-md border border-[#d7dde5] px-2 py-1.5" type="text" maxLength={120}
          autoComplete="off" placeholder="Enter bank code" value={reference} disabled={busy}
          onChange={event => { setReference(event.target.value); setMessage(""); }} />
        <Button size="sm" variant="outline" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </form> : <div className="mt-1 flex items-start gap-2"><span className="break-all font-mono">{savedReference}</span>
        {row.status !== "verified" ? <button type="button" className="text-xs underline" onClick={() => setEditing(true)}>Edit</button> : null}</div>}
      {message ? <p role={failed ? "alert" : "status"} className={`mt-1 text-xs ${failed ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}
    </TableCell>
    <TableCell className="capitalize">{paymentMethod.replaceAll("_", " ")}</TableCell>
    <TableCell><Badge className={statusBadgeClass(row.status)}>{row.status === "verified" ? "Verified" : row.status === "rejected" ? "Rejected" : "Awaiting"}</Badge></TableCell>
    <TableCell className="min-w-36">
      <fieldset disabled={busy}><PaymentRecordActions {...row} inline paymentMethod={paymentMethod} referenceNumber={reference}
        canCorrectPurpose={canCorrectPurpose} canReverse={canReverse} returnTo={returnTo} errorMessages={errorMessages}
        onReferenceMissing={() => { setMessage("Please enter bank code."); setFailed(true); setEditing(true); input.current?.focus(); }} /></fieldset>
      {paymentNote ? <p className="mt-2 max-w-64 whitespace-pre-wrap text-xs text-gray-600">{paymentNote}</p> : null}
      {row.checkInSummary ? <details className="mt-2 text-xs"><summary className="cursor-pointer">Check-in terms</summary>
        <p>Agreed rent: {row.checkInSummary.agreedRent} · Required deposit: {row.checkInSummary.requiredDeposit}</p>
        <p>Received: rent {row.checkInSummary.reportedRent} · deposit {row.checkInSummary.reportedDeposit}</p>
        {row.checkInSummary.note ? <p>{row.checkInSummary.note}</p> : null}
      </details> : null}
    </TableCell>
  </TableRow>;
}
