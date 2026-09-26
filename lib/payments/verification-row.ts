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

export function bankReferenceError(message: string) {
  if (message.includes("duplicate_bank_reference")) return "This bank code is already linked to another payment.";
  if (message.includes("reference_changed")) return "Bank code changed since this row loaded. Refresh before saving.";
  if (message.includes("reference_conflict")) return "Linked payment has a different bank code. Please review it before changing.";
  if (message.includes("invalid_bank_reference")) return "Please enter bank code.";
  return "Could not save bank code. Please try again.";
}
