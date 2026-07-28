"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAgreementForTenancy } from "@/lib/tenancy/agreement";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function confirmAgreementGeneration(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const tenancyId = textValue(formData, "tenancyId");
  const confirmed = textValue(formData, "confirmed");

  if (
    !user ||
    !tenancyId ||
    confirmed !== "on"
  ) {
    redirect(
      `/tenancy-agreements/preview/${encodeURIComponent(tenancyId)}?error=confirm`,
    );
  }

  const supabase = createAdminClient();
  let agreementId: string | null = null;
  try {
    agreementId = await createAgreementForTenancy(supabase, tenancyId, user.id);
  } catch (error) {
    console.error("Unable to generate tenancy agreement.", {
      tenancyId,
      error,
    });
    redirect(
      `/tenancy-agreements/preview/${encodeURIComponent(tenancyId)}?error=generation`,
    );
  }

  if (!agreementId) {
    redirect(
      `/tenancy-agreements/preview/${encodeURIComponent(tenancyId)}?error=tenancy`,
    );
  }

  revalidatePath("/verification");
  revalidatePath("/tenancy-agreements");
  revalidatePath("/e-tenancy");
  revalidatePath(`/e-tenancy/${agreementId}`);
  redirect(`/e-tenancy/${agreementId}`);
}
