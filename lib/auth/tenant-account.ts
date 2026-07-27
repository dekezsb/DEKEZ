import "server-only";

import { normalizeInternationalPhone } from "@/lib/auth/phone";
import {
  derivePinPassword,
  phoneAuthAlias,
  phoneRateLimitKey,
} from "@/lib/auth/registration";
import { createAdminClient } from "@/lib/supabase/admin";

type ActivationResult =
  | { ok: true; profileId: string; reset: boolean }
  | {
      ok: false;
      reason:
        | "auth"
        | "conflict"
        | "missing"
        | "phone"
        | "profile"
        | "tenant";
    };

export async function activateTenantAccount(
  tenantId: string,
  reviewedBy: string | null,
): Promise<ActivationResult> {
  const admin = createAdminClient();
  const { data: requestedTenant } = await admin
    .from("tenants")
    .select(
      "id, company_id, profile_id, full_name, phone, identity_number, status",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (!requestedTenant) {
    return { ok: false, reason: "missing" };
  }

  const phone = normalizeInternationalPhone(requestedTenant.phone ?? "");
  if (!phone) {
    return { ok: false, reason: "phone" };
  }

  const password = derivePinPassword(phone);
  if (!password) {
    return { ok: false, reason: "auth" };
  }

  const { data: matchingProfiles, error: profileLookupError } = await admin
    .from("profiles")
    .select("id, role")
    .in("normalized_phone", phone.lookupDigits);
  if (profileLookupError || (matchingProfiles?.length ?? 0) > 1) {
    return { ok: false, reason: "conflict" };
  }

  const linkedProfileId =
    requestedTenant.profile_id ?? matchingProfiles?.[0]?.id ?? null;
  if (
    requestedTenant.profile_id &&
    matchingProfiles?.[0]?.id &&
    requestedTenant.profile_id !== matchingProfiles[0].id
  ) {
    return { ok: false, reason: "conflict" };
  }
  let profileId = linkedProfileId;
  let reset = Boolean(linkedProfileId);
  let createdNewUser = false;

  if (profileId) {
    const { data: existingUser, error: existingUserError } =
      await admin.auth.admin.getUserById(profileId);
    if (
      existingUserError ||
      !existingUser.user ||
      !["tenant", null, undefined].includes(
        existingUser.user.app_metadata?.role as string | null | undefined,
      )
    ) {
      return { ok: false, reason: "conflict" };
    }

    const { error: updateAuthError } =
      await admin.auth.admin.updateUserById(profileId, {
        password,
        app_metadata: {
          ...(existingUser.user.app_metadata ?? {}),
          role: "tenant",
        },
        user_metadata: {
          ...(existingUser.user.user_metadata ?? {}),
          full_name: requestedTenant.full_name,
          phone: phone.e164,
        },
        ban_duration: "none",
      });
    if (updateAuthError) {
      return { ok: false, reason: "auth" };
    }
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: phoneAuthAlias(phone),
        email_confirm: true,
        password,
        app_metadata: { role: "tenant" },
        user_metadata: {
          full_name: requestedTenant.full_name,
          phone: phone.e164,
        },
      });
    if (createError || !created.user) {
      return { ok: false, reason: "auth" };
    }
    profileId = created.user.id;
    reset = false;
    createdNewUser = true;
  }

  const now = new Date().toISOString();
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: requestedTenant.full_name,
      phone: phone.e164,
      normalized_phone: phone.digits,
      identity_number: requestedTenant.identity_number,
      role: "tenant",
      global_role: "tenant",
      requested_role: "tenant",
      registration_status: "approved",
      registration_reviewed_by: reviewedBy,
      registration_reviewed_at: now,
      registration_rejection_reason: null,
      registration_completed_at: now,
      updated_at: now,
    })
    .eq("id", profileId);
  if (profileError) {
    if (createdNewUser) {
      await admin.auth.admin.deleteUser(profileId);
    }
    return { ok: false, reason: "profile" };
  }

  const { data: matchingTenants, error: tenantLookupError } = await admin
    .from("tenants")
    .select("id, phone")
    .eq("company_id", requestedTenant.company_id);
  if (tenantLookupError) {
    return { ok: false, reason: "tenant" };
  }

  const tenantIds = (matchingTenants ?? [])
    .filter((tenant) => {
      const candidate = normalizeInternationalPhone(tenant.phone ?? "");
      return candidate?.digits === phone.digits;
    })
    .map((tenant) => tenant.id);

  const { error: tenantUpdateError } = await admin
    .from("tenants")
    .update({
      profile_id: profileId,
      phone: phone.e164,
      updated_at: now,
    })
    .in("id", tenantIds.length ? tenantIds : [requestedTenant.id]);
  if (tenantUpdateError) {
    return { ok: false, reason: "tenant" };
  }

  await admin
    .from("auth_login_rate_limits")
    .delete()
    .eq("phone_hash", phoneRateLimitKey(phone));

  return { ok: true, profileId, reset };
}
