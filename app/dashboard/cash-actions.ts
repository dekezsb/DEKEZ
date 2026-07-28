"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCompanyCashInHand } from "@/lib/data/cash-management";
import { getCurrentUser, getUserCompanies } from "@/lib/data/organization";
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

async function requireCashAdmin() {
  await requireRole(["super_admin", "admin"], {
    module: "payments",
    level: "manage",
  });
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  return user;
}

export async function recordCashBankIn(formData: FormData) {
  const user = await requireCashAdmin();
  const companyId = textValue(formData, "companyId");
  const amount = Number(textValue(formData, "amount"));
  const bankedOn = textValue(formData, "bankedOn");
  const bankName = textValue(formData, "bankName");
  const referenceNumber = textValue(formData, "referenceNumber");
  const notes = textValue(formData, "notes");

  if (
    !companyId
    || !Number.isFinite(amount)
    || amount <= 0
    || !bankedOn
    || (!referenceNumber && !notes)
  ) {
    redirect("/dashboard?cash_error=missing");
  }

  const companies = await getUserCompanies();
  if (!companies.some((company) => company.id === companyId)) {
    redirect("/dashboard?cash_error=company");
  }

  const companyCash = await getCompanyCashInHand(companyId);
  if (!companyCash || amount > companyCash.cashInHand + 0.005) {
    redirect("/dashboard?cash_error=amount");
  }

  const supabase = await getAdmin();
  const { error } = await supabase.from("cash_bank_ins").insert({
    company_id: companyId,
    amount,
    banked_on: bankedOn,
    bank_name: bankName || null,
    reference_number: referenceNumber || null,
    notes: notes || null,
    status: "completed",
    recorded_by: user.id,
  });

  if (error) {
    redirect(
      `/dashboard?cash_error=${error.code === "23505" ? "duplicate" : "save"}`,
    );
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?cash_saved=1");
}

export async function cancelCashBankIn(formData: FormData) {
  const user = await requireCashAdmin();
  const bankInId = textValue(formData, "bankInId");
  const reason = textValue(formData, "reason");

  if (!bankInId || !reason) {
    redirect("/dashboard?cash_error=cancel_reason");
  }

  const supabase = await getAdmin();
  const { error } = await supabase
    .from("cash_bank_ins")
    .update({
      status: "cancelled",
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bankInId)
    .eq("status", "completed");

  if (error) {
    redirect("/dashboard?cash_error=cancel");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?cash_cancelled=1");
}
