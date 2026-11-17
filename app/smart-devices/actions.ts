"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileSmartLockAccessForTenancy } from "@/lib/ttlock/access";
import { getTTLockConfigStatus, listTTLockDevices, listTTLockElectricMeters } from "@/lib/ttlock/client";
import {
  meterConnectionStatus,
  meterPowerState,
  numberValue,
  planTTLockLockSync,
  planTTLockMeterSync,
  validateAssignment,
} from "@/lib/ttlock/device-discovery";
import {
  prepareFingerprintEnrollment,
  syncFingerprintEnrollments,
} from "@/lib/ttlock/fingerprint";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function lockPayload(live: {
  lockId: number;
  lockAlias?: string | null;
  lockName?: string | null;
  electricQuantity?: number | null;
  hasGateway?: number | null;
  groupId?: number | null;
  groupName?: string | null;
  keyboardPwdVersion?: number | null;
  specialValue?: number | null;
}, onboardingKey: string) {
  const now = new Date().toISOString();
  return {
    provider_lock_id: live.lockId,
    provider_lock_name: live.lockAlias || live.lockName || onboardingKey,
    provider_group_id: live.groupId ?? null,
    provider_group_name: live.groupName ?? null,
    battery_level: live.electricQuantity ?? null,
    has_gateway: live.hasGateway === undefined ? null : live.hasGateway === 1,
    sync_status: "connected" as const,
    last_sync_error: null,
    last_synced_at: now,
    snapshot_captured_at: now,
    provider_data: {
      keyboardPasswordVersion: live.keyboardPwdVersion ?? null,
      specialValue: live.specialValue ?? null,
      source: "ttlock_account_inventory",
      liveData: true,
    },
    updated_at: now,
  };
}

function meterPayload(live: {
  electricMeterId: number | string;
  name?: string | null;
  number?: string | null;
  online?: number | null;
  onOff?: number | null;
  payMode?: number | null;
  totalKwh?: string | number | null;
  remainderKwh?: string | number | null;
  price?: string | number | null;
}) {
  const now = new Date().toISOString();
  return {
    meter_number: String(live.number || live.name || `TTLock ${live.electricMeterId}`),
    meter_type: "electricity" as const,
    provider: "ttlock" as const,
    provider_meter_id: String(live.electricMeterId),
    remaining_units: numberValue(live.remainderKwh),
    total_units: numberValue(live.totalKwh),
    unit_label: "kWh",
    connection_status: meterConnectionStatus(live.online),
    power_state: meterPowerState(live.onOff),
    last_reported_at: now,
    last_synced_at: now,
    last_sync_error: null,
    provider_metadata: {
      payMode: live.payMode ?? null,
      price: live.price ?? null,
      name: live.name ?? null,
      number: live.number ?? null,
      source: "ttlock_account_inventory",
    },
    updated_at: now,
  };
}

export async function syncTTLockDevices() {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });

  if (!getTTLockConfigStatus().complete) {
    redirect("/smart-devices?error=credentials");
  }

  const admin = createAdminClient();
  let matched = 0;
  let discovered = 0;
  let metersSynced = 0;
  let metersDiscovered = 0;

  try {
    const [
      { data: deviceRows, error: deviceError },
      { data: meterRows, error: meterError },
      { data: companies, error: companyError },
      liveDevices,
      liveMeters,
    ] = await Promise.all([
      admin
        .from("smart_lock_devices")
        .select("id,company_id,onboarding_key,provider_lock_id,sync_status")
        .eq("provider", "ttlock"),
      admin
        .from("smart_meters")
        .select("id,provider,provider_meter_id,meter_number,status")
        .eq("provider", "ttlock"),
      admin.from("companies").select("id").order("created_at", { ascending: true }).limit(1),
      listTTLockDevices(),
      listTTLockElectricMeters().catch((error) => {
        console.error("TTLock electric meter list failed", error);
        return [] as Awaited<ReturnType<typeof listTTLockElectricMeters>>;
      }),
    ]);

    if (deviceError) throw deviceError;
    if (meterError) throw meterError;
    if (companyError) throw companyError;

    const lockPlan = planTTLockLockSync({
      existing: deviceRows ?? [],
      live: liveDevices,
    });
    const companyId =
      (deviceRows ?? []).find((device) => device.company_id)?.company_id
      ?? companies?.[0]?.id
      ?? null;

    for (const update of lockPlan.updates) {
      const { error } = await admin
        .from("smart_lock_devices")
        .update(lockPayload(update.live, update.existing.onboarding_key))
        .eq("id", update.existing.id);
      if (error) throw error;
      matched += 1;
    }

    for (const missing of lockPlan.missing) {
      const now = new Date().toISOString();
      const { error } = await admin
        .from("smart_lock_devices")
        .update({
          sync_status: "error",
          last_sync_error: "Lock was not found in the connected TTLock account.",
          last_synced_at: now,
          updated_at: now,
        })
        .eq("id", missing.id);
      if (error) throw error;
    }

    if (lockPlan.inserts.length && !companyId) {
      throw new Error("A company is required before new TTLock locks can be stored.");
    }
    for (const insert of lockPlan.inserts) {
      const { error } = await admin.from("smart_lock_devices").insert({
        company_id: companyId,
        property_id: null,
        room_id: null,
        provider: "ttlock",
        onboarding_key: insert.onboarding_key,
        access_scope: "room_entry",
        ...lockPayload(
          {
            lockId: insert.provider_lock_id,
            lockAlias: insert.provider_lock_name,
            electricQuantity: insert.battery_level ?? undefined,
            hasGateway: insert.has_gateway === null ? undefined : insert.has_gateway ? 1 : 0,
            groupId: insert.provider_group_id ?? undefined,
            groupName: insert.provider_group_name ?? undefined,
          },
          insert.onboarding_key,
        ),
      });
      if (error) throw error;
      discovered += 1;
    }

    const meterPlan = planTTLockMeterSync({
      existing: meterRows ?? [],
      live: liveMeters,
    });
    for (const update of meterPlan.updates) {
      const { error } = await admin
        .from("smart_meters")
        .update(meterPayload(update.live))
        .eq("id", update.existing.id);
      if (error) throw error;
      metersSynced += 1;
    }
    for (const live of meterPlan.inserts) {
      const { error } = await admin.from("smart_meters").insert({
        property_id: null,
        room_id: null,
        status: "active",
        rate: 0,
        remaining_credit: 0,
        ...meterPayload(live),
      });
      if (error) throw error;
      metersDiscovered += 1;
    }

    revalidatePath("/smart-devices");
  } catch (error) {
    console.error("TTLock device sync failed", error);
    redirect("/smart-devices?error=sync");
  }

  redirect(
    `/smart-devices?synced=${matched}&discovered=${discovered}&metersSynced=${metersSynced}&metersDiscovered=${metersDiscovered}`,
  );
}

async function loadAssignmentOptions() {
  const admin = createAdminClient();
  const [{ data: properties, error: propertyError }, { data: rooms, error: roomError }] =
    await Promise.all([
      admin.from("properties").select("id,name,property_code").order("name"),
      admin.from("rooms").select("id,property_id,name,room_number").order("room_number"),
    ]);
  if (propertyError) throw propertyError;
  if (roomError) throw roomError;
  return {
    properties: properties ?? [],
    rooms: rooms ?? [],
  };
}

export async function assignTTLockDevice(formData: FormData) {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });
  const deviceId = textValue(formData, "deviceId");
  const propertyId = textValue(formData, "propertyId");
  const accessScope = textValue(formData, "accessScope") === "property_entry"
    ? "property_entry" as const
    : "room_entry" as const;
  const roomId = accessScope === "property_entry" ? "" : textValue(formData, "roomId");
  if (!deviceId) redirect("/smart-devices?error=assign");

  try {
    const options = await loadAssignmentOptions();
    const result = validateAssignment({
      propertyId,
      roomId,
      accessScope,
      properties: options.properties,
      rooms: options.rooms,
    });
    if (!result.ok) redirect(`/smart-devices?error=assign`);
    const admin = createAdminClient();
    const { error } = await admin
      .from("smart_lock_devices")
      .update({
        property_id: result.property.id,
        room_id: result.room?.id ?? null,
        access_scope: accessScope,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deviceId);
    if (error) throw error;
  } catch (error) {
    console.error("TTLock lock assignment failed", error);
    redirect("/smart-devices?error=assign");
  }

  revalidatePath("/smart-devices");
  redirect("/smart-devices?assigned=lock");
}

export async function assignTTLockMeter(formData: FormData) {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });
  const meterId = textValue(formData, "deviceId");
  const propertyId = textValue(formData, "propertyId");
  const roomId = textValue(formData, "roomId");
  if (!meterId) redirect("/smart-devices?error=assign");

  try {
    const options = await loadAssignmentOptions();
    const result = validateAssignment({
      propertyId,
      roomId,
      accessScope: "room_entry",
      properties: options.properties,
      rooms: options.rooms,
      requireRoom: true,
    });
    if (!result.ok || !result.room) redirect("/smart-devices?error=assign");
    const admin = createAdminClient();
    const { error } = await admin
      .from("smart_meters")
      .update({
        property_id: result.property.id,
        room_id: result.room.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", meterId);
    if (error) throw error;
  } catch (error) {
    console.error("TTLock meter assignment failed", error);
    redirect("/smart-devices?error=assign");
  }

  revalidatePath("/smart-devices");
  redirect("/smart-devices?assigned=meter");
}

export async function provisionTTLockAccess() {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });

  if (!getTTLockConfigStatus().complete) {
    redirect("/smart-devices?error=credentials");
  }

  const admin = createAdminClient();
  const { data: roomDevices, error: deviceError } = await admin
    .from("smart_lock_devices")
    .select("room_id")
    .eq("provider", "ttlock")
    .eq("access_scope", "room_entry")
    .eq("sync_status", "connected")
    .not("room_id", "is", null);

  if (deviceError) redirect("/smart-devices?error=access");
  const roomIds = [
    ...new Set(
      (roomDevices ?? [])
        .map((device) => device.room_id)
        .filter((roomId): roomId is string => Boolean(roomId)),
    ),
  ];
  if (!roomIds.length) redirect("/smart-devices?error=access");

  const { data: tenancies, error: tenancyError } = await admin
    .from("tenancies")
    .select("id")
    .in("room_id", roomIds)
    .eq("status", "active")
    .is("checkout_date", null);
  if (tenancyError) redirect("/smart-devices?error=access");

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;
  for (const tenancy of tenancies ?? []) {
    try {
      const result = await reconcileSmartLockAccessForTenancy(tenancy.id);
      created += result.created;
      updated += result.updated;
      unchanged += result.unchanged;
      skipped += result.skipped;
      errors += result.errors.length;
    } catch (error) {
      console.error("TTLock tenant access provisioning failed", {
        tenancyId: tenancy.id,
        error,
      });
      errors += 1;
    }
  }

  revalidatePath("/smart-devices");
  revalidatePath("/dashboard");
  redirect(
    `/smart-devices?accessCreated=${created}&accessUpdated=${updated}&accessUnchanged=${unchanged}&accessSkipped=${skipped}&accessErrors=${errors}`,
  );
}

export async function sendFingerprintEnrollmentInvite(formData: FormData) {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });
  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");

  if (!user || !tenancyId) {
    redirect("/smart-devices?fingerprintError=missing");
  }
  if (!getTTLockConfigStatus().complete) {
    redirect("/smart-devices?fingerprintError=credentials");
  }

  let result;
  try {
    result = await prepareFingerprintEnrollment(tenancyId, user.id);
  } catch (error) {
    console.error("Fingerprint enrollment invitation failed", { tenancyId, error });
    const message = error instanceof Error ? error.message : "Fingerprint enrollment could not be prepared.";
    redirect(`/smart-devices?fingerprintError=${encodeURIComponent(message)}`);
  }
  revalidatePath("/smart-devices");
  redirect(
    result.invitationSent
      ? `/smart-devices?fingerprintInvited=${encodeURIComponent(result.tenantName)}&fingerprintCode=${result.enrollmentCode}`
      : `/smart-devices?fingerprintExisting=${encodeURIComponent(result.tenantName)}`,
  );
}

export async function syncTTLockFingerprintEnrollments() {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });

  if (!getTTLockConfigStatus().complete) {
    redirect("/smart-devices?fingerprintError=credentials");
  }

  let result;
  try {
    result = await syncFingerprintEnrollments();
  } catch (error) {
    console.error("Fingerprint enrollment sync failed", error);
    redirect("/smart-devices?fingerprintError=sync");
  }
  revalidatePath("/smart-devices");
  redirect(
    `/smart-devices?fingerprintMatched=${result.matched}&fingerprintSkipped=${result.skipped}&fingerprintErrors=${result.errors.length}`,
  );
}
