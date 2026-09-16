type DepositSource = {
  room_id: string | null;
  tenancy_id: string | null;
  tenant_record_id?: string | null;
};

// A room can be reused by many tenants. Never use room identity alone as
// evidence that an old deposit belongs to its current occupant.
export function depositBelongsToOccupant(
  payment: DepositSource,
  occupant: { roomId: string; tenancyId: string | null; tenantRecordId: string | null },
) {
  if (payment.room_id !== occupant.roomId) return false;
  if (payment.tenancy_id) return payment.tenancy_id === occupant.tenancyId;
  return Boolean(payment.tenant_record_id && payment.tenant_record_id === occupant.tenantRecordId);
}

// Resolve balances by tenancy, never by room: a room's previous deposits must
// not settle its next occupant's debt. Tenancy identity also survives transfers.
export function createTenantDepositLookup(
  payments: Array<{ tenancy_id: string | null; amount: number | string }>,
  submissions: Array<{ tenancy_id: string | null; tenant_record_id: string | null; amount: number | string }>,
) {
  const paymentsByTenancy = new Map<string, number>();
  const submissionsByTenancy = new Map<string, number>();
  const legacySubmissionsByRecord = new Map<string, number>();
  const add = (map: Map<string, number>, key: string | null, amount: number | string) => {
    if (key) map.set(key, (map.get(key) ?? 0) + Number(amount ?? 0));
  };
  for (const payment of payments) add(paymentsByTenancy, payment.tenancy_id, payment.amount);
  for (const submission of submissions) {
    if (submission.tenancy_id) {
      add(submissionsByTenancy, submission.tenancy_id, submission.amount);
    } else {
      add(legacySubmissionsByRecord, submission.tenant_record_id, submission.amount);
    }
  }
  return (tenancyId: string | null, tenantRecordId: string | null) => {
    const canonical = tenancyId ? paymentsByTenancy.get(tenancyId) : undefined;
    // A slip normally becomes a canonical payment. Do not add both copies.
    return canonical ?? (
      (tenancyId ? submissionsByTenancy.get(tenancyId) : undefined)
      ?? (tenantRecordId ? legacySubmissionsByRecord.get(tenantRecordId) : undefined)
      ?? 0
    );
  };
}
