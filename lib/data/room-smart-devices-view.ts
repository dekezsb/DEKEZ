
export type RoomMeterTopUp = {
  id: string;
  amount: number;
  status: string;
  paymentDate: string | null;
  verifiedAt: string | null;
  creditedAt: string | null;
  creditBefore: number | null;
  creditAfter: number | null;
  providerReference: string | null;
  source: "verified_slip" | "ttlock_recharge";
};

export type RoomSmartMeterView = {
  id: string;
  provider: string | null;
  meterNumber: string | null;
  meterType: string | null;
  unitLabel: string;
  remainingUnits: number | null;
  remainingCredit: number | null;
  totalUnits: number | null;
  connectionStatus: string | null;
  powerState: string | null;
  lastSyncedAt: string | null;
  lastReportedAt: string | null;
  lastSyncError: string | null;
  status: string | null;
  readings: Array<{
    id: string;
    billingMonth: string | null;
    readingDate: string | null;
    previousReading: number | null;
    currentReading: number | null;
    usage: number | null;
    rate: number | null;
    chargeAmount: number | null;
    topUpAmount: number | null;
    remainingCredit: number | null;
  }>;
  topUps: RoomMeterTopUp[];
};

export type RoomSmartLockView = {
  id: string;
  name: string;
  accessScope: "property_entry" | "room_entry";
  batteryLevel: number | null;
  hasGateway: boolean | null;
  syncStatus: string | null;
  lastSyncedAt: string | null;
  activeCodeCount: number;
  validUntil: string | null;
};

export type RoomSmartDevices = {
  meters: RoomSmartMeterView[];
  locks: RoomSmartLockView[];
};

export function locksForRoom<T extends { access_scope: string; room_id?: string | null }>(
  devices: T[],
  roomId: string,
) {
  return devices.filter(
    (device) =>
      device.access_scope === "property_entry"
      || (device.access_scope === "room_entry" && device.room_id === roomId),
  );
}

export function summarizeActiveCodes(
  grants: Array<{ device_id: string; credential_state: string; valid_until: string | null }>,
  deviceId: string,
) {
  const active = grants.filter(
    (grant) => grant.device_id === deviceId && grant.credential_state === "active",
  );
  const validUntil = active
    .map((grant) => grant.valid_until)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return { activeCodeCount: active.length, validUntil };
}

export function topUpSource(row: {
  provider_reference?: string | null;
  credited_at?: string | null;
}): RoomMeterTopUp["source"] {
  return row.provider_reference && row.credited_at ? "ttlock_recharge" : "verified_slip";
}

export function compareRoomLocks(left: RoomSmartLockView, right: RoomSmartLockView) {
  if (left.accessScope !== right.accessScope) {
    return left.accessScope === "property_entry" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

export function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
