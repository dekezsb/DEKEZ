"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveReferralPromotion(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const promotionId = text(formData, "promotionId");
  const companyId = text(formData, "companyId");
  const promotionName = text(formData, "promotionName");
  const rewardAmount = Number(text(formData, "rewardAmount"));
  const minimumContractMonths = Number(text(formData, "minimumContractMonths"));
  const startDate = text(formData, "startDate");
  const endDate = text(formData, "endDate");
  const enabled = formData.get("enabled") === "on";

  if (
    !user ||
    !companyId ||
    !promotionName ||
    !Number.isFinite(rewardAmount) ||
    rewardAmount <= 0 ||
    !Number.isInteger(minimumContractMonths) ||
    minimumContractMonths < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
    endDate < startDate
  ) {
    redirect("/referrals?error=settings_invalid");
  }

  const admin = createAdminClient();
  const values = {
    company_id: companyId,
    promotion_name: promotionName,
    reward_amount: rewardAmount,
    minimum_contract_months: minimumContractMonths,
    start_date: startDate,
    end_date: endDate,
    enabled,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const result = promotionId
    ? await admin.from("referral_promotions").update(values).eq("id", promotionId)
    : await admin.from("referral_promotions").insert({
        ...values,
        created_by: user.id,
      });

  if (result.error) {
    redirect("/referrals?error=settings_save");
  }

  revalidatePath("/referrals");
  revalidatePath("/dashboard");
  redirect("/referrals?saved=1");
}

export async function recheckReferral(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const referralId = text(formData, "referralId");
  if (!user || !referralId) redirect("/referrals?error=referral_missing");

  const { error } = await createAdminClient().rpc("recheck_tenant_referral", {
    p_actor_id: user.id,
    p_referral_id: referralId,
  });
  if (error) redirect("/referrals?error=recheck_failed");

  revalidatePath("/referrals");
  revalidatePath("/dashboard");
  redirect("/referrals?checked=1");
}

export async function rejectReferral(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "verification",
    level: "manage",
  });
  const user = await getCurrentUser();
  const referralId = text(formData, "referralId");
  const reason = text(formData, "reason");
  if (!user || !referralId || !reason) {
    redirect("/referrals?error=reject_reason");
  }

  const { error } = await createAdminClient().rpc("reject_tenant_referral", {
    p_actor_id: user.id,
    p_reason: reason,
    p_referral_id: referralId,
  });
  if (error) redirect("/referrals?error=reject_failed");

  revalidatePath("/referrals");
  revalidatePath("/dashboard");
  redirect("/referrals?rejected=1");
}
