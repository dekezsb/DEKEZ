"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTTLockConfigStatus, listTTLockDevices } from "@/lib/ttlock/client";

function onboardingKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function syncTTLockTrialDevices() {
  await requireRole(["super_admin"], { module: "properties", level: "manage" });

  if (!getTTLockConfigStatus().complete) {
    redirect("/smart-devices?error=credentials");
  }

  const admin = createAdminClient();

  let matched = 0;

  try {
    const [{ data: trialRows, error: trialError }, liveDevices] = await Promise.all([
      admin
        .from("smart_lock_devices")
        .select("id,onboarding_key")
        .eq("provider", "ttlock")
        .neq("sync_status", "retired"),
      listTTLockDevices(),
    ]);

    if (trialError) throw trialError;

    const liveByKey = new Map(
      liveDevices.flatMap((device) => {
        const keys = [device.lockAlias, device.lockName]
          .filter((name): name is string => Boolean(name))
          .map((name) => onboardingKey(name));
        return keys.map((key) => [key, device] as const);
      }),
    );
    for (const trial of trialRows ?? []) {
      const live = liveByKey.get(trial.onboarding_key);
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
          .eq("id", trial.id);
        continue;
      }

      const now = new Date().toISOString();
      const { error } = await admin
        .from("smart_lock_devices")
        .update({
          provider_lock_id: live.lockId,
          provider_lock_name: live.lockAlias || live.lockName || trial.onboarding_key,
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
            liveData: true,
          },
          updated_at: now,
        })
        .eq("id", trial.id);

      if (error) throw error;
      matched += 1;
    }

    revalidatePath("/smart-devices");
  } catch (error) {
    console.error("TTLock trial sync failed", error);
    redirect("/smart-devices?error=sync");
  }

  redirect(`/smart-devices?synced=${matched}`);
}
