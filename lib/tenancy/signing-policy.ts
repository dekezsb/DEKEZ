export const signableAgreementStatuses = [
  "pending_signature", "renewal_pending", "renewal_sent", "expired",
];

export function canSignAgreement(agreement: {
  status: string;
  signed_at?: string | null;
  admin_rejected_at?: string | null;
  replacement_agreement_id?: string | null;
}) {
  return signableAgreementStatuses.includes(agreement.status) &&
    !agreement.signed_at && !agreement.admin_rejected_at &&
    !agreement.replacement_agreement_id;
}

// Historical signatures are evidence only: never roll current dates/rent/deposit back.
export function canApplySignedTerm(
  endDate: string | null,
  today: string,
  currentEndDates: Array<string | null>,
) {
  return Boolean(endDate && endDate >= today &&
    currentEndDates.every(current => !current || endDate >= current));
}
