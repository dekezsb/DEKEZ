import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { revokeSmartLockAccessForTenancy } from "@/lib/ttlock/access";
import {
  hasContractEnded,
  resolveContractEndDate,
} from "@/lib/ttlock/contract-end";
import { revokeEKeyAccessForTenancy } from "@/lib/ttlock/ekey";
import { isMissingSchemaError } from "@/lib/ttlock/ekey-rules";
import { revokeFingerprintAccessForTenancy } from "@/lib/ttlock/fingerprint";

type Relation<T> = T | T[] | null | undefined;

type TenancyDates = {
  tenancy_end_date: string | null;
  contract_end: string | null;
  end_date: string | null;
};

type OpenGrant = {
  id: string;
  tenancy_id: string;
  credential_state: string;
  tenancies: Relation<TenancyDates>;
};

export type ContractEndCleanupResult = {
  tenancies: number;
  retried: number;
  skipped: number;
  errors: string[];
};

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function cleanupError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Contract-end access cleanup failed.";
}

/**
 * After 11:59:59pm MYT on the contract end date, delete remaining MAIN and
 * ROOM passcodes (plus fingerprints and app eKeys) unless the tenancy was renewed to a later
 * end date. Idempotent; retries revoke_pending grants on the next run.
 */
export async function revokeAccessAfterContractEnd(input?: {
  now?: Date;
}): Promise<ContractEndCleanupResult> {
  const now = input?.now ?? new Date();
  const result: ContractEndCleanupResult = {
    tenancies: 0,
    retried: 0,
    skipped: 0,
    errors: [],
  };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("smart_lock_access_grants")
    .select(
      "id,tenancy_id,credential_state,tenancies(tenancy_end_date,contract_end,end_date)",
    )
    .in("credential_state", [
      "pending_generation",
      "active",
      "revoke_pending",
    ]);
  if (error) throw error;
  const { data: ekeyData, error: ekeyError } = await admin
    .from("smart_lock_ekey_grants")
    .select(
      "id,tenancy_id,credential_state,tenancies(tenancy_end_date,contract_end,end_date)",
    )
    .in("credential_state", [
      "pending_send",
      "active",
      "frozen",
      "revoke_pending",
    ]);
  if (ekeyError && !isMissingSchemaError(ekeyError)) throw ekeyError;

  const byTenancy = new Map<
    string,
    { retried: boolean; skipped: boolean }
  >();

  for (const grant of [...(data ?? []), ...(ekeyData ?? [])] as OpenGrant[]) {
    if (!grant.tenancy_id) continue;
    const tenancy = one(grant.tenancies);
    const ended = hasContractEnded(resolveContractEndDate(tenancy ?? {}), now);
    const existing = byTenancy.get(grant.tenancy_id);
    if (!ended) {
      if (!existing) {
        byTenancy.set(grant.tenancy_id, { retried: false, skipped: true });
        result.skipped += 1;
      }
      continue;
    }
    if (!existing || existing.skipped) {
      if (existing?.skipped) result.skipped -= 1;
      byTenancy.set(grant.tenancy_id, {
        retried: grant.credential_state === "revoke_pending",
        skipped: false,
      });
    } else if (grant.credential_state === "revoke_pending") {
      existing.retried = true;
    }
  }

  for (const [tenancyId, entry] of byTenancy) {
    if (entry.skipped) continue;
    result.tenancies += 1;
    if (entry.retried) result.retried += 1;
    try {
      await revokeSmartLockAccessForTenancy(tenancyId, {
        reason: "contract_ended",
      });
      await revokeFingerprintAccessForTenancy(tenancyId);
      await revokeEKeyAccessForTenancy(tenancyId, { reason: "contract_ended" });
    } catch (revokeError) {
      result.errors.push(`${tenancyId}: ${cleanupError(revokeError)}`);
    }
  }

  return result;
}
