import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  changeTTLockEKeyPeriod,
  deleteTTLockEKey,
  freezeTTLockEKey,
  sendTTLockEKey,
  unfreezeTTLockEKey,
} from "@/lib/ttlock/client";
import {
  EKEY_OPEN_STATES,
  ekeyErrorMessage,
  ekeyName,
  isMissingSchemaError,
  normalizeTTLockUsername,
  planEKeyReconcile,
  tenancyAccessWindow,
} from "@/lib/ttlock/ekey-rules";
import { nextPasscodeValidity } from "@/lib/ttlock/passcode-period";

type Relation<T> = T | T[] | null | undefined;

const GRANTS = "smart_lock_ekey_grants";

export type EKeySyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
};

type TenancyRow = {
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
    ttlock_username: string | null;
  }>;
};

type LockRow = {
  id: string;
  provider_lock_id: number | string | null;
  provider_lock_name: string;
  access_scope: "property_entry" | "room_entry";
};

type GrantRow = {
  id: string;
  device_id: string;
  tenancy_id: string;
  access_scope: "property_entry" | "room_entry";
  provider_key_id: number | string | null;
  receiver_username: string;
  key_name: string | null;
  credential_state: string;
  valid_from: string;
  valid_until: string;
  last_extension_reference: string | null;
  smart_lock_devices?: Relation<{
    provider_lock_id: number | string | null;
    provider_lock_name: string | null;
    sync_status?: string | null;
  }>;
};

const GRANT_COLUMNS =
  "id,device_id,tenancy_id,access_scope,provider_key_id,receiver_username,key_name,credential_state,valid_from,valid_until,last_extension_reference";

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function emptyResult(): EKeySyncResult {
  return { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };
}

function validKeyId(value: number | string | null | undefined) {
  const keyId = Number(value);
  return Number.isSafeInteger(keyId) && keyId > 0 ? keyId : null;
}

function validLockId(value: number | string | null | undefined) {
  const lockId = Number(value);
  return Number.isSafeInteger(lockId) && lockId > 0 ? lockId : null;
}

function eligible(tenancy: TenancyRow | null) {
  const tenant = one(tenancy?.tenants);
  return Boolean(
    tenancy &&
      tenancy.status === "active" &&
      !tenancy.checkout_date &&
      !["completed", "terminated"].includes(String(tenancy.billing_status)) &&
      tenant?.profile_id,
  );
}

async function loadTenancy(tenancyId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenancies")
    .select(
      "id,company_id,property_id,room_id,check_in_date,tenancy_start_date,contract_start,start_date,tenancy_end_date,contract_end,end_date,checkout_date,status,billing_status,rental_model,tenants(profile_id,full_name,ttlock_username)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (error) {
    // Before the migration there is no TTLock account column, so no eKeys.
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
  return (data ?? null) as unknown as TenancyRow | null;
}

/** Main-door locks of the property plus the tenancy's own room lock. */
async function loadTenancyLocks(tenancy: TenancyRow) {
  const admin = createAdminClient();
  const columns = "id,provider_lock_id,provider_lock_name,access_scope";
  const [mainDoor, roomDoor] = await Promise.all([
    admin
      .from("smart_lock_devices")
      .select(columns)
      .eq("provider", "ttlock")
      .eq("property_id", tenancy.property_id)
      .eq("access_scope", "property_entry")
      .eq("sync_status", "connected"),
    admin
      .from("smart_lock_devices")
      .select(columns)
      .eq("provider", "ttlock")
      .eq("room_id", tenancy.room_id)
      .eq("access_scope", "room_entry")
      .eq("sync_status", "connected"),
  ]);
  if (mainDoor.error) throw mainDoor.error;
  if (roomDoor.error) throw roomDoor.error;
  return [...(mainDoor.data ?? []), ...(roomDoor.data ?? [])] as LockRow[];
}

async function openGrant(deviceId: string, tenancyId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(GRANTS)
    .select(GRANT_COLUMNS)
    .eq("device_id", deviceId)
    .eq("tenancy_id", tenancyId)
    .in("credential_state", [...EKEY_OPEN_STATES])
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as GrantRow | null;
}

async function markGrant(id: string, patch: Record<string, unknown>) {
  const admin = createAdminClient();
  const { error } = await admin
    .from(GRANTS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function recordGrantError(id: string, message: string) {
  await markGrant(id, { last_error: message.slice(0, 500) }).catch(() => undefined);
}

async function sendNewKey(input: {
  tenancy: TenancyRow;
  device: LockRow;
  lockId: number;
  tenantProfileId: string;
  receiverUsername: string;
  name: string;
  validFrom: Date;
  validUntil: Date;
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: inserted, error } = await admin
    .from(GRANTS)
    .insert({
      device_id: input.device.id,
      company_id: input.tenancy.company_id,
      property_id: input.tenancy.property_id,
      room_id:
        input.device.access_scope === "room_entry" ? input.tenancy.room_id : null,
      tenancy_id: input.tenancy.id,
      tenant_profile_id: input.tenantProfileId,
      access_scope: input.device.access_scope,
      receiver_username: input.receiverUsername,
      key_name: input.name,
      credential_state: "pending_send",
      valid_from: input.validFrom.toISOString(),
      valid_until: input.validUntil.toISOString(),
      updated_at: now,
    })
    .select("id")
    .single();
  if (error || !inserted?.id) {
    throw error ?? new Error("eKey grant could not be created.");
  }

  let keyId: number | null = null;
  try {
    keyId = await sendTTLockEKey({
      lockId: input.lockId,
      receiverUsername: input.receiverUsername,
      keyName: input.name,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      remarks: "DEKEZ tenant access",
    });
    const activatedAt = new Date().toISOString();
    await markGrant(inserted.id, {
      provider_key_id: keyId,
      credential_state: "active",
      activated_at: activatedAt,
      last_error: null,
      last_provider_sync_at: activatedAt,
      provider_status: { operation: "sent", syncedAt: activatedAt },
    });
  } catch (sendError) {
    if (keyId) {
      await deleteTTLockEKey(keyId).catch(() => undefined);
    }
    await markGrant(inserted.id, {
      credential_state: "error",
      last_error: ekeyErrorMessage(sendError),
    }).catch(() => undefined);
    throw new Error(`${input.device.provider_lock_name}: ${ekeyErrorMessage(sendError)}`);
  }
}

async function deleteGrantKey(
  grant: { id: string; provider_key_id: number | string | null },
  reason?: string,
) {
  const requestedAt = new Date().toISOString();
  await markGrant(grant.id, {
    credential_state: "revoke_pending",
    revoke_requested_at: requestedAt,
    ...(reason ? { provider_status: { operation: "delete_requested", reason } } : {}),
  });
  const keyId = validKeyId(grant.provider_key_id);
  if (keyId) {
    try {
      await deleteTTLockEKey(keyId);
    } catch (error) {
      // An eKey that TTLock no longer has is already gone.
      const code =
        error && typeof error === "object" && "errcode" in error
          ? String((error as { errcode?: unknown }).errcode)
          : "";
      if (code !== "-1008") throw error;
    }
  }
  const revokedAt = new Date().toISOString();
  await markGrant(grant.id, {
    credential_state: "revoked",
    revoked_at: revokedAt,
    last_error: null,
    last_provider_sync_at: revokedAt,
    provider_status: {
      operation: "deleted",
      ...(reason ? { reason } : {}),
      syncedAt: revokedAt,
    },
  });
}

/**
 * Send, re-send or extend TTLock eKeys (room lock + property main door) for
 * an active tenancy, using the same access window as passcodes. Skips when
 * the tenant has no TTLock app account on file.
 */
export async function reconcileEKeyAccessForTenancy(
  tenancyId: string,
): Promise<EKeySyncResult> {
  const result = emptyResult();
  const tenancy = await loadTenancy(tenancyId);
  const tenant = one(tenancy?.tenants);
  if (!tenancy || !eligible(tenancy) || !tenant?.profile_id) {
    result.skipped += 1;
    return result;
  }
  const receiverUsername = normalizeTTLockUsername(tenant.ttlock_username);
  if (!receiverUsername) {
    result.skipped += 1;
    return result;
  }
  const window = tenancyAccessWindow(tenancy);
  if (!window.ok) {
    if (window.reason === "missing_dates") {
      result.errors.push("The tenancy start or end date is missing.");
    } else {
      result.skipped += 1;
    }
    return result;
  }

  const locks = await loadTenancyLocks(tenancy);
  if (!locks.length) {
    result.skipped += 1;
    return result;
  }

  for (const device of locks) {
    try {
      const lockId = validLockId(device.provider_lock_id);
      if (!lockId) {
        throw new Error(`${device.provider_lock_name} has no live TTLock ID.`);
      }
      const existing = await openGrant(device.id, tenancy.id);
      let validUntil = window.validUntil;
      const noFixedEnd =
        !(tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date);
      if (existing && noFixedEnd) {
        // Monthly stays: never shorten a key a payment already extended.
        const current = new Date(existing.valid_until);
        if (current > validUntil) validUntil = current;
      }
      const name = ekeyName(tenant.full_name, device.access_scope);
      const plan = planEKeyReconcile({
        existing,
        receiverUsername,
        validFrom: window.validFrom,
        validUntil,
      });

      if (plan.action === "blocked") {
        throw new Error(`${device.provider_lock_name} ${plan.reason}.`);
      }
      if (plan.action === "unchanged") {
        result.unchanged += 1;
        continue;
      }
      if (plan.action === "extend" && existing) {
        try {
          await changeTTLockEKeyPeriod({
            keyId: plan.keyId,
            validFrom: new Date(existing.valid_from),
            validUntil,
          });
          const now = new Date().toISOString();
          await markGrant(existing.id, {
            valid_until: validUntil.toISOString(),
            key_name: name,
            last_error: null,
            last_provider_sync_at: now,
            provider_status: { operation: "period_changed", syncedAt: now },
          });
          result.updated += 1;
        } catch (error) {
          const message = ekeyErrorMessage(error);
          await recordGrantError(existing.id, message);
          throw new Error(`${device.provider_lock_name}: ${message}`);
        }
        continue;
      }
      if (plan.action === "resend" && existing) {
        try {
          await deleteGrantKey(existing, "receiver_changed");
        } catch (error) {
          const message = ekeyErrorMessage(error);
          await recordGrantError(existing.id, message);
          throw new Error(`${device.provider_lock_name}: ${message}`);
        }
      }
      await sendNewKey({
        tenancy,
        device,
        lockId,
        tenantProfileId: tenant.profile_id,
        receiverUsername,
        name,
        validFrom: window.validFrom,
        validUntil,
      });
      if (plan.action === "resend") result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push(ekeyErrorMessage(error));
    }
  }
  return result;
}

/**
 * Staff-verified rent payment: extend active (and frozen) eKeys by 30 days,
 * capped at the contract end, exactly like passcodes. Idempotent per payment
 * submission and never throws for a single key.
 */
export async function extendEKeyAccessAfterPayment(input: {
  tenancyId: string;
  paymentSubmissionId: string;
  performedBy?: string | null;
}): Promise<EKeySyncResult> {
  const result = emptyResult();
  const tenancy = await loadTenancy(input.tenancyId);
  if (!tenancy || !eligible(tenancy)) {
    result.skipped += 1;
    return result;
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(GRANTS)
    .select(`${GRANT_COLUMNS},smart_lock_devices(provider_lock_id,provider_lock_name,sync_status)`)
    .eq("tenancy_id", input.tenancyId)
    .in("credential_state", ["active", "frozen"]);
  if (error) {
    if (isMissingSchemaError(error)) {
      result.skipped += 1;
      return result;
    }
    throw error;
  }
  const grants = (data ?? []) as unknown as GrantRow[];
  if (!grants.length) {
    result.skipped += 1;
    return result;
  }
  const contractEnd =
    tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date;

  for (const grant of grants) {
    if (grant.last_extension_reference === input.paymentSubmissionId) {
      result.unchanged += 1;
      continue;
    }
    const lockName = one(grant.smart_lock_devices)?.provider_lock_name ?? "TTLock";
    const keyId = validKeyId(grant.provider_key_id);
    if (!keyId) {
      result.errors.push(`${lockName} has an incomplete eKey.`);
      continue;
    }
    try {
      const period = nextPasscodeValidity({
        currentUntil: grant.valid_until,
        contractEnd,
      });
      if (period.unchanged) {
        await markGrant(grant.id, {
          last_extension_reference: input.paymentSubmissionId,
          last_error: null,
        });
        result.unchanged += 1;
        continue;
      }
      await changeTTLockEKeyPeriod({
        keyId,
        validFrom: new Date(grant.valid_from),
        validUntil: period.validUntil,
      });
      const now = new Date().toISOString();
      await markGrant(grant.id, {
        valid_until: period.validUntil.toISOString(),
        last_extension_reference: input.paymentSubmissionId,
        last_error: null,
        last_provider_sync_at: now,
        provider_status: { operation: "extended_after_payment", syncedAt: now },
      });
      result.updated += 1;
    } catch (extendError) {
      const message = ekeyErrorMessage(extendError);
      await recordGrantError(grant.id, message);
      result.errors.push(`${lockName}: ${message}`);
    }
  }
  return result;
}

/**
 * Delete every open eKey of a tenancy (checkout, contract end). Throws when
 * any delete fails so checkout stops, the same way passcodes do; the grant
 * stays revoke_pending for the next retry.
 */
export async function revokeEKeyAccessForTenancy(
  tenancyId: string,
  options?: { reason?: string },
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(GRANTS)
    .select(`${GRANT_COLUMNS},smart_lock_devices(provider_lock_id,provider_lock_name)`)
    .eq("tenancy_id", tenancyId)
    .in("credential_state", [...EKEY_OPEN_STATES]);
  if (error) {
    if (isMissingSchemaError(error)) return;
    throw error;
  }

  const errors: string[] = [];
  for (const grant of (data ?? []) as unknown as GrantRow[]) {
    const lockName = one(grant.smart_lock_devices)?.provider_lock_name ?? "TTLock";
    try {
      await deleteGrantKey(grant, options?.reason);
    } catch (revokeError) {
      const message = ekeyErrorMessage(revokeError);
      errors.push(`${lockName} eKey: ${message}`);
      await recordGrantError(grant.id, message);
    }
  }
  if (errors.length) throw new Error(errors.join(" "));
}

async function loadGrant(grantId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(GRANTS)
    .select(`${GRANT_COLUMNS},smart_lock_devices(provider_lock_id,provider_lock_name)`)
    .eq("id", grantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That eKey record was not found.");
  return data as unknown as GrantRow;
}

/** Staff control: freeze or unfreeze one eKey. */
export async function setEKeyFrozen(input: {
  grantId: string;
  frozen: boolean;
  performedBy: string;
}) {
  const grant = await loadGrant(input.grantId);
  const keyId = validKeyId(grant.provider_key_id);
  const expected = input.frozen ? "active" : "frozen";
  if (grant.credential_state !== expected || !keyId) {
    throw new Error(
      input.frozen
        ? "Only an active eKey can be frozen."
        : "Only a frozen eKey can be unfrozen.",
    );
  }
  try {
    if (input.frozen) await freezeTTLockEKey(keyId);
    else await unfreezeTTLockEKey(keyId);
  } catch (error) {
    const message = ekeyErrorMessage(error);
    await recordGrantError(grant.id, message);
    throw new Error(message);
  }
  const now = new Date().toISOString();
  await markGrant(grant.id, {
    credential_state: input.frozen ? "frozen" : "active",
    frozen_at: input.frozen ? now : null,
    last_error: null,
    last_provider_sync_at: now,
    provider_status: {
      operation: input.frozen ? "frozen" : "unfrozen",
      performedBy: input.performedBy,
      syncedAt: now,
    },
  });
}

/** Staff control: extend one eKey by 30 days, capped at the contract end. */
export async function extendEKeyGrant(input: { grantId: string; performedBy: string }) {
  const grant = await loadGrant(input.grantId);
  const keyId = validKeyId(grant.provider_key_id);
  if (!["active", "frozen"].includes(grant.credential_state) || !keyId) {
    throw new Error("Only an active or frozen eKey can be extended.");
  }
  const tenancy = await loadTenancy(grant.tenancy_id);
  if (!tenancy || !eligible(tenancy)) {
    throw new Error("The tenancy is no longer active.");
  }
  const contractEnd =
    tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date;
  const period = nextPasscodeValidity({ currentUntil: grant.valid_until, contractEnd });
  if (period.unchanged) return { extended: false, validUntil: grant.valid_until };
  try {
    await changeTTLockEKeyPeriod({
      keyId,
      validFrom: new Date(grant.valid_from),
      validUntil: period.validUntil,
    });
  } catch (error) {
    const message = ekeyErrorMessage(error);
    await recordGrantError(grant.id, message);
    throw new Error(message);
  }
  const now = new Date().toISOString();
  await markGrant(grant.id, {
    valid_until: period.validUntil.toISOString(),
    last_error: null,
    last_provider_sync_at: now,
    provider_status: { operation: "extended_by_staff", performedBy: input.performedBy, syncedAt: now },
  });
  return { extended: true, validUntil: period.validUntil.toISOString() };
}

/** Staff control: delete one eKey now. */
export async function deleteEKeyGrant(input: { grantId: string; performedBy: string }) {
  const grant = await loadGrant(input.grantId);
  if (!(EKEY_OPEN_STATES as readonly string[]).includes(grant.credential_state)) {
    if (grant.credential_state === "error") {
      // Failed send: nothing exists on TTLock, just close the record.
      const now = new Date().toISOString();
      await markGrant(grant.id, {
        credential_state: "revoked",
        revoked_at: now,
        provider_status: { operation: "closed_after_error", performedBy: input.performedBy },
      });
      return;
    }
    throw new Error("That eKey is already deleted.");
  }
  try {
    await deleteGrantKey(grant, "staff_deleted");
  } catch (error) {
    const message = ekeyErrorMessage(error);
    await recordGrantError(grant.id, message);
    throw new Error(message);
  }
}

/** Save (or clear) the tenant's TTLock app account used to receive eKeys. */
export async function saveTenantTTLockUsername(input: {
  tenantId: string;
  username: string;
}) {
  const trimmed = input.username.trim();
  const normalized = trimmed ? normalizeTTLockUsername(trimmed) : null;
  if (trimmed && !normalized) {
    throw new Error("Enter the phone number or email the tenant uses to log in to the TTLock app.");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("tenants")
    .update({ ttlock_username: normalized, updated_at: new Date().toISOString() })
    .eq("id", input.tenantId);
  if (error) throw error;
  return normalized;
}
