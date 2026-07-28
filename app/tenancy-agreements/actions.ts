"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { regenerateAllUnsignedAgreements } from "@/lib/tenancy/agreement";

export async function regenerateMasterAgreementArchive() {
  await requireRole(["super_admin", "admin"], {
    module: "tenancy_agreements",
    level: "manage",
  });
  const user = await getCurrentUser();
  if (!user) {
    redirect("/");
  }

  const result = await regenerateAllUnsignedAgreements(
    createAdminClient(),
    user.id,
  );

  revalidatePath("/tenancy-agreements");
  revalidatePath("/verification");
  revalidatePath("/properties");
  revalidatePath("/e-tenancy");

  const query = new URLSearchParams({
    regenerated: String(result.regenerated),
    skipped: String(result.skipped),
    errors: String(result.errors.length),
  });
  if (result.errors[0]?.message) {
    query.set("detail", result.errors[0].message.slice(0, 300));
  }
  redirect(`/tenancy-agreements?${query.toString()}`);
}
