"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { convertTenantApplication } from "@/lib/tenancy/convert-application";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function returnPath(formData: FormData) {
  return textValue(formData, "returnTo") === "/verification?view=tenants"
    ? "/verification?view=tenants"
    : "/tenant-verification";
}

function withResult(path: string, result: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${result}`;
}

async function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    return createClient();
  }
}

export async function reviewTenantApplication(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const applicationId = textValue(formData, "applicationId");
  const decision = textValue(formData, "decision");
  const notes = textValue(formData, "notes");
  const returnTo = returnPath(formData);

  if (!user || !applicationId || !["verified", "rejected", "more_information_required"].includes(decision)) {
    redirect(withResult(returnTo, "error=missing"));
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
    .select("tenant_id, room_id, submission_source")
    .single();

  if (error || !application) {
    redirect(withResult(returnTo, "error=review"));
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

  if (
    decision === "verified" &&
    ["admin_assisted", "self_registration"].includes(
      application.submission_source,
    )
  ) {
    const conversion = await convertTenantApplication(supabase, {
      actorId: user.id,
      applicationId,
    });

    if (!conversion.ok) {
      await Promise.all([
        supabase
          .from("tenant_applications")
          .update({
            verification_status: "pending_verification",
            status: "submitted",
            reviewed_by: null,
            reviewed_at: null,
            admin_notes: `Approval could not be completed: ${conversion.reason}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", applicationId),
        supabase
          .from("tenant_documents")
          .update({ verification_status: "pending_verification" })
          .eq("tenant_application_id", applicationId),
      ]);
      redirect(withResult(returnTo, "error=conversion"));
    }

    if (
      application.submission_source === "self_registration" &&
      application.tenant_id
    ) {
      const { data: authUser } = await supabase.auth.admin.getUserById(
        application.tenant_id,
      );
      const [{ error: profileError }, { error: authError }] = await Promise.all([
        supabase
          .from("profiles")
          .update({
            role: "tenant",
            global_role: "tenant",
            registration_status: "approved",
            registration_reviewed_by: user.id,
            registration_reviewed_at: new Date().toISOString(),
            registration_rejection_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", application.tenant_id),
        supabase.auth.admin.updateUserById(application.tenant_id, {
          app_metadata: {
            ...(authUser.user?.app_metadata ?? {}),
            role: "tenant",
          },
        }),
      ]);

      if (profileError || authError) {
        redirect(withResult(returnTo, "error=review"));
      }
    }
  } else if (decision === "verified" && application.room_id) {
    await supabase
      .from("rooms")
      .update({ status: "reserved", updated_at: new Date().toISOString() })
      .eq("id", application.room_id)
      .eq("status", "vacant");
  }

  if (decision === "rejected" && application.room_id) {
    const { data: competingApplications } = await supabase
      .from("tenant_applications")
      .select("id")
      .eq("room_id", application.room_id)
      .neq("id", applicationId)
      .in("verification_status", ["verified", "pending_verification"])
      .limit(1);
    const { data: activeTenancy } = await supabase
      .from("tenancies")
      .select("id")
      .eq("room_id", application.room_id)
      .eq("status", "active")
      .limit(1);

    if (!competingApplications?.length && !activeTenancy?.length) {
      await supabase
        .from("rooms")
        .update({ status: "vacant", updated_at: new Date().toISOString() })
        .eq("id", application.room_id)
        .eq("status", "reserved");
    }
  }

  if (
    application.submission_source === "self_registration" &&
    application.tenant_id &&
    decision === "rejected"
  ) {
    await supabase
      .from("profiles")
      .update({
        registration_status: "rejected",
        registration_reviewed_by: user.id,
        registration_reviewed_at: new Date().toISOString(),
        registration_rejection_reason: notes || "Tenant registration rejected",
        updated_at: new Date().toISOString(),
      })
      .eq("id", application.tenant_id);
  }

  revalidatePath("/tenant-verification");
  revalidatePath("/verification");
  revalidatePath("/onboarding");
  revalidatePath("/properties");
  revalidatePath("/e-tenancy");
  revalidatePath("/registration-status");
  redirect(withResult(returnTo, "reviewed=1"));
}
