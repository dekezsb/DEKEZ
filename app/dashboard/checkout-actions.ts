"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserAccess, requireRole } from "@/lib/auth/session";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import { releaseCheckedOutTenantPhone } from "@/lib/auth/release-tenant-phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentCheckoutMonth } from "@/lib/data/tenant-checkouts";
import { executeTenantCheckout } from "@/lib/tenancy/checkout";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function checkoutTenantFromManagement(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "tenant_checkout",
    level: "manage",
  });
  const { user } = await getCurrentUserAccess();
  const tenancyId = textValue(formData, "tenancyId");
  const checkoutDate = textValue(formData, "checkoutDate");
  const note = textValue(formData, "note").slice(0, 500);
  const confirmed = textValue(formData, "confirmed") === "yes";

  if (!confirmed || !tenancyId || !checkoutDate) {
    redirect("/dashboard?checkout_error=confirm");
  }

  const result = await executeTenantCheckout({
    actorProfileId: user.id,
    checkoutDate,
    note,
    source: "management_portal",
    tenancyId,
  });

  if (!result.ok) {
    redirect(`/dashboard?checkout_error=${result.reason}`);
  }

  revalidatePath("/dashboard");
  revalidatePath("/properties");
  revalidatePath(`/properties/${result.propertyId}`);
  revalidatePath(`/properties/${result.propertyId}/rooms/${result.roomId}`);
  revalidatePath("/tenants");
  revalidatePath("/verification");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/payments");
  redirect(
    `/dashboard?checkout_saved=1&phone_release=${result.phoneLoginRelease}`,
  );
}

export async function releaseHistoricalTenantPhone(formData: FormData) {
  await requireRole(["super_admin"]);
  const { user } = await getCurrentUserAccess();
  const tenancyId = textValue(formData, "tenancyId");
  const checkoutMonth = textValue(formData, "checkoutMonth");
  const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(checkoutMonth)
    ? checkoutMonth
    : currentCheckoutMonth();
  const returnPath = `/dashboard?checkoutMonth=${selectedMonth}`;

  if (!tenancyId) {
    redirect(`${returnPath}&phone_release_error=invalid`);
  }

  const admin = createAdminClient();
  const { data: tenancy, error: tenancyError } = await admin
    .from("tenancies")
    .select(
      "id,company_id,tenant_id,status,checkout_date,tenants(full_name,phone,profile_id)",
    )
    .eq("id", tenancyId)
    .neq("status", "active")
    .not("checkout_date", "is", null)
    .maybeSingle();
  const tenantRelation = tenancy?.tenants;
  const tenant = Array.isArray(tenantRelation)
    ? tenantRelation[0]
    : tenantRelation;

  if (tenancyError || !tenancy || !tenant) {
    redirect(`${returnPath}&phone_release_error=invalid`);
  }

  const originalPhone = tenant.phone;
  const result = await releaseCheckedOutTenantPhone({
    phone: normalizeInternationalPhone(originalPhone ?? ""),
    profileId: tenant.profile_id,
    tenancyId: tenancy.id,
    tenantId: tenancy.tenant_id,
  });

  if (result === "failed" || result === "kept_for_active_tenancy") {
    redirect(`${returnPath}&phone_release_error=${result}`);
  }

  await admin.from("audit_logs").insert({
    company_id: tenancy.company_id,
    actor_profile_id: user.id,
    action: "tenant_phone_login_released",
    entity_table: "tenancies",
    entity_id: tenancy.id,
    metadata: {
      tenant_id: tenancy.tenant_id,
      tenant_name: tenant.full_name,
      tenant_phone: originalPhone,
      source: "super_admin_repair",
      release_status: result,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/register-tenant");
  revalidatePath("/register");
  redirect(`${returnPath}&phone_release_fixed=1`);
}
