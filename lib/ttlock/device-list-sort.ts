import { isUnassignedLock, isUnassignedMeter } from "@/lib/ttlock/device-discovery";

export type SortableProperty = {
  name?: string | null;
  property_code?: string | null;
} | null | undefined;

export type SortableRoom = {
  name?: string | null;
  room_number?: string | null;
} | null | undefined;

export function propertySortKey(property: SortableProperty) {
  return (property?.property_code || property?.name || "").trim().toLocaleLowerCase("en");
}

export function roomSortNumber(room: SortableRoom) {
  const text = `${room?.room_number ?? ""} ${room?.name ?? ""}`.trim();
  const match = text.match(/\d+/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function nameCompare(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

export function compareSmartLockDevices<T extends {
  property_id?: string | null;
  room_id?: string | null;
  access_scope?: string | null;
  provider_lock_name?: string | null;
  properties?: SortableProperty;
  rooms?: SortableRoom;
}>(left: T, right: T) {
  const leftUnassigned = isUnassignedLock(left);
  const rightUnassigned = isUnassignedLock(right);
  if (leftUnassigned !== rightUnassigned) return leftUnassigned ? -1 : 1;

  const property = nameCompare(propertySortKey(left.properties), propertySortKey(right.properties));
  if (property) return property;

  const leftMain = left.access_scope === "property_entry";
  const rightMain = right.access_scope === "property_entry";
  if (leftMain !== rightMain) return leftMain ? -1 : 1;

  const leftRoom = roomSortNumber(left.rooms) ?? Number.POSITIVE_INFINITY;
  const rightRoom = roomSortNumber(right.rooms) ?? Number.POSITIVE_INFINITY;
  if (leftRoom !== rightRoom) return leftRoom - rightRoom;

  return nameCompare(left.provider_lock_name ?? "", right.provider_lock_name ?? "");
}

export function compareSmartMeters<T extends {
  property_id?: string | null;
  room_id?: string | null;
  meter_number?: string | null;
  provider_metadata?: { name?: string | null } | null;
  properties?: SortableProperty;
  rooms?: SortableRoom;
}>(left: T, right: T) {
  const leftUnassigned = isUnassignedMeter(left);
  const rightUnassigned = isUnassignedMeter(right);
  if (leftUnassigned !== rightUnassigned) return leftUnassigned ? -1 : 1;

  const property = nameCompare(propertySortKey(left.properties), propertySortKey(right.properties));
  if (property) return property;

  const leftRoom = roomSortNumber(left.rooms) ?? Number.POSITIVE_INFINITY;
  const rightRoom = roomSortNumber(right.rooms) ?? Number.POSITIVE_INFINITY;
  if (leftRoom !== rightRoom) return leftRoom - rightRoom;

  return nameCompare(
    left.provider_metadata?.name || left.meter_number || "",
    right.provider_metadata?.name || right.meter_number || "",
  );
}

export function failedGrantsToShow<T extends {
  tenancy_id?: string | null;
  credential_state: string;
}>(grants: T[]) {
  const openTenancies = new Set(
    grants
      .filter((grant) =>
        ["active", "pending_generation", "revoke_pending"].includes(grant.credential_state),
      )
      .map((grant) => grant.tenancy_id ?? ""),
  );
  return grants.filter((grant) => {
    if (grant.credential_state !== "error") return false;
    const tenancyId = grant.tenancy_id ?? "";
    return !tenancyId || !openTenancies.has(tenancyId);
  });
}
