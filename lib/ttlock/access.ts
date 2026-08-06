import "server-only";

import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addTTLockPasscode,
  changeTTLockPasscode,
  deleteTTLockPasscode,
} from "@/lib/ttlock/client";

type Relation<T> = T | T[] | null;

type AccessSyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
};

type TenancyAccessRow = {
  id: string;
  company_id: string;
  property_id: string;
  room_id: string;
  check_in_date: string | null;
  tenancy_start_date: string | null;
  contract_start: string | null;
  start_date: string | null;
  tenancy_end_date: string | null;
  contract_end: string | null;
  end_date: string | null;
  checkout_date: string | null;
  status: string;
  billing_status: string | null;
  rental_model: "tenancy" | "monthly_stay";
  tenants: Relation<{
    profile_id: string | null;
    full_name: string;
  }>;
};

type SmartLockRow = {
  id: string;
  provider_lock_id: number | string | null;
  provider_lock_name: string;
  access_scope: "property_entry" | "room_entry";
  room_id: string | null;
  has_gateway: boolean | null;
  provider_data: Record<string, unknown> | null;
};

type ExistingGrant = {
  id: string;
  provider_keyboard_pwd_id: number | string | null;
  keyboard_password: string | null;
  passcode_name: string | null;
  credential_state: string;
  valid_from: string;
  valid_until: string;
};

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function providerError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "TTLock request failed.";
}

function malaysiaStart(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function malaysiaEnd(date: string) {
  return new Date(`${date}T23:59:59+08:00`);
}

function sameMinute(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) < 60_000;
}

function randomPasscode() {
  return String(randomInt(100_000, 1_000_000));
}

function passcodeName(tenantName: string, scope: SmartLockRow["access_scope"]) {
  const label = scope === "property_entry" ? "MAIN" : "ROOM";
  return `DEKEZ ${tenantName} ${label}`.slice(0, 50);
}

async function loadTenancy(tenancyId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenancies")
    .select(
      "id,company_id,property_id,room_id,check_in_date,tenancy_start_date,contract_start,start_date,tenancy_end_date,contract_end,end_date,checkout_date,status,billing_status,rental_model,tenants(profile_id,full_name)",
    )
    .eq("id", tenancyId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as TenancyAccessRow | null;
}

async function loadTenancyDevices(tenancy: TenancyAccessRow) {
  const admin = createAdminClient();
  const [mainDoorResult, roomDoorResult] = await Promise.all([
    admin
      .from("smart_lock_devices")
      .select(
        "id,provider_lock_id,provider_lock_name,access_scope,room_id,has_gateway,provider_data",
      )
      .eq("provider", "ttlock")
      .eq("property_id", tenancy.property_id)
      .eq("access_scope", "property_entry")
      .eq("sync_status", "connected"),
    admin
      .from("smart_lock_devices")
      .select(
        "id,provider_lock_id,provider_lock_name,access_scope,room_id,has_gateway,provider_data",
      )
      .eq("provider", "ttlock")
      .eq("room_id", tenancy.room_id)
      .eq("access_scope", "room_entry")
      .eq("sync_status", "connected"),
  ]);

  if (mainDoorResult.error) throw mainDoorResult.error;
  if (roomDoorResult.error) throw roomDoorResult.error;
  return [...(mainDoorResult.data ?? []), ...(roomDoorResult.data ?? [])] as SmartLockRow[];
}

async function currentGrant(deviceId: string, tenancyId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("smart_lock_access_grants")
    .select(
      "id,provider_keyboard_pwd_id,keyboard_password,passcode_name,credential_state,valid_from,valid_until",
    )
    .eq("device_id", deviceId)
    .eq("tenancy_id", tenancyId)
    .in("credential_state", ["pending_generation", "active", "revoke_pending"])
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as ExistingGrant | null;
}

async function provisionDevice(input: {
  device: SmartLockRow;
  tenancy: TenancyAccessRow;
  tenantProfileId: string;
  tenantName: string;
  validFrom: Date;
  validUntil: Date;
}) {
  const admin = createAdminClient();
  const lockId = Number(input.device.provider_lock_id);
  const keyboardPasswordVersion = Number(
    input.device.provider_data?.keyboardPasswordVersion ?? 0,
  );

  if (!Number.isSafeInteger(lockId) || lockId <= 0) {
    throw new Error(`${input.device.provider_lock_name} has no live TTLock ID.`);
  }
  if (!input.device.has_gateway) {
    throw new Error(`${input.device.provider_lock_name} has no connected gateway.`);
  }
  if (keyboardPasswordVersion !== 4) {
    throw new Error(`${input.device.provider_lock_name} does not support V4 passcodes.`);
  }

  const existing = await currentGrant(input.device.id, input.tenancy.id);
  const name = passcodeName(input.tenantName, input.device.access_scope);
  if (existing?.credential_state === "revoke_pending") {
    throw new Error(`${input.device.provider_lock_name} still has access awaiting revocation.`);
  }

  if (existing?.credential_state === "active") {
    const providerKeyboardPwdId = Number(existing.provider_keyboard_pwd_id);
    if (
      !Number.isSafeInteger(providerKeyboardPwdId) ||
      !existing.keyboard_password
    ) {
      throw new Error(`${input.device.provider_lock_name} has an incomplete active credential.`);
    }
    const existingFrom = new Date(existing.valid_from);
    const existingUntil = new Date(existing.valid_until);
    if (
      sameMinute(existingFrom, input.validFrom) &&
      sameMinute(existingUntil, input.validUntil) &&
      existing.passcode_name === name
    ) {
      return "unchanged" as const;
    }

    try {
      await changeTTLockPasscode({
        lockId,
        keyboardPwdId: providerKeyboardPwdId,
        passcode: existing.keyboard_password,
        name,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
      });
      const now = new Date().toISOString();
      const { error } = await admin
        .from("smart_lock_access_grants")
        .update({
          passcode_name: name,
          valid_from: input.validFrom.toISOString(),
          valid_until: input.validUntil.toISOString(),
          last_error: null,
          last_provider_sync_at: now,
          provider_status: { operation: "changed_via_gateway", syncedAt: now },
          updated_at: now,
        })
        .eq("id", existing.id);
      if (error) throw error;
      return "updated" as const;
    } catch (error) {
      const message = providerError(error);
      await admin
        .from("smart_lock_access_grants")
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      throw error;
    }
  }

  const passcode = randomPasscode();
  const now = new Date().toISOString();
  const { data: grant, error: grantError } = await admin
    .from("smart_lock_access_grants")
    .insert({
      device_id: input.device.id,
      company_id: input.tenancy.company_id,
      property_id: input.tenancy.property_id,
      room_id:
        input.device.access_scope === "room_entry" ? input.tenancy.room_id : null,
      tenancy_id: input.tenancy.id,
      tenant_profile_id: input.tenantProfileId,
      access_scope: input.device.access_scope,
      keyboard_password: passcode,
      passcode_name: name,
      credential_state: "pending_generation",
      valid_from: input.validFrom.toISOString(),
      valid_until: input.validUntil.toISOString(),
      updated_at: now,
    })
    .select("id")
    .single();

  if (grantError || !grant) throw grantError ?? new Error("Access grant could not be created.");

  let keyboardPwdId: number | null = null;
  try {
    keyboardPwdId = await addTTLockPasscode({
      lockId,
      passcode,
      name,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    });
    const activatedAt = new Date().toISOString();
    const { error } = await admin
      .from("smart_lock_access_grants")
      .update({
        provider_keyboard_pwd_id: keyboardPwdId,
        credential_state: "active",
        activated_at: activatedAt,
        last_error: null,
        last_provider_sync_at: activatedAt,
        provider_status: { operation: "added_via_gateway", syncedAt: activatedAt },
        updated_at: activatedAt,
      })
      .eq("id", grant.id);
    if (error) throw error;
    return "created" as const;
  } catch (error) {
    if (keyboardPwdId) {
      await deleteTTLockPasscode({ lockId, keyboardPwdId }).catch(() => undefined);
    }
    await admin
      .from("smart_lock_access_grants")
      .update({
        credential_state: "error",
        keyboard_password: null,
        last_error: providerError(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", grant.id);
    throw error;
  }
}

export async function reconcileSmartLockAccessForTenancy(
  tenancyId: string,
): Promise<AccessSyncResult> {
  const result: AccessSyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
  };
  const tenancy = await loadTenancy(tenancyId);
  const tenant = one(tenancy?.tenants ?? null);
  if (
    !tenancy ||
    tenancy.status !== "active" ||
    tenancy.checkout_date ||
    ["completed", "terminated"].includes(String(tenancy.billing_status)) ||
    !tenant?.profile_id
  ) {
    result.skipped += 1;
    return result;
  }

  const startDate =
    tenancy.check_in_date ??
    tenancy.tenancy_start_date ??
    tenancy.contract_start ??
    tenancy.start_date;
  const endDate =
    tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date;
  if (!startDate || (!endDate && tenancy.rental_model !== "monthly_stay")) {
    result.errors.push("The tenancy start or end date is missing.");
    return result;
  }

  const now = new Date();
  const validUntil = endDate
    ? malaysiaEnd(endDate)
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (validUntil.getTime() <= now.getTime()) {
    result.skipped += 1;
    return result;
  }
  const validFrom = new Date(
    Math.max(malaysiaStart(startDate).getTime(), now.getTime() - 5 * 60_000),
  );
  const devices = await loadTenancyDevices(tenancy);
  if (!devices.length) {
    result.skipped += 1;
    return result;
  }

  for (const device of devices) {
    try {
      const status = await provisionDevice({
        device,
        tenancy,
        tenantProfileId: tenant.profile_id,
        tenantName: tenant.full_name,
        validFrom,
        validUntil,
      });
      result[status] += 1;
    } catch (error) {
      result.errors.push(providerError(error));
    }
  }
  return result;
}

export async function revokeSmartLockAccessForTenancy(tenancyId: string) {
  const admin = createAdminClient();
  const { data: grants, error } = await admin
    .from("smart_lock_access_grants")
    .select(
      "id,device_id,provider_keyboard_pwd_id,credential_state,smart_lock_devices(provider_lock_id,provider_lock_name)",
    )
    .eq("tenancy_id", tenancyId)
    .in("credential_state", ["pending_generation", "active", "revoke_pending"]);
  if (error) throw error;

  const errors: string[] = [];
  for (const grant of grants ?? []) {
    const device = one(
      grant.smart_lock_devices as Relation<{
        provider_lock_id: number | string | null;
        provider_lock_name: string;
      }>,
    );
    const lockId = Number(device?.provider_lock_id);
    const keyboardPwdId = Number(grant.provider_keyboard_pwd_id);
    const requestedAt = new Date().toISOString();
    await admin
      .from("smart_lock_access_grants")
      .update({
        credential_state: "revoke_pending",
        revoke_requested_at: requestedAt,
        updated_at: requestedAt,
      })
      .eq("id", grant.id);

    try {
      if (
        Number.isSafeInteger(lockId) &&
        lockId > 0 &&
        Number.isSafeInteger(keyboardPwdId) &&
        keyboardPwdId > 0
      ) {
        await deleteTTLockPasscode({ lockId, keyboardPwdId });
      }
      const revokedAt = new Date().toISOString();
      await admin
        .from("smart_lock_access_grants")
        .update({
          credential_state: "revoked",
          keyboard_password: null,
          revoked_at: revokedAt,
          last_error: null,
          last_provider_sync_at: revokedAt,
          provider_status: { operation: "deleted_via_gateway", syncedAt: revokedAt },
          updated_at: revokedAt,
        })
        .eq("id", grant.id);
    } catch (revokeError) {
      const message = providerError(revokeError);
      errors.push(`${device?.provider_lock_name ?? "TTLock"}: ${message}`);
      await admin
        .from("smart_lock_access_grants")
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq("id", grant.id);
    }
  }

  if (errors.length) {
    throw new Error(errors.join(" "));
  }
}
