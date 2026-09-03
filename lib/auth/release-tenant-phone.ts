import "server-only";

import { phoneRateLimitKey } from "@/lib/auth/registration";
import type { InternationalPhone } from "@/lib/auth/phone";
import { createAdminClient } from "@/lib/supabase/admin";

export type TenantPhoneReleaseStatus =
  | "released"
  | "not_linked"
  | "kept_for_active_tenancy"
  | "failed";

function archivedEmail(profileId: string) {
  return `checked-out-${profileId}@auth.dekez.invalid`;
}

export async function releaseCheckedOutTenantPhone({
  phone,
  profileId,
  tenancyId,
  tenantId,
}: {
  phone: InternationalPhone | null;
  profileId: string | null;
  tenancyId: string;
  tenantId: string;
}): Promise<TenantPhoneReleaseStatus> {
  if (!profileId) {
    return "not_linked";
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } =
    await admin.auth.admin.getUserById(profileId);

  if (
    existingError ||
    !existing.user ||
    !["tenant", null, undefined].includes(
      existing.user.app_metadata?.role as string | null | undefined,
    )
  ) {
    console.error("Checked-out tenant login could not be inspected.", {
      profileId,
      tenancyId,
      existingError,
    });
    return "failed";
  }

  const releasedAt = new Date().toISOString();
  const previousEmail = existing.user.email;
  const previousMetadata = existing.user.user_metadata ?? {};
  const { error: archiveError } = await admin.auth.admin.updateUserById(
    profileId,
    {
      email: archivedEmail(profileId),
      email_confirm: true,
      ban_duration: "876000h",
      user_metadata: {
        ...previousMetadata,
        phone: null,
        checkout_login_released_at: releasedAt,
      },
    },
  );

  if (archiveError) {
    console.error("Checked-out tenant login could not be archived.", {
      profileId,
      tenancyId,
      archiveError,
    });
    return "failed";
  }

  const { data: released, error: releaseError } = await admin.rpc(
    "release_checked_out_tenant_phone_login",
    {
      p_profile_id: profileId,
      p_released_at: releasedAt,
      p_tenancy_id: tenancyId,
      p_tenant_id: tenantId,
    },
  );
  const releaseStatus = typeof released === "string" ? released : null;

  if (releaseError || releaseStatus !== "released") {
    const rollbackAttributes = {
      ban_duration: "none",
      user_metadata: previousMetadata,
      ...(previousEmail
        ? { email: previousEmail, email_confirm: true }
        : {}),
    };
    const { error: rollbackError } =
      await admin.auth.admin.updateUserById(profileId, rollbackAttributes);

    console.error("Checked-out tenant phone release was rolled back.", {
      profileId,
      tenancyId,
      releaseError,
      releaseStatus,
      rollbackError,
    });
    return releaseStatus === "active_tenancy"
      ? "kept_for_active_tenancy"
      : "failed";
  }

  if (phone) {
    const { error: rateLimitError } = await admin
      .from("auth_login_rate_limits")
      .delete()
      .eq("phone_hash", phoneRateLimitKey(phone));
    if (rateLimitError) {
      console.error("Released tenant phone rate-limit cleanup failed.", {
        profileId,
        tenancyId,
        rateLimitError,
      });
    }
  }

  return "released";
}
