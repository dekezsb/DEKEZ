/**
 * Pure helpers for TTLock eKeys ("Unlock with APP"). No server or network
 * dependencies so they can be unit tested directly.
 */

export const EKEY_STATUS_NORMAL = "110401";
export const EKEY_STATUS_FROZEN = "110405";

export const EKEY_OPEN_STATES = [
  "pending_send",
  "active",
  "frozen",
  "revoke_pending",
] as const;

export type EKeyCredentialState =
  | "pending_send"
  | "active"
  | "frozen"
  | "revoke_pending"
  | "revoked"
  | "error";

const unicodeDashes = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/**
 * Normalise the TTLock app account a tenant registered with. Emails are
 * lower-cased. Phone numbers keep an optional leading "+" and digits only.
 * Returns null when the value is neither a plausible email nor phone.
 */
export function normalizeTTLockUsername(raw: string | null | undefined) {
  const value = (raw ?? "").replace(unicodeDashes, "-").trim();
  if (!value) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 100
      ? email
      : null;
  }
  const compact = value.replace(/[\s().-]/g, "");
  if (/^\+?\d{6,15}$/.test(compact)) return compact;
  // TTLock also allows plain username accounts (letters and digits only).
  if (/^[A-Za-z0-9_]{4,50}$/.test(compact)) return compact;
  return null;
}

export function ekeyName(
  tenantName: string,
  scope: "property_entry" | "room_entry",
) {
  const label = scope === "property_entry" ? "MAIN" : "ROOM";
  return `DEKEZ ${tenantName} ${label} APP`.slice(0, 50);
}

export function ekeyStateLabel(state: string | null | undefined) {
  switch (state) {
    case "pending_send":
      return "Sending";
    case "active":
      return "Active";
    case "frozen":
      return "Frozen";
    case "revoke_pending":
      return "Deleting";
    case "revoked":
      return "Deleted";
    case "error":
      return "Needs attention";
    default:
      return state ? state.replaceAll("_", " ") : "Not sent";
  }
}

export function providerKeyStatusLabel(status: string | number | null | undefined) {
  switch (String(status ?? "")) {
    case "110401":
      return "Normal";
    case "110402":
      return "Pending";
    case "110405":
      return "Frozen";
    case "110408":
      return "Deleting";
    case "110410":
      return "Deleted";
    case "110412":
      return "Reset";
    default:
      return status == null || status === "" ? "Unknown" : String(status);
  }
}

const friendlyErrors: Record<string, string> = {
  "-4064": "The tenant's TTLock account is not registered yet. Ask them to sign up in the TTLock app with this phone or email, then try again.",
  "-1027": "That TTLock account is bound to another account. Check the tenant's TTLock login.",
  "-2019": "An eKey cannot be sent to the DEKEZ admin TTLock account.",
  "-2020": "An eKey cannot be sent to the lock admin account.",
  "-1008": "The eKey no longer exists in TTLock.",
  "-2023": "TTLock cannot change this eKey's period right now.",
  "-2025": "This lock is frozen in TTLock.",
  "-1003": "The lock no longer exists in TTLock.",
  "30002": "Invalid TTLock username. Use the phone number or email the tenant registered with.",
};

/** Turn a TTLock error (which may carry `errcode`) into a staff-readable line. */
export function ekeyErrorMessage(error: unknown) {
  const code =
    error && typeof error === "object" && "errcode" in error
      ? String((error as { errcode?: unknown }).errcode ?? "")
      : "";
  if (code && friendlyErrors[code]) return friendlyErrors[code];
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "TTLock eKey request failed.";
}

function sameMinute(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) < 60_000;
}

export type EKeyPlanInput = {
  existing: {
    credential_state: string;
    provider_key_id: number | string | null;
    receiver_username: string;
    valid_from: string;
    valid_until: string;
  } | null;
  receiverUsername: string;
  validFrom: Date;
  validUntil: Date;
};

/**
 * Decide what reconciliation should do for one lock:
 *  - send:    no open eKey yet
 *  - resend:  receiver changed (delete old key, send a new one)
 *  - extend:  same receiver, different period (changePeriod)
 *  - unchanged
 *  - blocked: an earlier delete is still pending / incomplete record
 */
export function planEKeyReconcile(input: EKeyPlanInput):
  | { action: "send" }
  | { action: "resend"; keyId: number | null }
  | { action: "extend"; keyId: number }
  | { action: "unchanged" }
  | { action: "blocked"; reason: string } {
  const existing = input.existing;
  if (!existing) return { action: "send" };
  if (existing.credential_state === "revoke_pending") {
    return { action: "blocked", reason: "still has an eKey awaiting deletion" };
  }
  const keyId = Number(existing.provider_key_id);
  const validKeyId = Number.isSafeInteger(keyId) && keyId > 0 ? keyId : null;
  if (existing.credential_state === "pending_send") {
    return { action: "resend", keyId: validKeyId };
  }
  if (existing.receiver_username !== input.receiverUsername) {
    return { action: "resend", keyId: validKeyId };
  }
  if (!validKeyId) {
    return { action: "blocked", reason: "has an incomplete eKey record" };
  }
  // Only the expiry matters for an issued key; the start stays as first sent.
  if (sameMinute(new Date(existing.valid_until), input.validUntil)) {
    return { action: "unchanged" };
  }
  return { action: "extend", keyId: validKeyId };
}

function malaysiaStart(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function malaysiaEnd(date: string) {
  return new Date(`${date}T23:59:59+08:00`);
}

/**
 * Same access window that passcode provisioning uses: from check-in (never
 * earlier than five minutes ago) to 11:59:59pm MYT on the contract end, or
 * 30 days for a monthly stay without an end date.
 */
export function tenancyAccessWindow(
  tenancy: {
    check_in_date: string | null;
    tenancy_start_date: string | null;
    contract_start: string | null;
    start_date: string | null;
    tenancy_end_date: string | null;
    contract_end: string | null;
    end_date: string | null;
    rental_model: string | null;
  },
  now = new Date(),
):
  | { ok: true; validFrom: Date; validUntil: Date }
  | { ok: false; reason: "missing_dates" | "ended" } {
  const startDate =
    tenancy.check_in_date ??
    tenancy.tenancy_start_date ??
    tenancy.contract_start ??
    tenancy.start_date;
  const endDate =
    tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date;
  if (!startDate || (!endDate && tenancy.rental_model !== "monthly_stay")) {
    return { ok: false, reason: "missing_dates" };
  }
  const validUntil = endDate
    ? malaysiaEnd(endDate)
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (validUntil.getTime() <= now.getTime()) {
    return { ok: false, reason: "ended" };
  }
  const validFrom = new Date(
    Math.max(malaysiaStart(startDate).getTime(), now.getTime() - 5 * 60_000),
  );
  return { ok: true, validFrom, validUntil };
}

/**
 * True when Supabase reports that a table/column from the eKey/meter
 * migration is not there yet (code deployed before the migration ran).
 * Callers treat that as "no eKeys" so checkout and crons keep working.
 */
export function isMissingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return true;
  const text = String((error as { message?: unknown }).message ?? "");
  return /smart_lock_ekey_grants|ttlock_username|power_control_reason|power_controlled_(at|by)/.test(text)
    && /does not exist|could not find|schema cache/i.test(text);
}
