"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { bankReferenceError, usableBankReference } from "@/lib/payments/verification-row";

// Reference-only action: deliberately never calls verification or inserts a payment.
export async function savePaymentBankReference(id: string, reference: string, previous: string) {
  await requireRole(["super_admin", "admin"], { module: "verification", level: "manage" });
  if (typeof reference !== "string" || reference.length > 120 || /[\x00-\x1f\x7f]/.test(reference) || !usableBankReference(reference)) {
    return { error: "Please enter bank code." };
  }
  const actor = await getCurrentUser();
  const db = createAdminClient();
  const { data: slip, error } = await db.from("payment_submissions").select("property_id").eq("id", id).maybeSingle();
  if (error || !actor || !slip || !(await getProperties()).some(p => p.id === slip.property_id)) {
    return { error: "Payment unavailable." };
  }
  const result = await db.rpc("save_payment_bank_reference", {
    p_submission: id, p_actor: actor.id, p_reference: reference.trim(), p_previous: previous,
  });
  if (result.error) return { error: bankReferenceError(result.error.message) };
  for (const path of ["/verification", "/payment-verification", "/payments", "/reports"]) revalidatePath(path);
  return { reference: String(result.data), error: null };
}
