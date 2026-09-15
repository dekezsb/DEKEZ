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
