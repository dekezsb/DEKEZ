import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTenantLoginDecision,
  tenanciesForProfile,
} from "@/lib/auth/tenant-login-lookup";
import {
  CHECKOUT_BAN_DURATION,
  isBannedNow,
  isCurrentTenancy,
  isMissingCheckoutLoginSchema,
} from "@/lib/auth/tenant-login-rules";

type AdminClient = ReturnType<typeof createAdminClient>;

export { getTenantLoginDecision };

export type TenantLoginRevokeStatus =
  | "revoked"
  | "kept_for_current_tenancy"
  | "not_tenant"
  | "not_linked"
  | "failed";

export type TenantLoginRestoreStatus =
  | "restored"
  | "not_banned"
  | "no_current_tenancy"
  | "not_tenant"
  | "failed";

async function revokeSessions(admin: AdminClient, profileId: string) {
  const { error } = await admin.rpc("revoke_tenant_auth_sessions", {
    p_user_id: profileId,
  });
  if (error && !isMissingCheckoutLoginSchema(error)) {
    console.error("Tenant sessions could not be revoked.", { profileId, error });
  }
}

/** Sign out every session of a tenant whose login was already disabled. */
export async function revokeTenantSessions(profileId: string | null) {
  if (!profileId) return;
  await revokeSessions(createAdminClient(), profileId);
}

/**
 * Disable a tenant login at checkout: ban the auth user (records are kept)
 * and sign out its sessions. Never touches staff, admin or owner accounts,
 * and never disables someone who still has an active or upcoming tenancy.
 */
export async function revokeTenantLogin(input: {
  profileId: string | null;
  tenancyId?: string;
  reason: "checkout" | "old_tenant_cleanup";
}): Promise<TenantLoginRevokeStatus> {
  if (!input.profileId) return "not_linked";
  const admin = createAdminClient();
  try {
    const [{ data: existing, error: userError }, { data: profile, error: profileError }] =
      await Promise.all([
        admin.auth.admin.getUserById(input.profileId),
        admin.from("profiles").select("role").eq("id", input.profileId).maybeSingle(),
      ]);
    if (userError || profileError || !existing.user) return "failed";
    const authRole = existing.user.app_metadata?.role as string | null | undefined;
    if (
      !["tenant", null, undefined].includes(authRole) ||
      (profile?.role != null && String(profile.role) !== "tenant")
    ) {
      return "not_tenant";
    }
    const tenancies = await tenanciesForProfile(admin, input.profileId);
    if (tenancies.some(isCurrentTenancy)) return "kept_for_current_tenancy";

    const { error: banError } = await admin.auth.admin.updateUserById(
      input.profileId,
      {
        ban_duration: CHECKOUT_BAN_DURATION,
        user_metadata: {
          ...(existing.user.user_metadata ?? {}),
          checkout_login_revoked_at: new Date().toISOString(),
          checkout_login_revoked_source: input.reason,
          checkout_login_revoked_tenancy_id: input.tenancyId ?? null,
        },
      },
    );
    if (banError) {
      console.error("Tenant login could not be disabled.", {
        profileId: input.profileId,
        banError,
      });
      return "failed";
    }
    await revokeSessions(admin, input.profileId);
    return "revoked";
  } catch (error) {
    console.error("Tenant login revoke failed.", { profileId: input.profileId, error });
    return "failed";
  }
}

/** Move-in again: lift the checkout ban once a current tenancy exists. */
export async function restoreTenantLoginIfCurrent(
  profileId: string | null,
): Promise<TenantLoginRestoreStatus> {
  if (!profileId) return "not_tenant";
  try {
    const admin = createAdminClient();
    const { data: existing, error } = await admin.auth.admin.getUserById(profileId);
    if (error || !existing.user) return "failed";
    const authRole = existing.user.app_metadata?.role as string | null | undefined;
    if (!["tenant", null, undefined].includes(authRole)) return "not_tenant";
    const bannedUntil = (existing.user as { banned_until?: string | null }).banned_until;
    if (!isBannedNow(bannedUntil)) return "not_banned";
    const tenancies = await tenanciesForProfile(admin, profileId);
    if (!tenancies.some(isCurrentTenancy)) return "no_current_tenancy";
    // Auth merges user_metadata, so clear the revoke marker with nulls.
    const { error: unbanError } = await admin.auth.admin.updateUserById(profileId, {
      ban_duration: "none",
      user_metadata: {
        ...(existing.user.user_metadata ?? {}),
        checkout_login_revoked_at: null,
        checkout_login_revoked_source: null,
        checkout_login_revoked_tenancy_id: null,
        checkout_login_restored_at: new Date().toISOString(),
      },
    });
    if (unbanError) {
      console.error("Tenant login could not be restored.", { profileId, unbanError });
      return "failed";
    }
    return "restored";
  } catch (error) {
    console.error("Tenant login restore failed.", { profileId, error });
    return "failed";
  }
}
