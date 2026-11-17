import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  TTLOCK_ELECTRICITY_RATE_ENV,
  canAutoRechargeTTLockMeter,
  readRmPerKwh,
  ttlockRechargeReference,
} from "@/lib/ttlock/device-discovery";
import {
  rechargeTTLockElectricMeter,
  syncTTLockElectricMeterState,
} from "@/lib/ttlock/client";

export function configuredRmPerKwh() {
  return readRmPerKwh(process.env[TTLOCK_ELECTRICITY_RATE_ENV]);
}

type MeterRow = {
  id: string;
  provider: string | null;
  provider_meter_id: string | null;
  room_id: string | null;
  provider_metadata?: { payMode?: number | string | null } | null;
};

function payModeOf(meter: MeterRow) {
  return meter.provider_metadata?.payMode ?? null;
}

async function loadMappedMeter(admin: ReturnType<typeof createAdminClient>, input: {
  meterId?: string | null;
  roomId?: string | null;
}) {
  if (input.meterId) {
    const { data } = await admin
      .from("smart_meters")
      .select("id,provider,provider_meter_id,room_id,provider_metadata")
      .eq("id", input.meterId)
      .eq("status", "active")
      .maybeSingle();
    if (data) return data as MeterRow;
  }
  if (!input.roomId) return null;
  const { data } = await admin
    .from("smart_meters")
    .select("id,provider,provider_meter_id,room_id,provider_metadata")
    .eq("room_id", input.roomId)
    .eq("provider", "ttlock")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as MeterRow | null;
}

/**
 * After a staff-verified electricity slip, top up a mapped TTLock meter when
 * TTLOCK_ELECTRICITY_RM_PER_KWH is set. Failures leave the request in the
 * manual queue. Never retries older approved-but-uncredited slips.
 */
export async function tryAutoRechargeTTLockTopUp(input: {
  requestId: string;
  performedBy: string;
}) {
  const admin = createAdminClient();
  const { data: request, error } = await admin
    .from("smart_meter_top_up_requests")
    .select("id,status,amount,room_id,meter_id,provider_reference")
    .eq("id", input.requestId)
    .maybeSingle();
  if (error) throw error;
  if (!request || request.status !== "approved_awaiting_top_up") {
    return { attempted: false, credited: false, reason: "not_awaiting" };
  }
  if (request.provider_reference) {
    return { attempted: false, credited: false, reason: "already_referenced" };
  }

  const meter = await loadMappedMeter(admin, {
    meterId: request.meter_id,
    roomId: request.room_id,
  });
  const eligibility = canAutoRechargeTTLockMeter({
    provider: meter?.provider,
    providerMeterId: meter?.provider_meter_id,
    roomId: meter?.room_id,
    payMode: meter ? payModeOf(meter) : null,
    rmPerKwh: configuredRmPerKwh(),
    amount: Number(request.amount),
  });
  if (!eligibility.ok || !meter?.provider_meter_id) {
    return { attempted: false, credited: false, reason: eligibility.ok ? "unassigned" : eligibility.reason };
  }

  try {
    await rechargeTTLockElectricMeter({
      electricMeterId: meter.provider_meter_id,
      rechargeAmount: Number(request.amount),
      rechargeKwh: eligibility.kwh,
    });
    await syncTTLockElectricMeterState(meter.provider_meter_id).catch(() => undefined);

    const reference = ttlockRechargeReference(request.id);
    const { error: markError } = await admin
      .from("smart_meter_top_up_requests")
      .update({
        provider_reference: reference,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("status", "approved_awaiting_top_up")
      .is("provider_reference", null);
    if (markError) throw markError;

    const { data: creditResult, error: creditError } = await admin.rpc(
      "confirm_smart_meter_top_up_credit",
      {
        request_id: request.id,
        reviewer_id: input.performedBy,
        external_reference: reference,
      },
    );
    if (creditError) {
      return { attempted: true, credited: false, reason: "credit_rpc", reference };
    }
    return { attempted: true, credited: true, reason: "credited", creditResult, reference };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "TTLock recharge failed.";
    await admin
      .from("smart_meters")
      .update({ last_sync_error: message, updated_at: new Date().toISOString() })
      .eq("id", meter.id);
    return { attempted: true, credited: false, reason: "provider", error: message };
  }
}
