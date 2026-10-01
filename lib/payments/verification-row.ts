// Match the existing reconciliation token rule; generic QR labels are not codes.
export function usableBankReference(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  const token = text.replace(/[^a-z0-9]/gi, "");
  return token.length >= 4 && /\d/.test(token) ? text : "";
}

export function bankReferenceRequired(method: string) {
  return ["bank_transfer", "duitnow", "online_payment", "qr", "qr_payment", "duitnow_qr"].includes(method);
}

export function paymentMatchesFilters(s: {
  tenant_id: string | null; payment_method: string; bill_month: string | null;
  payment_date: string | null; verification_status: string;
}, filters: { status: string; tenant?: string; method?: string; month?: string }) {
  return (filters.status === "all" || s.verification_status === filters.status)
    && (!filters.tenant || s.tenant_id === filters.tenant)
    && (!filters.method || s.payment_method === filters.method)
    && (!filters.month || (s.bill_month ?? s.payment_date ?? "").slice(0, 7) === filters.month);
}

// Verify paths: keep the specific bank-code guard result instead of a generic
// review error, so staff see why the database refused the code.
export function bankReferenceResult(message: string | undefined, fallback: string) {
  if (message?.includes("duplicate_bank_reference")) return "error=duplicate_bank_reference";
  if (message?.includes("bank_reference_exceeds_amount")) return "error=bank_reference_exceeds_amount";
  return fallback;
}

// Folder uploads: a bank code is a duplicate only on the same invoice. Other
// invoices may share one transfer; the database caps the total at the bank amount.
export function sameInvoiceBankReference(
  slips: { rent_bill_id: string | null; reference_number: string | null; verification_status: string }[],
  billId: string,
  reference: string,
) {
  const code = (value: string | null) => (value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return Boolean(code(reference)) && slips.some((s) => s.verification_status !== "rejected"
    && s.rent_bill_id === billId && code(s.reference_number) === code(reference));
}

export function bankReferenceError(message: string) {
  if (message.includes("duplicate_bank_reference")) return "This bank code is already linked to the same invoice / payment. Please review it before reusing the code.";
  if (message.includes("bank_reference_exceeds_amount")) return "Saving this would allocate more than the actual bank transaction amount for this code. Check the other rooms/invoices linked to it.";
  if (message.includes("reference_changed")) return "Bank code changed since this row loaded. Refresh before saving.";
  if (message.includes("reference_conflict")) return "Linked payment has a different bank code. Please review it before changing.";
  if (message.includes("invalid_bank_reference")) return "Please enter bank code.";
  return "Could not save bank code. Please try again.";
}
