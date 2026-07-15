"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export async function reviewTenantApplication(formData: FormData) {
  await requireRole(["super_admin", "admin"]);
  const user = await getCurrentUser();
  const applicationId = textValue(formData, "applicationId");
  const decision = textValue(formData, "decision");
  const notes = textValue(formData, "notes");

  if (!user || !applicationId || !["verified", "rejected", "more_information_required"].includes(decision)) {
    redirect("/tenant-verification?error=missing");
  }

  const supabase = await getAdmin();
  const status = decision === "verified" ? "approved" : decision === "rejected" ? "rejected" : "pending_verification";

  const { data: application, error } = await supabase
    .from("tenant_applications")
    .update({
      verification_status: decision,
      status,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      admin_notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .select("tenant_id")
    .single();

  if (error || !application) {
    redirect("/tenant-verification?error=review");
  }

  await supabase.from("tenant_verifications").insert({
    tenant_application_id: applicationId,
    tenant_id: application.tenant_id,
    status: decision,
    notes: notes || null,
    reviewed_by: user.id,
  });

  await supabase
    .from("tenant_documents")
    .update({ verification_status: decision })
    .eq("tenant_application_id", applicationId);

  revalidatePath("/tenant-verification");
  revalidatePath("/onboarding");
  redirect("/tenant-verification?reviewed=1");
}
