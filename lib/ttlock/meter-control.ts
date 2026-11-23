import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  controlTTLockElectricMeterPower,
  getTTLockElectricMeterDetail,
  syncTTLockElectricMeterState,
} from "@/lib/ttlock/client";
import { meterConnectionStatus, meterPowerState } from "@/lib/ttlock/device-discovery";
import {
  malaysiaBillingMonth,
  malaysiaDateString,
  parseKwh,
  planMonthlyReading,
  providerTimestamp,
  shouldRestorePowerOnMoveIn,
  type MeterPowerReason,
} from "@/lib/ttlock/meter-rules";
import { resolveElectricityRmPerKwh } from "@/lib/smart-meter/top-up-access";
import { isMissingSchemaError } from "@/lib/ttlock/ekey-rules";

type MeterRow = {
  id: string;
  provider: string | null;
  provider_meter_id: string | null;
  property_id: string | null;
  room_id: string | null;
  tenancy_id: string | null;
  tenant_id: string | null;
  rate: number | string | null;
  status: string;
  power_state: string | null;
  power_control_reason: string | null;
  provider_metadata: Record<string, unknown> | null;
};

const BASE_METER_COLUMNS =
  "id,provider,provider_meter_id,property_id,room_id,tenancy_id,tenant_id,rate,status,power_state,provider_metadata";
const METER_COLUMNS = `${BASE_METER_COLUMNS},power_control_reason`;

/** Run a meter select, falling back to pre-migration columns if needed. */
async function selectMeters<T>(
  run: (columns: string) => PromiseLike<{ data: T | null; error: unknown }>,
) {
  const first = await run(METER_COLUMNS);
  if (!first.error || !isMissingSchemaError(first.error)) return first;
  return run(BASE_METER_COLUMNS);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.slice(0, 500) : fallback;
}

async function loadMeter(meterId: string) {
  const admin = createAdminClient();
  const { data, error } = await selectMeters((columns) =>
    admin.from("smart_meters").select(columns).eq("id", meterId).maybeSingle(),
  );
  if (error) throw error;
  if (!data) throw new Error("That meter was not found.");
  return { power_control_reason: null, ...(data as object) } as MeterRow;
}

async function recordMeterError(meterId: string, message: string) {
  await createAdminClient()
    .from("smart_meters")
    .update({ last_sync_error: message, updated_at: new Date().toISOString() })
    .eq("id", meterId);
}

function requireTTLockMeter(meter: MeterRow) {
  if (meter.provider !== "ttlock" || !meter.provider_meter_id) {
    throw new Error("Only a linked TTLock meter can be controlled.");
  }
  return meter.provider_meter_id;
}

async function recordMonthlyReading(meter: MeterRow, totalKwh: number, at: Date) {
  if (!meter.room_id) return;
  const admin = createAdminClient();
  const billingMonth = malaysiaBillingMonth(at);
  const [{ data: thisMonth, error: thisError }, { data: lastRows, error: lastError }] =
    await Promise.all([
      admin
        .from("smart_meter_readings")
        .select("id,previous_reading,current_reading")
        .eq("meter_id", meter.id)
        .eq("billing_month", billingMonth)
        .maybeSingle(),
      admin
        .from("smart_meter_readings")
        .select("current_reading")
        .eq("meter_id", meter.id)
        .lt("billing_month", billingMonth)
        .order("billing_month", { ascending: false })
        .limit(1),
    ]);
  if (thisError) throw thisError;
  if (lastError) throw lastError;
  const plan = planMonthlyReading({
    totalKwh,
    existingThisMonth: thisMonth
      ? {
          previous_reading: Number(thisMonth.previous_reading),
          current_reading: Number(thisMonth.current_reading),
        }
      : null,
    lastClosingReading: lastRows?.[0] ? Number(lastRows[0].current_reading) : null,
  });
  if (!plan.changed) return;
  const rate = resolveElectricityRmPerKwh(Number(meter.rate) || null);
  const now = new Date().toISOString();
  if (thisMonth) {
    const { error } = await admin
      .from("smart_meter_readings")
      .update({
        current_reading: plan.current_reading,
        reading_date: malaysiaDateString(at),
        updated_at: now,
      })
      .eq("id", thisMonth.id);
    if (error) throw error;
    return;
  }
  const { error } = await admin.from("smart_meter_readings").insert({
    meter_id: meter.id,
    room_id: meter.room_id,
    tenancy_id: meter.tenancy_id,
    tenant_id: meter.tenant_id,
    billing_month: billingMonth,
    previous_reading: plan.previous_reading,
    current_reading: plan.current_reading,
    rate,
    // Prepaid meters are paid through verified top-ups, so the reading is
    // usage information only and never a new charge.
    charge_amount: 0,
    reading_date: malaysiaDateString(at),
    updated_at: now,
  });
  if (error) throw error;
}

/**
 * Ask the meter to report (syncState), read its detail, store the live
 * balance, usage, connection and power state, and keep a monthly reading.
 */
export async function refreshTTLockMeter(meterId: string) {
  const meter = await loadMeter(meterId);
  const providerMeterId = requireTTLockMeter(meter);
  try {
    await syncTTLockElectricMeterState(providerMeterId).catch(() => undefined);
    const detail = await getTTLockElectricMeterDetail(providerMeterId);
    const now = new Date();
    const reportedAt = providerTimestamp(detail.syncKwhDate) ?? now;
    const remaining = parseKwh(detail.remainderKwh);
    const total = parseKwh(detail.totalKwh);
    const admin = createAdminClient();
    const { error } = await admin
      .from("smart_meters")
      .update({
        ...(remaining != null ? { remaining_units: remaining } : {}),
        ...(total != null ? { total_units: total } : {}),
        connection_status: meterConnectionStatus(detail.online),
        power_state: meterPowerState(detail.onOff),
        last_reported_at: reportedAt.toISOString(),
        last_synced_at: now.toISOString(),
        last_sync_error: null,
        provider_metadata: {
          ...(meter.provider_metadata ?? {}),
          payMode: detail.payMode ?? meter.provider_metadata?.payMode ?? null,
          price: detail.price ?? meter.provider_metadata?.price ?? null,
          name: detail.name ?? meter.provider_metadata?.name ?? null,
          number: detail.number ?? meter.provider_metadata?.number ?? null,
          maxPower: detail.maxPower ?? null,
          modelNum: detail.modelNum ?? null,
          firmwareRevision: detail.firmwareRevision ?? null,
          rssi: detail.rssi ?? null,
        },
        updated_at: now.toISOString(),
      })
      .eq("id", meter.id);
    if (error) throw error;
    if (total != null) await recordMonthlyReading(meter, total, reportedAt);
    return {
      remainingKwh: remaining,
      totalKwh: total,
      online: detail.online === 1,
      powerOn: detail.onOff === 1,
    };
  } catch (error) {
    const message = errorMessage(error, "TTLock meter refresh failed.");
    await recordMeterError(meter.id, message);
    throw new Error(message);
  }
}

/** Switch a TTLock meter relay on or off and record why. */
export async function setTTLockMeterPower(input: {
  meterId: string;
  on: boolean;
  reason: MeterPowerReason;
  performedBy?: string | null;
}) {
  const meter = await loadMeter(input.meterId);
  const providerMeterId = requireTTLockMeter(meter);
  try {
    await controlTTLockElectricMeterPower({ electricMeterId: providerMeterId, on: input.on });
  } catch (error) {
    const message = errorMessage(error, "TTLock meter power command failed.");
    await recordMeterError(meter.id, `Power ${input.on ? "on" : "off"} failed: ${message}`);
    throw new Error(message);
  }
  const now = new Date().toISOString();
  const admin = createAdminClient();
  const base = { power_state: input.on ? "on" : "off", last_sync_error: null, updated_at: now };
  const { error } = await admin
    .from("smart_meters")
    .update({
      ...base,
      power_control_reason: input.on ? null : input.reason,
      power_controlled_at: now,
      power_controlled_by: input.performedBy ?? null,
    })
    .eq("id", meter.id);
  if (error) {
    if (!isMissingSchemaError(error)) throw error;
    const { error: retryError } = await admin.from("smart_meters").update(base).eq("id", meter.id);
    if (retryError) throw retryError;
  }
}

async function roomTTLockMeters(roomId: string) {
  const admin = createAdminClient();
  const { data, error } = await selectMeters((columns) =>
    admin
      .from("smart_meters")
      .select(columns)
      .eq("room_id", roomId)
      .eq("provider", "ttlock")
      .eq("meter_type", "electricity")
      .eq("status", "active")
      .not("provider_meter_id", "is", null),
  );
  if (error) throw error;
  return ((data ?? []) as object[]).map(
    (row) => ({ power_control_reason: null, ...row }) as MeterRow,
  );
}

/**
 * After checkout: cut the room's TTLock meter so leftover credit is not used
 * by anyone else, and detach the old tenancy. Never blocks checkout; returns
 * errors for staff to see and leaves them on the meter row.
 */
export async function cutRoomMeterPowerAfterCheckout(input: {
  roomId: string;
  tenancyId: string;
  performedBy?: string | null;
}) {
  const errors: string[] = [];
  let meters: MeterRow[] = [];
  try {
    meters = await roomTTLockMeters(input.roomId);
  } catch (error) {
    return { switchedOff: 0, errors: [errorMessage(error, "Meter lookup failed.")] };
  }
  let switchedOff = 0;
  for (const meter of meters) {
    try {
      await setTTLockMeterPower({
        meterId: meter.id,
        on: false,
        reason: "checkout",
        performedBy: input.performedBy,
      });
      switchedOff += 1;
    } catch (error) {
      errors.push(errorMessage(error, "Meter power off failed."));
    }
    if (meter.tenancy_id === input.tenancyId) {
      await createAdminClient()
        .from("smart_meters")
        .update({ tenancy_id: null, tenant_id: null, updated_at: new Date().toISOString() })
        .eq("id", meter.id)
        .eq("tenancy_id", input.tenancyId);
    }
  }
  return { switchedOff, errors };
}

/**
 * On move-in / activation: link the room meter to the tenancy and restore
 * power that DEKEZ cut at the previous checkout. A meter staff switched off
 * by hand stays off.
 */
export async function prepareRoomMeterForTenancy(tenancyId: string) {
  const admin = createAdminClient();
  const { data: tenancy, error } = await admin
    .from("tenancies")
    .select("id,room_id,tenant_id,status,checkout_date")
    .eq("id", tenancyId)
    .maybeSingle();
  if (error) throw error;
  if (!tenancy || tenancy.status !== "active" || tenancy.checkout_date || !tenancy.room_id) {
    return { linked: 0, restored: 0, errors: [] as string[] };
  }
  const meters = await roomTTLockMeters(tenancy.room_id);
  const errors: string[] = [];
  let linked = 0;
  let restored = 0;
  for (const meter of meters) {
    if (meter.tenancy_id !== tenancy.id) {
      const { error: linkError } = await admin
        .from("smart_meters")
        .update({
          tenancy_id: tenancy.id,
          tenant_id: tenancy.tenant_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", meter.id);
      if (linkError) errors.push(linkError.message);
      else linked += 1;
    }
    if (shouldRestorePowerOnMoveIn(meter)) {
      try {
        await setTTLockMeterPower({ meterId: meter.id, on: true, reason: "move_in" });
        restored += 1;
      } catch (powerError) {
        errors.push(errorMessage(powerError, "Meter power on failed."));
      }
    }
  }
  return { linked, restored, errors };
}
