"use server";

import { requireRole } from "@/lib/auth/session";
import { normalizeInternationalPhone } from "@/lib/auth/phone";
import { phoneAuthAlias } from "@/lib/auth/registration";
import { previewPassword } from "@/lib/marketplace/preview-credential";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PreviewLoginState = { status: "idle" | "success" | "error"; message: string };

export async function createPreviewLogin(_previous: PreviewLoginState, form: FormData): Promise<PreviewLoginState> {
  await requireRole(["super_admin"], { module: "admin_setup", level: "manage" });
  const session = await createClient();
  const { data: sessionData, error: sessionError } = await session.auth.getUser();
  if (sessionError || !sessionData.user) return { status: "error", message: "Please sign in again before creating a test account." };
  const phone = normalizeInternationalPhone(String(form.get("phone") ?? ""));
  const password = String(form.get("password") ?? "");
  if (!phone || !/^\+601\d{8,9}$/.test(phone.e164) || password.length < 5 || password.length > 128 || form.get("confirm") !== "yes")
    return { status: "error", message: "Enter a Malaysian phone number, a temporary password of at least 5 characters, and confirm restricted preview access." };
  let createdId: string | null = null;
  try {
    const admin = createAdminClient();
    const existing = await admin.from("profiles").select("id").in("normalized_phone", phone.lookupDigits);
    if (existing.error) return { status: "error", message: "Unable to check this number. Please try again later." };
    if (existing.data?.length) return { status: "error", message: "This number already has an account. No account or password has been changed." };
    const derived = previewPassword(phone, password);
    if (!derived) return { status: "error", message: "Please enter a valid temporary password." };
    const created = await admin.auth.admin.createUser({
      email: phoneAuthAlias(phone), email_confirm: true, password: derived, ban_duration: "876000h",
      app_metadata: { role: "contractor_preview", pilot_provisioning: true },
      user_metadata: { full_name: "Contractor Test Preview" },
    });
    if (created.error || !created.data.user) return { status: "error", message: "Unable to create a new test account. The number may already be registered. Existing accounts remain unchanged." };
    createdId = created.data.user.id;
    const finalized = await admin.rpc("finalize_contractor_preview", { p_id: createdId, p_phone: phone.e164 });
    if (finalized.error) throw new Error("finalization");
    const audit = await admin.from("audit_logs").insert({
      actor_profile_id: sessionData.user.id, action: "contractor_preview_enable_requested", entity_table: "profiles", entity_id: createdId,
      metadata: { scope: "read-only preview", source: "Super Admin confirmed form", phone_verified: false },
    });
    if (audit.error) throw new Error("audit");
    const enabled = await admin.auth.admin.updateUserById(createdId, { ban_duration: "none", app_metadata: { role: "contractor_preview", pilot_provisioning: false } });
    if (enabled.error) throw new Error("enable");
    return { status: "success", message: "Restricted test login created. Open Contractor Login in a private/incognito window and use the phone number and temporary password you just entered. No OTP is required." };
  } catch {
    return { status: "error", message: createdId ? "The new test account could not be fully enabled. Stop here and contact support to review it; existing accounts were not changed." : "Unable to create the test login. Please try again later." };
  }
}
