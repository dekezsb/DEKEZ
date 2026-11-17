import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { changeTTLockPasscode } from "@/lib/ttlock/client";
import { nextPasscodeValidity } from "@/lib/ttlock/passcode-period";

type Relation<T> = T | T[] | null | undefined;

type TenancyRow = {
  id: string;
  status: string;
  billing_status: string | null;
  checkout_date: string | null;
  tenancy_end_date: string | null;
  contract_end: string | null;
  end_date: string | null;
  tenants: Relation<{ profile_id: string | null; full_name: string }>;
};

type GrantRow = {
  id: string;
  access_scope: "property_entry" | "room_entry";
  provider_keyboard_pwd_id: number | string | null;
  keyboard_password: string | null;
  passcode_name: string | null;
  credential_state: string;
  valid_from: string;
  valid_until: string;
  last_extension_reference: string | null;
  last_error: string | null;
  smart_lock_devices: Relation<{
    id: string;
    provider_lock_id: number | string | null;
    provider_lock_name: string | null;
    has_gateway: boolean | null;
    sync_status: string | null;
  }>;
};

export type PasscodePaymentResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
};

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function providerError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "TTLock passcode request failed.";
}

export { nextPasscodeValidity } from "@/lib/ttlock/passcode-period";

function eligibleTenant(tenancy: TenancyRow | null) {
  const tenant = one(tenancy?.tenants ?? null);
  return Boolean(
    tenancy
      && tenancy.status === "active"
      && !tenancy.checkout_date
      && !["completed", "terminated"].includes(String(tenancy.billing_status))
      && tenant?.profile_id,
  );
}

async function loadTenancy(tenancyId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenancies")
    .select(
      "id,status,billing_status,checkout_date,tenancy_end_date,contract_end,end_date,tenants(profile_id,full_name)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TenancyRow | null;
}

/**
 * After staff verify a rent payment slip, extend existing active TTLock
 * passcodes (room and main door) by 30 days, keeping the same code, and cap
 * at the contract end. Does not create a new code, does not shorten access,
 * and is idempotent per payment submission.
 */
export async function extendPasscodeAccessAfterPayment(input: {
  tenancyId: string;
  paymentSubmissionId: string;
  performedBy?: string | null;
}): Promise<PasscodePaymentResult> {
  const result: PasscodePaymentResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
  };
  const tenancy = await loadTenancy(input.tenancyId);
  if (!eligibleTenant(tenancy) || !tenancy) {
    result.skipped += 1;
    return result;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("smart_lock_access_grants")
    .select(
      "id,access_scope,provider_keyboard_pwd_id,keyboard_password,passcode_name,credential_state,valid_from,valid_until,last_extension_reference,last_error,smart_lock_devices(id,provider_lock_id,provider_lock_name,has_gateway,sync_status)",
    )
    .eq("tenancy_id", input.tenancyId)
    .eq("credential_state", "active");
  if (error) throw error;

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

    const device = one(grant.smart_lock_devices);
    const lockId = Number(device?.provider_lock_id);
    const keyboardPwdId = Number(grant.provider_keyboard_pwd_id);
    const lockName = device?.provider_lock_name ?? "TTLock";

    if (
      !device?.has_gateway
      || device.sync_status !== "connected"
      || !Number.isSafeInteger(lockId)
      || lockId <= 0
      || !Number.isSafeInteger(keyboardPwdId)
      || keyboardPwdId <= 0
      || !grant.keyboard_password
    ) {
      result.errors.push(`${lockName} has an incomplete active passcode.`);
      continue;
    }

    try {
      const period = nextPasscodeValidity({
        currentUntil: grant.valid_until,
        contractEnd,
      });
      if (period.unchanged) {
        await admin
          .from("smart_lock_access_grants")
          .update({
            last_extension_reference: input.paymentSubmissionId,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", grant.id);
        result.unchanged += 1;
        continue;
      }

      await changeTTLockPasscode({
        lockId,
        keyboardPwdId,
        passcode: grant.keyboard_password,
        name: grant.passcode_name || `DEKEZ ${lockName}`.slice(0, 50),
        validFrom: new Date(grant.valid_from),
        validUntil: period.validUntil,
      });

      const now = new Date().toISOString();
      const { error: updateError } = await admin
        .from("smart_lock_access_grants")
        .update({
          valid_until: period.validUntil.toISOString(),
          last_extension_reference: input.paymentSubmissionId,
          last_error: null,
          last_provider_sync_at: now,
          provider_status: { operation: "extended_after_payment", syncedAt: now },
          updated_at: now,
        })
        .eq("id", grant.id);
      if (updateError) throw updateError;
      result.updated += 1;
    } catch (extendError) {
      const message = providerError(extendError);
      await admin
        .from("smart_lock_access_grants")
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq("id", grant.id);
      result.errors.push(message);
    }
  }

  return result;
}
