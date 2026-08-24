"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserAccess, requireRole } from "@/lib/auth/session";
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
  redirect("/dashboard?checkout_saved=1");
}
