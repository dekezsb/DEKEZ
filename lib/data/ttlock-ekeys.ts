import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchemaError } from "@/lib/ttlock/ekey-rules";

type Relation<T> = T | T[] | null | undefined;

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export type EKeyGrantView = {
  id: string;
  tenancyId: string;
  deviceId: string;
  lockName: string;
  accessScope: "property_entry" | "room_entry";
  receiverUsername: string;
  state: string;
  validFrom: string;
  validUntil: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  propertyCode: string | null;
  roomNumber: string | null;
  tenantName: string | null;
};

type GrantRow = {
  id: string;
  tenancy_id: string;
  device_id: string;
  access_scope: "property_entry" | "room_entry";
  receiver_username: string;
  credential_state: string;
  valid_from: string;
  valid_until: string;
  last_error: string | null;
  last_provider_sync_at: string | null;
  updated_at: string;
  smart_lock_devices: Relation<{ provider_lock_name: string | null }>;
  properties: Relation<{ property_code: string | null }>;
  rooms: Relation<{ room_number: string | null }>;
  tenancies: Relation<{ tenants: Relation<{ full_name: string | null }> }>;
};

function toView(row: GrantRow): EKeyGrantView {
  return {
    id: row.id,
    tenancyId: row.tenancy_id,
    deviceId: row.device_id,
    lockName: one(row.smart_lock_devices)?.provider_lock_name ?? "TTLock",
    accessScope: row.access_scope,
    receiverUsername: row.receiver_username,
    state: row.credential_state,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    lastError: row.last_error,
    lastSyncedAt: row.last_provider_sync_at,
    propertyCode: one(row.properties)?.property_code ?? null,
    roomNumber: one(row.rooms)?.room_number ?? null,
    tenantName: one(one(row.tenancies)?.tenants)?.full_name ?? null,
  };
}

const COLUMNS =
  "id,tenancy_id,device_id,access_scope,receiver_username,credential_state,valid_from,valid_until,last_error,last_provider_sync_at,updated_at,smart_lock_devices(provider_lock_name),properties(property_code),rooms(room_number),tenancies(tenants(full_name))";

/** eKeys that are open or failed, for staff lists. Empty before migration. */
export async function listEKeyGrants(filter?: { tenancyId?: string }) {
  const admin = createAdminClient();
  let query = admin
    .from("smart_lock_ekey_grants")
    .select(COLUMNS)
    .in("credential_state", ["pending_send", "active", "frozen", "revoke_pending", "error"])
    .order("updated_at", { ascending: false })
    .limit(300);
  if (filter?.tenancyId) query = query.eq("tenancy_id", filter.tenancyId);
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return { grants: [] as EKeyGrantView[], migrationPending: true };
    throw new Error(`Failed to load eKeys: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as GrantRow[];
  // Keep only the newest failed attempt per lock+tenancy, and drop failures
  // that a later open eKey replaced.
  const open = new Set(
    rows.filter((row) => row.credential_state !== "error").map((row) => `${row.device_id}:${row.tenancy_id}`),
  );
  const seenErrors = new Set<string>();
  const filtered = rows.filter((row) => {
    if (row.credential_state !== "error") return true;
    const key = `${row.device_id}:${row.tenancy_id}`;
    if (open.has(key) || seenErrors.has(key)) return false;
    seenErrors.add(key);
    return true;
  });
  return { grants: filtered.map(toView), migrationPending: false };
}

export type RoomTTLockContext = {
  tenancyId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  ttlockUsername: string | null;
  migrationPending: boolean;
  grants: EKeyGrantView[];
  meters: Array<{
    id: string;
    name: string;
    providerMeterId: string | null;
    powerState: string | null;
    powerControlReason: string | null;
    connectionStatus: string | null;
    lastSyncError: string | null;
  }>;
};

/** Active tenancy, TTLock account, eKeys and TTLock meters for one room. */
export async function getRoomTTLockContext(roomId: string): Promise<RoomTTLockContext> {
  const admin = createAdminClient();
  const tenancyQuery = (columns: string) =>
    admin
      .from("tenancies")
      .select(columns)
      .eq("room_id", roomId)
      .eq("status", "active")
      .is("checkout_date", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  let migrationPending = false;
  let tenancyResult = await tenancyQuery("id,tenants(id,full_name,ttlock_username)");
  if (tenancyResult.error && isMissingSchemaError(tenancyResult.error)) {
    migrationPending = true;
    tenancyResult = await tenancyQuery("id,tenants(id,full_name)");
  }
  if (tenancyResult.error) throw new Error(`Failed to load tenancy: ${tenancyResult.error.message}`);
  const tenancy = tenancyResult.data as unknown as {
    id: string;
    tenants: Relation<{ id: string; full_name: string; ttlock_username?: string | null }>;
  } | null;
  const tenant = one(tenancy?.tenants);

  const meterQuery = (columns: string) =>
    admin
      .from("smart_meters")
      .select(columns)
      .eq("room_id", roomId)
      .eq("provider", "ttlock")
      .eq("status", "active");
  let meterResult = await meterQuery(
    "id,meter_number,provider_meter_id,power_state,power_control_reason,connection_status,last_sync_error,provider_metadata",
  );
  if (meterResult.error && isMissingSchemaError(meterResult.error)) {
    meterResult = await meterQuery(
      "id,meter_number,provider_meter_id,power_state,connection_status,last_sync_error,provider_metadata",
    );
  }
  if (meterResult.error) throw new Error(`Failed to load meters: ${meterResult.error.message}`);

  const grants = tenancy
    ? await listEKeyGrants({ tenancyId: tenancy.id })
    : { grants: [], migrationPending: false };

  return {
    tenancyId: tenancy?.id ?? null,
    tenantId: tenant?.id ?? null,
    tenantName: tenant?.full_name ?? null,
    ttlockUsername: tenant?.ttlock_username ?? null,
    migrationPending: migrationPending || grants.migrationPending,
    grants: grants.grants,
    meters: ((meterResult.data ?? []) as unknown as Array<{
      id: string;
      meter_number: string;
      provider_meter_id: string | null;
      power_state: string | null;
      power_control_reason?: string | null;
      connection_status: string | null;
      last_sync_error: string | null;
      provider_metadata: { name?: string | null } | null;
    }>).map((meter) => ({
      id: meter.id,
      name: meter.provider_metadata?.name || meter.meter_number,
      providerMeterId: meter.provider_meter_id,
      powerState: meter.power_state,
      powerControlReason: meter.power_control_reason ?? null,
      connectionStatus: meter.connection_status,
      lastSyncError: meter.last_sync_error,
    })),
  };
}
