// Pure rules for "a checked-out tenant can no longer log in".
// Kept free of server imports so tests can load them directly.

export const TENANCY_ENDED_MESSAGE =
  "Your tenancy has ended. Please contact Dekez.";

/** Long ban used for checked-out tenants; lifted automatically on move-in. */
export const CHECKOUT_BAN_DURATION = "876000h";

export type TenancyAccessRow = {
  status: string | null;
  checkout_date: string | null;
};

export type TenantLoginDecision = "allowed" | "tenancy_ended";

/** Active (moved in) or draft (upcoming) tenancy that has not been checked out. */
export function isCurrentTenancy(tenancy: TenancyAccessRow) {
  return (
    (tenancy.status === "active" || tenancy.status === "draft") &&
    !tenancy.checkout_date
  );
}

export function isEndedTenancy(tenancy: TenancyAccessRow) {
  return tenancy.status === "ended" || Boolean(tenancy.checkout_date);
}

/**
 * Staff/admin/owner roles are never affected. A tenant keeps access while any
 * tenancy is current. A tenant with checkout history (or a revoke marker) and
 * no current tenancy is refused. Applicants who never had a tenancy keep the
 * existing registration flow.
 */
export function decideTenantLoginAccess(input: {
  role: string | null | undefined;
  tenancies: TenancyAccessRow[];
  revokedMarker?: boolean;
}): TenantLoginDecision {
  if (input.role !== "tenant") return "allowed";
  if (input.tenancies.some(isCurrentTenancy)) return "allowed";
  if (input.revokedMarker || input.tenancies.some(isEndedTenancy)) {
    return "tenancy_ended";
  }
  return "allowed";
}

/** True when the auth user is banned right now. */
export function isBannedNow(bannedUntil: string | null | undefined, now = new Date()) {
  if (!bannedUntil) return false;
  const until = new Date(bannedUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/** Original contract end, read before checkout overwrites the end columns. */
export function contractEndOf(tenancy: {
  tenancy_end_date?: string | null;
  contract_end?: string | null;
  end_date?: string | null;
}) {
  return tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date ?? null;
}

/** Early checkout: checked out before the contract end date (YYYY-MM-DD). */
export function isEarlyCheckout(
  checkoutDate: string | null | undefined,
  contractEnd: string | null | undefined,
) {
  if (!checkoutDate || !contractEnd) return false;
  return checkoutDate.slice(0, 10) < contractEnd.slice(0, 10);
}

/** Columns/RPC added by 20261124120000 may not be applied yet. */
export function isMissingCheckoutLoginSchema(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const text = String((error as { message?: unknown }).message ?? "");
  if (["42703", "42883", "PGRST202", "PGRST204"].includes(code)) {
    return /contract_end_before_checkout|checked_out_at|revoke_tenant_auth_sessions/.test(text) || code === "PGRST202";
  }
  return /contract_end_before_checkout|checked_out_at|revoke_tenant_auth_sessions/.test(text)
    && /does not exist|could not find|schema cache/i.test(text);
}
