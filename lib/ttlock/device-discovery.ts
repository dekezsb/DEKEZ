export const TTLOCK_ELECTRICITY_RATE_ENV = "TTLOCK_ELECTRICITY_RM_PER_KWH";

export type LiveTTLock = {
  lockId: number;
  lockAlias?: string | null;
  lockName?: string | null;
  electricQuantity?: number | null;
  hasGateway?: number | null;
  groupId?: number | null;
  groupName?: string | null;
  keyboardPwdVersion?: number | null;
  specialValue?: number | null;
};

export type ExistingTTLock = {
  id: string;
  onboarding_key: string;
  provider_lock_id?: number | string | null;
  sync_status: string;
};

export type LiveTTLockMeter = {
  electricMeterId: number | string;
  name?: string | null;
  number?: string | null;
  online?: number | null;
  onOff?: number | null;
  payMode?: number | null;
  totalKwh?: string | number | null;
  remainderKwh?: string | number | null;
  price?: string | number | null;
};

export type ExistingTTLockMeter = {
  id: string;
  provider: string;
  provider_meter_id?: string | null;
  meter_number?: string | null;
  status?: string | null;
};

export type PropertyOption = {
  id: string;
  name: string;
  property_code?: string | null;
};

export type RoomOption = {
  id: string;
  property_id: string;
  name?: string | null;
  room_number?: string | null;
};

export type AssignmentSuggestion = {
  propertyId: string;
  roomId: string | null;
  accessScope: "property_entry" | "room_entry";
  label: string;
};

export function onboardingKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function numberValue(value: string | number | null | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roomNumberMatches(room: RoomOption, roomNo: string) {
  const values = [room.room_number, room.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  const n = roomNo.toLowerCase();
  return values.some(
    (value) =>
      value === n
      || value === `room ${n}`
      || value === `office ${n}`
      || new RegExp(`\\broom\\s*${escapeRegExp(n)}\\b`).test(value),
  );
}

function matchProperty(alias: string, properties: PropertyOption[]) {
  const text = alias.trim().toLowerCase();
  const matches = properties.filter((property) => {
    const code = (property.property_code ?? "").trim().toLowerCase();
    const name = (property.name ?? "").trim().toLowerCase();
    if (code && new RegExp(`\\b${escapeRegExp(code)}\\b`).test(text)) return true;
    if (code === "bds" && /\bbundusan\b/.test(text)) return true;
    if (name && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text)) return true;
    return false;
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Suggest a property/room from a lock or meter alias. Never apply this
 * automatically; a Super Admin must confirm the mapping.
 */
export function suggestAssignmentFromAlias(
  alias: string,
  properties: PropertyOption[],
  rooms: RoomOption[],
  options: { allowMainDoor?: boolean } = {},
): AssignmentSuggestion | null {
  const text = alias.trim();
  if (!text) return null;
  const property = matchProperty(text, properties);
  if (!property) return null;
  const propertyLabel = property.property_code || property.name;
  const normalized = text.toLowerCase();
  const looksNumbered = /\b(?:office|room)\s*\d+\b/.test(normalized);
  if (
    options.allowMainDoor
    && /\b(main|entrance)\b/.test(normalized)
    && !looksNumbered
  ) {
    return {
      propertyId: property.id,
      roomId: null,
      accessScope: "property_entry",
      label: `${propertyLabel} · Main entrance`,
    };
  }

  const numberMatch =
    normalized.match(/\b(?:office|room)\s*(\d+)\b/)
    ?? normalized.match(/\b(\d+)\s*$/);
  if (!numberMatch) return null;
  const candidates = rooms.filter(
    (room) =>
      room.property_id === property.id && roomNumberMatches(room, numberMatch[1]),
  );
  if (candidates.length !== 1) return null;
  const room = candidates[0];
  return {
    propertyId: property.id,
    roomId: room.id,
    accessScope: "room_entry",
    label: `${propertyLabel} · ${room.room_number || room.name || `Room ${numberMatch[1]}`}`,
  };
}

export function liveLockKeys(live: LiveTTLock) {
  return [live.lockAlias, live.lockName]
    .filter((name): name is string => Boolean(name))
    .map((name) => onboardingKey(name));
}

export function matchLiveLock(live: LiveTTLock, existing: ExistingTTLock[]) {
  const byId = existing.find(
    (device) =>
      device.provider_lock_id != null
      && Number(device.provider_lock_id) === Number(live.lockId),
  );
  if (byId) return byId;
  const keys = new Set(liveLockKeys(live));
  return existing.find((device) => keys.has(device.onboarding_key)) ?? null;
}

export function planTTLockLockSync(input: {
  existing: ExistingTTLock[];
  live: LiveTTLock[];
}) {
  const used = new Set<string>();
  const updates: Array<{ existing: ExistingTTLock; live: LiveTTLock }> = [];
  const inserts: Array<{
    onboarding_key: string;
    provider_lock_id: number;
    provider_lock_name: string;
    provider_group_id: number | null;
    provider_group_name: string | null;
    battery_level: number | null;
    has_gateway: boolean | null;
  }> = [];

  for (const live of input.live) {
    const remaining = input.existing.filter((device) => !used.has(device.id));
    const match = matchLiveLock(live, remaining);
    if (match) {
      used.add(match.id);
      if (match.sync_status !== "retired") {
        updates.push({ existing: match, live });
      }
      continue;
    }
    const displayName =
      live.lockAlias || live.lockName || `Lock ${live.lockId}`;
    const key = onboardingKey(displayName) || `lock-${live.lockId}`;
    inserts.push({
      onboarding_key: key,
      provider_lock_id: live.lockId,
      provider_lock_name: displayName,
      provider_group_id: live.groupId ?? null,
      provider_group_name: live.groupName ?? null,
      battery_level:
        live.electricQuantity == null ? null : numberValue(live.electricQuantity),
      has_gateway:
        live.hasGateway === undefined || live.hasGateway === null
          ? null
          : live.hasGateway === 1,
    });
  }

  return {
    updates,
    inserts,
    missing: input.existing.filter(
      (device) => device.sync_status !== "retired" && !used.has(device.id),
    ),
  };
}

export function matchLiveMeter(
  live: LiveTTLockMeter,
  existing: ExistingTTLockMeter[],
) {
  const liveId = String(live.electricMeterId);
  return (
    existing.find(
      (meter) =>
        meter.provider === "ttlock"
        && meter.provider_meter_id
        && meter.provider_meter_id === liveId,
    ) ?? null
  );
}

export function meterConnectionStatus(online: number | null | undefined) {
  if (online === 1) return "online" as const;
  if (online === 0) return "offline" as const;
  return "unknown" as const;
}

export function meterPowerState(onOff: number | null | undefined) {
  if (onOff === 1) return "on" as const;
  if (onOff === 0) return "off" as const;
  return "unknown" as const;
}

export function planTTLockMeterSync(input: {
  existing: ExistingTTLockMeter[];
  live: LiveTTLockMeter[];
}) {
  const used = new Set<string>();
  const updates: Array<{ existing: ExistingTTLockMeter; live: LiveTTLockMeter }> = [];
  const inserts: LiveTTLockMeter[] = [];

  for (const live of input.live) {
    const remaining = input.existing.filter((meter) => !used.has(meter.id));
    const match = matchLiveMeter(live, remaining);
    if (match) {
      used.add(match.id);
      if (match.status !== "replaced") {
        updates.push({ existing: match, live });
      }
      continue;
    }
    inserts.push(live);
  }

  return { updates, inserts };
}

export function validateAssignment(input: {
  propertyId: string;
  roomId?: string | null;
  accessScope: "property_entry" | "room_entry";
  properties: PropertyOption[];
  rooms: RoomOption[];
  requireRoom?: boolean;
}) {
  const property = input.properties.find((item) => item.id === input.propertyId);
  if (!property) return { ok: false as const, error: "Select a property." };
  if (input.accessScope === "property_entry" && !input.requireRoom) {
    if (input.roomId) {
      return { ok: false as const, error: "A main-door lock is not assigned to a room." };
    }
    return { ok: true as const, property, room: null };
  }
  const room = input.rooms.find((item) => item.id === input.roomId);
  if (!room) return { ok: false as const, error: "Select a room." };
  if (room.property_id !== property.id) {
    return { ok: false as const, error: "That room does not belong to the selected property." };
  }
  return { ok: true as const, property, room };
}

export function isUnassignedLock(device: {
  property_id?: string | null;
  room_id?: string | null;
  access_scope?: string | null;
}) {
  if (!device.property_id) return true;
  return device.access_scope !== "property_entry" && !device.room_id;
}

export function isUnassignedMeter(meter: {
  property_id?: string | null;
  room_id?: string | null;
}) {
  return !meter.property_id || !meter.room_id;
}

export function readRmPerKwh(raw: string | null | undefined) {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function kwhFromPaidAmount(amount: number, rmPerKwh: number) {
  if (!(amount > 0) || !(rmPerKwh > 0)) return null;
  return Math.round((amount / rmPerKwh) * 1000) / 1000;
}

export function ttlockRechargeReference(requestId: string) {
  return `ttlock-recharge:${requestId}`;
}

export function canAutoRechargeTTLockMeter(input: {
  provider?: string | null;
  providerMeterId?: string | null;
  roomId?: string | null;
  payMode?: number | string | null;
  rmPerKwh?: number | null;
  amount?: number | null;
}) {
  if (input.provider !== "ttlock") return { ok: false as const, reason: "not_ttlock" };
  if (!input.providerMeterId || !input.roomId) {
    return { ok: false as const, reason: "unassigned" };
  }
  if (input.payMode === 0 || input.payMode === "0") {
    return { ok: false as const, reason: "not_prepaid" };
  }
  if (input.rmPerKwh == null) return { ok: false as const, reason: "rate_unset" };
  const kwh = kwhFromPaidAmount(Number(input.amount ?? 0), input.rmPerKwh);
  if (kwh == null || kwh <= 0) return { ok: false as const, reason: "invalid_amount" };
  return { ok: true as const, kwh };
}
