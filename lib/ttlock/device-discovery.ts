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

export const AUTO_ALIAS_SOURCE = "auto_alias";
export const MANUAL_ASSIGNMENT_SOURCE = "manual";

export type AutoLinkSkipReason =
  | "no_match"
  | "ambiguous_property"
  | "ambiguous_room"
  | "ambiguous_main_and_room"
  | "no_room"
  | "meter_room_occupied"
  | "meter_room_conflict";

export type AutoLinkDecision =
  | {
      ok: true;
      propertyId: string;
      roomId: string | null;
      accessScope: "property_entry" | "room_entry";
      label: string;
      source: typeof AUTO_ALIAS_SOURCE;
    }
  | { ok: false; reason: AutoLinkSkipReason };

export const AUTO_LINK_SKIP_LABELS: Record<AutoLinkSkipReason, string> = {
  no_match: "Name did not match a property and room.",
  ambiguous_property: "Name matched more than one property.",
  ambiguous_room: "Name matched more than one room.",
  ambiguous_main_and_room: "Name has both a main-door phrase and a room number.",
  no_room: "No matching room was found in that property.",
  meter_room_occupied: "That room already has a meter, so this one was left unassigned.",
  meter_room_conflict: "Two meters would map to the same room, so both were left unassigned.",
};

const PROPERTY_NAME_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "at", "to", "in", "on", "for",
  "sdn", "bhd", "ltd", "inc", "co", "apartment", "apartments", "apt",
  "room", "rooms", "office", "offices", "block", "blocks", "property",
  "properties", "branch", "unit", "units", "floor", "main", "door",
  "entrance", "park", "square", "court", "villa", "residences",
  "residence", "hotel", "inn", "house", "homes", "home", "new", "old",
  "kota", "kinabalu", "sabah", "malaysia", "area", "lot",
]);

function aliasTokens(alias: string) {
  return alias.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function propertyMatchTerms(property: PropertyOption) {
  const terms = new Set<string>();
  const code = (property.property_code ?? "").trim().toLowerCase();
  if (code) terms.add(code);
  for (const word of aliasTokens(property.name ?? "")) {
    if (word.length >= 4 && !PROPERTY_NAME_STOPWORDS.has(word)) {
      terms.add(word);
    }
  }
  return terms;
}

function matchedProperties(alias: string, properties: PropertyOption[]) {
  const tokens = new Set(aliasTokens(alias));
  if (!tokens.size) return [];
  return properties.filter((property) =>
    [...propertyMatchTerms(property)].some((term) => tokens.has(term)),
  );
}

function uniqueRoomNumbers(alias: string) {
  const normalized = alias.trim().toLowerCase();
  const numbered = [...normalized.matchAll(/\b(?:office|room)\s*(\d+)\b/g)].map((match) => match[1]);
  if (numbered.length) return [...new Set(numbered)];
  return [...new Set([...normalized.matchAll(/\b(\d+)\b/g)].map((match) => match[1]))];
}

function hasMainDoorPhrase(alias: string) {
  return /\bmain(\s+(office|door|entrance))?\b|\bentrance\b/.test(alias.trim().toLowerCase());
}

function assignmentLabel(property: PropertyOption, room: RoomOption | null, roomNo?: string) {
  const propertyLabel = property.property_code || property.name;
  if (!room) return `${propertyLabel} · Main entrance`;
  return `${propertyLabel} · ${room.room_number || room.name || `Room ${roomNo ?? ""}`.trim()}`;
}

/**
 * Resolve an unambiguous property/room (or main door) from a lock or meter alias.
 * Returns a skip reason when the name is missing, ambiguous, or incomplete.
 */
export function resolveAutoLinkFromAlias(
  alias: string,
  properties: PropertyOption[],
  rooms: RoomOption[],
  options: { allowMainDoor?: boolean } = {},
): AutoLinkDecision {
  const text = alias.trim();
  if (!text) return { ok: false, reason: "no_match" };

  const propertyHits = matchedProperties(text, properties);
  if (propertyHits.length === 0) return { ok: false, reason: "no_match" };
  if (propertyHits.length > 1) return { ok: false, reason: "ambiguous_property" };
  const property = propertyHits[0];
  const roomNos = uniqueRoomNumbers(text);
  const mainDoor = Boolean(options.allowMainDoor && hasMainDoorPhrase(text));

  if (mainDoor && roomNos.length) {
    return { ok: false, reason: "ambiguous_main_and_room" };
  }
  if (mainDoor) {
    return {
      ok: true,
      propertyId: property.id,
      roomId: null,
      accessScope: "property_entry",
      label: assignmentLabel(property, null),
      source: AUTO_ALIAS_SOURCE,
    };
  }
  if (roomNos.length === 0) return { ok: false, reason: "no_room" };
  if (roomNos.length > 1) return { ok: false, reason: "ambiguous_room" };

  const candidates = rooms.filter(
    (room) => room.property_id === property.id && roomNumberMatches(room, roomNos[0]),
  );
  if (candidates.length === 0) return { ok: false, reason: "no_room" };
  if (candidates.length > 1) return { ok: false, reason: "ambiguous_room" };
  const room = candidates[0];
  return {
    ok: true,
    propertyId: property.id,
    roomId: room.id,
    accessScope: "room_entry",
    label: assignmentLabel(property, room, roomNos[0]),
    source: AUTO_ALIAS_SOURCE,
  };
}

/** Suggest a property/room from a lock or meter alias when the match is unambiguous. */
export function suggestAssignmentFromAlias(
  alias: string,
  properties: PropertyOption[],
  rooms: RoomOption[],
  options: { allowMainDoor?: boolean } = {},
): AssignmentSuggestion | null {
  const decision = resolveAutoLinkFromAlias(alias, properties, rooms, options);
  if (!decision.ok) return null;
  return {
    propertyId: decision.propertyId,
    roomId: decision.roomId,
    accessScope: decision.accessScope,
    label: decision.label,
  };
}

export type AutoLinkDeviceInput = {
  key: string;
  alias: string;
  property_id?: string | null;
  room_id?: string | null;
  access_scope?: string | null;
};

export type AutoLinkResult<T extends AutoLinkDeviceInput> = {
  linked: Array<{ device: T; decision: Extract<AutoLinkDecision, { ok: true }> }>;
  skipped: Array<{ device: T; reason: AutoLinkSkipReason }>;
};

function isAlreadyAssignedLock(device: AutoLinkDeviceInput) {
  if (!device.property_id) return false;
  return device.access_scope === "property_entry" || Boolean(device.room_id);
}

function isAlreadyAssignedMeter(device: AutoLinkDeviceInput) {
  return Boolean(device.property_id && device.room_id);
}

/** Auto-link newly discovered (or still unassigned) locks. Never overwrites an existing assignment. */
export function planDiscoveredLockAutoLinks<T extends AutoLinkDeviceInput>(input: {
  devices: T[];
  properties: PropertyOption[];
  rooms: RoomOption[];
}): AutoLinkResult<T> {
  const linked: AutoLinkResult<T>["linked"] = [];
  const skipped: AutoLinkResult<T>["skipped"] = [];
  for (const device of input.devices) {
    if (isAlreadyAssignedLock(device)) continue;
    const decision = resolveAutoLinkFromAlias(device.alias, input.properties, input.rooms, {
      allowMainDoor: true,
    });
    if (decision.ok) linked.push({ device, decision });
    else skipped.push({ device, reason: decision.reason });
  }
  return { linked, skipped };
}

/** Auto-link newly discovered meters. Never overwrites an assignment or puts two meters on one room. */
export function planDiscoveredMeterAutoLinks<T extends AutoLinkDeviceInput>(input: {
  meters: T[];
  properties: PropertyOption[];
  rooms: RoomOption[];
  occupiedRoomIds?: Iterable<string>;
}): AutoLinkResult<T> {
  const occupied = new Set(input.occupiedRoomIds ?? []);
  const linked: AutoLinkResult<T>["linked"] = [];
  const skipped: AutoLinkResult<T>["skipped"] = [];
  const candidates: Array<{ meter: T; decision: Extract<AutoLinkDecision, { ok: true }> }> = [];

  for (const meter of input.meters) {
    if (isAlreadyAssignedMeter(meter)) continue;
    const decision = resolveAutoLinkFromAlias(meter.alias, input.properties, input.rooms, {
      allowMainDoor: false,
    });
    if (!decision.ok) {
      skipped.push({ device: meter, reason: decision.reason });
      continue;
    }
    if (!decision.roomId) {
      skipped.push({ device: meter, reason: "no_room" });
      continue;
    }
    candidates.push({ meter, decision });
  }

  const roomCounts = new Map<string, number>();
  for (const item of candidates) {
    const roomId = item.decision.roomId as string;
    roomCounts.set(roomId, (roomCounts.get(roomId) ?? 0) + 1);
  }

  for (const item of candidates) {
    const roomId = item.decision.roomId as string;
    if (occupied.has(roomId)) {
      skipped.push({ device: item.meter, reason: "meter_room_occupied" });
      continue;
    }
    if ((roomCounts.get(roomId) ?? 0) > 1) {
      skipped.push({ device: item.meter, reason: "meter_room_conflict" });
      continue;
    }
    linked.push({ device: item.meter, decision: item.decision });
    occupied.add(roomId);
  }

  return { linked, skipped };
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
