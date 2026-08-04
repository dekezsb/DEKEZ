"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileSmartLockAccessForTenancy } from "@/lib/ttlock/access";
import { getTTLockConfigStatus, listTTLockDevices } from "@/lib/ttlock/client";

function onboardingKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function syncTTLockDevices() {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });

  if (!getTTLockConfigStatus().complete) {
    redirect("/smart-devices?error=credentials");
  }

  const admin = createAdminClient();

  let matched = 0;

  try {
    const [{ data: deviceRows, error: deviceError }, liveDevices] = await Promise.all([
      admin
        .from("smart_lock_devices")
        .select("id,onboarding_key")
        .eq("provider", "ttlock")
        .neq("sync_status", "retired"),
      listTTLockDevices(),
    ]);

    if (deviceError) throw deviceError;

    const liveByKey = new Map(
      liveDevices.flatMap((device) => {
        const keys = [device.lockAlias, device.lockName]
          .filter((name): name is string => Boolean(name))
          .map((name) => onboardingKey(name));
        return keys.map((key) => [key, device] as const);
      }),
    );
    for (const device of deviceRows ?? []) {
      const live = liveByKey.get(device.onboarding_key);
      if (!live) {
        const now = new Date().toISOString();
        await admin
          .from("smart_lock_devices")
          .update({
            sync_status: "error",
            last_sync_error: "Lock was not found in the connected TTLock account.",
            last_synced_at: now,
            updated_at: now,
          })
          .eq("id", device.id);
        continue;
      }

      const now = new Date().toISOString();
      const { error } = await admin
        .from("smart_lock_devices")
        .update({
          provider_lock_id: live.lockId,
          provider_lock_name: live.lockAlias || live.lockName || device.onboarding_key,
          provider_group_id: live.groupId ?? null,
          provider_group_name: live.groupName ?? null,
          battery_level: live.electricQuantity ?? null,
          has_gateway: live.hasGateway === undefined ? null : live.hasGateway === 1,
          sync_status: "connected",
          last_sync_error: null,
          last_synced_at: now,
          provider_data: {
            keyboardPasswordVersion: live.keyboardPwdVersion ?? null,
            specialValue: live.specialValue ?? null,
            source: "ttlock_installed_property_inventory",
            liveData: true,
          },
          updated_at: now,
        })
        .eq("id", device.id);

      if (error) throw error;
      matched += 1;
    }

    revalidatePath("/smart-devices");
  } catch (error) {
    console.error("TTLock device sync failed", error);
    redirect("/smart-devices?error=sync");
  }

  redirect(`/smart-devices?synced=${matched}`);
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
