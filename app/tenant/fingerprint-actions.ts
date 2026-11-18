"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareFingerprintEnrollment } from "@/lib/ttlock/fingerprint";
import { hasFingerprintEnrollmentAccess } from "@/lib/ttlock/fingerprint-support";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fingerprintResult(result: string) {
  return `/dashboard?${result}`;
}

export async function requestTenantFingerprint(formData: FormData) {
  await requireRole(["tenant"], {
    module: "payments",
    level: "manage",
  });

  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  if (!user || !tenancyId) {
    redirect(fingerprintResult("fingerprint_error=invalid"));
  }

  const supabase = createAdminClient();
  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, tenant_id, property_id, room_id, status, billing_status, checkout_date, rental_model")
    .eq("id", tenancyId)
    .maybeSingle();

  if (
    !tenancy
    || tenancy.status !== "active"
    || tenancy.checkout_date
    || ["completed", "terminated"].includes(String(tenancy.billing_status))
  ) {
    redirect(fingerprintResult("fingerprint_error=tenancy"));
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, profile_id")
    .eq("id", tenancy.tenant_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!tenant) {
    redirect(fingerprintResult("fingerprint_error=access"));
  }

  const [mainResult, roomResult] = await Promise.all([
    supabase
      .from("smart_lock_devices")
      .select("access_scope,sync_status,provider,provider_data")
      .eq("provider", "ttlock")
      .eq("property_id", tenancy.property_id)
      .eq("access_scope", "property_entry"),
    supabase
      .from("smart_lock_devices")
      .select("access_scope,sync_status,provider,provider_data")
      .eq("provider", "ttlock")
      .eq("room_id", tenancy.room_id)
      .eq("access_scope", "room_entry"),
  ]);
  if (!hasFingerprintEnrollmentAccess([
    ...(mainResult.data ?? []),
    ...(roomResult.data ?? []),
  ])) {
    redirect(fingerprintResult("fingerprint_error=access"));
  }

  try {
    await prepareFingerprintEnrollment(tenancy.id, user.id, {
      notifyTenant: true,
      ignoreNotificationError: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("agreement must be signed")) {
      redirect(fingerprintResult("fingerprint_error=agreement"));
    }
    if (message.includes("phone number")) {
      redirect(fingerprintResult("fingerprint_error=phone"));
    }
    if (message.includes("already ended")) {
      redirect(fingerprintResult("fingerprint_error=ended"));
    }
    console.error("Tenant fingerprint request failed", { tenancyId, error });
    redirect(fingerprintResult("fingerprint_error=create"));
  }

  revalidatePath("/dashboard");
  redirect(fingerprintResult("fingerprint_requested=1"));
}
