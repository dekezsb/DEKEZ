export type FolderSlip = {
  id: string; billId: string | null; purpose: string; amount: number; date: string;
  note: string | null; status: string; reference: string | null; url: string | null;
};

export function folderSummary(required: number, outstanding: number, pending: number) {
  return { required, verified: Math.max(required - outstanding, 0), pending,
    outstanding: Math.max(outstanding, 0), toSubmit: Math.max(outstanding - pending, 0),
    excess: Math.max(pending - outstanding, 0) };
}

export function paymentFolderKey(s: { id: string; rent_bill_id: string | null; tenancy_id: string | null; tenant_record_id: string | null; tenant_application_id: string | null; payment_type: string }) {
  if (s.payment_type === "deposit") return `deposit:${s.tenancy_id ?? s.tenant_record_id ?? s.tenant_application_id ?? s.rent_bill_id ?? s.id}`;
  return `rental:${s.rent_bill_id ?? s.tenant_application_id ?? s.id}`;
}

export function groupPaymentFolders<T extends Parameters<typeof paymentFolderKey>[0] & { verification_status: string }>(rows: T[], status = "all") {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const key = paymentFolderKey(row); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  return [...groups.entries()].filter(([, rows]) => status === "all" || rows.some((row) => row.verification_status === status));
}
