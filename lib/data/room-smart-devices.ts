import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  compareRoomLocks,
  locksForRoom,
  numberOrNull,
  summarizeActiveCodes,
  topUpSource,
  type RoomSmartDevices,
  type RoomSmartLockView,
} from "@/lib/data/room-smart-devices-view";

export type { RoomSmartDevices, RoomSmartLockView, RoomSmartMeterView, RoomMeterTopUp } from "@/lib/data/room-smart-devices-view";
export { compareRoomLocks, locksForRoom, summarizeActiveCodes, topUpSource };

type DataClient = ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>>;

async function getDataClient(): Promise<DataClient> {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

const GRANT_COLUMNS = "id,device_id,credential_state,valid_until";

export async function getRoomSmartDevices(
  propertyId: string,
  roomId: string,
): Promise<RoomSmartDevices> {
  const supabase = await getDataClient();
  const [metersResult, locksResult] = await Promise.all([
    supabase
      .from("smart_meters")
      .select(
        "id,provider,meter_number,meter_type,unit_label,remaining_units,remaining_credit,total_units,connection_status,power_state,last_synced_at,last_reported_at,last_sync_error,status",
      )
      .eq("room_id", roomId)
      .order("meter_type", { ascending: true }),
    supabase
      .from("smart_lock_devices")
      .select(
        "id,provider_lock_name,access_scope,room_id,battery_level,has_gateway,sync_status,last_synced_at",
      )
      .eq("property_id", propertyId)
      .eq("provider", "ttlock"),
  ]);

  if (metersResult.error) {
    throw new Error(`Failed to load room meters: ${metersResult.error.message}`);
  }
  if (locksResult.error) {
    throw new Error(`Failed to load room locks: ${locksResult.error.message}`);
  }

  const meters = metersResult.data ?? [];
  const locks = locksForRoom(locksResult.data ?? [], roomId);
  const meterIds = meters.map((meter) => meter.id);
  const lockIds = locks.map((lock) => lock.id);

  const [readingsResult, topUpsResult, grantsResult] = await Promise.all([
    meterIds.length
      ? supabase
          .from("smart_meter_readings")
          .select(
            "id,meter_id,billing_month,previous_reading,current_reading,usage,rate,charge_amount,top_up_amount,remaining_credit,reading_date",
          )
          .in("meter_id", meterIds)
          .order("reading_date", { ascending: false })
      : Promise.resolve({ data: [] as Array<Record<string, never>>, error: null }),
    supabase
      .from("smart_meter_top_up_requests")
      .select(
        "id,meter_id,room_id,amount,status,payment_date,verified_at,credited_at,credit_before,credit_after,provider_reference",
      )
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(20),
    lockIds.length
      ? supabase
          .from("smart_lock_access_grants")
          .select(GRANT_COLUMNS)
          .in("device_id", lockIds)
          .eq("credential_state", "active")
      : Promise.resolve({ data: [] as Array<{ id: string; device_id: string; credential_state: string; valid_until: string | null }>, error: null }),
  ]);

  if (readingsResult.error) {
    throw new Error(`Failed to load meter readings: ${readingsResult.error.message}`);
  }
  if (topUpsResult.error) {
    throw new Error(`Failed to load meter top-ups: ${topUpsResult.error.message}`);
  }
  if (grantsResult.error) {
    throw new Error(`Failed to load lock access: ${grantsResult.error.message}`);
  }

  const readings = readingsResult.data ?? [];
  const topUps = topUpsResult.data ?? [];
  const grants = grantsResult.data ?? [];

  return {
    meters: meters.map((meter) => ({
      id: meter.id,
      provider: meter.provider,
      meterNumber: meter.meter_number,
      meterType: meter.meter_type,
      unitLabel: meter.unit_label ?? "kWh",
      remainingUnits: numberOrNull(meter.remaining_units),
      remainingCredit: numberOrNull(meter.remaining_credit),
      totalUnits: numberOrNull(meter.total_units),
      connectionStatus: meter.connection_status,
      powerState: meter.power_state,
      lastSyncedAt: meter.last_synced_at,
      lastReportedAt: meter.last_reported_at,
      lastSyncError: meter.last_sync_error,
      status: meter.status,
      readings: readings
        .filter((reading) => reading.meter_id === meter.id)
        .map((reading) => ({
          id: reading.id,
          billingMonth: reading.billing_month,
          readingDate: reading.reading_date,
          previousReading: numberOrNull(reading.previous_reading),
          currentReading: numberOrNull(reading.current_reading),
          usage: numberOrNull(reading.usage),
          rate: numberOrNull(reading.rate),
          chargeAmount: numberOrNull(reading.charge_amount),
          topUpAmount: numberOrNull(reading.top_up_amount),
          remainingCredit: numberOrNull(reading.remaining_credit),
        })),
      topUps: topUps
        .filter((row) => !row.meter_id || row.meter_id === meter.id)
        .map((row) => ({
          id: row.id,
          amount: numberOrNull(row.amount) ?? 0,
          status: row.status,
          paymentDate: row.payment_date,
          verifiedAt: row.verified_at,
          creditedAt: row.credited_at,
          creditBefore: numberOrNull(row.credit_before),
          creditAfter: numberOrNull(row.credit_after),
          providerReference: row.provider_reference,
          source: topUpSource(row),
        })),
    })),
    locks: locks
      .map((lock) => {
        const access = summarizeActiveCodes(grants, lock.id);
        return {
          id: lock.id,
          name: lock.provider_lock_name ?? (lock.access_scope === "property_entry" ? "Main entrance" : "Room lock"),
          accessScope: lock.access_scope as RoomSmartLockView["accessScope"],
          batteryLevel: lock.battery_level,
          hasGateway: lock.has_gateway,
          syncStatus: lock.sync_status,
          lastSyncedAt: lock.last_synced_at,
          activeCodeCount: access.activeCodeCount,
          validUntil: access.validUntil,
        };
      })
      .sort(compareRoomLocks),
  };
}
