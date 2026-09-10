"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { extendFingerprintAccessAfterPayment } from "@/lib/ttlock/fingerprint";

export async function reviewFolderSlip(id: string, bankChecked: boolean) {
  await requireRole(["super_admin", "admin"], { module: "verification", level: "manage" });
  if (bankChecked !== true) return "Check the bank transfer before verifying.";
  const actor = await getCurrentUser();
  const db = createAdminClient();
  const { data: slip } = await db.from("payment_submissions").select("property_id, rent_bill_id, payment_type, tenancy_id").eq("id", id).maybeSingle();
  if (!actor || !slip || !(await getProperties()).some((p) => p.id === slip.property_id)) throw new Error("Payment unavailable");
  const { error } = await db.rpc("verify_payment_folder_slip", { p_submission: id, p_actor: actor.id, p_decision: "verified", p_reason: null });
  if (error) return error.message.includes("exceeds balance") ? "This slip exceeds the remaining balance. Open allocation / correction review below." : "Could not verify. Check the payment status and invoice, then retry.";
  let accessWarning = false;
  if (slip.tenancy_id && slip.payment_type === "monthly_rent") {
    try { const result = await extendFingerprintAccessAfterPayment({ tenancyId: slip.tenancy_id, paymentSubmissionId: id, performedBy: actor.id }); accessWarning = result.errors.length > 0; }
    catch { accessWarning = true; }
  }
  for (const path of ["/verification", "/payment-verification", "/rent-due-tracker", "/dashboard", "/payments"]) revalidatePath(path);
  return accessWarning ? "Payment verified once. Door-access updating needs attention; do not verify the payment again." : "Verified — this slip has been counted once.";
}
