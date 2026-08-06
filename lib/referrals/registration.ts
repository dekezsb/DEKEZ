import "server-only";

import { normalizeInternationalPhone } from "@/lib/auth/phone";
import { createAdminClient } from "@/lib/supabase/admin";

type ReferralValidationInput = {
  companyId: string;
  contractDurationMonths: number;
  identityNumber: string;
  newTenantPhone: string;
  referralInput: string;
  rentalModel: "tenancy" | "monthly_stay";
};

export type ValidatedReferral = {
  promotionId: string;
  referralCode: string;
  referrerTenantId: string;
  rewardAmount: number;
};

function normalizedIdentity(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export async function validateReferralRegistration(
  input: ReferralValidationInput,
): Promise<ValidatedReferral> {
  const admin = createAdminClient();
  const campaignDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { data: promotion } = await admin
    .from("referral_promotions")
    .select("id, reward_amount, minimum_contract_months")
    .eq("company_id", input.companyId)
    .eq("enabled", true)
    .lte("start_date", campaignDate)
    .gte("end_date", campaignDate)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!promotion) {
    throw new Error("This referral promotion is not currently active.");
  }

  if (
    input.rentalModel !== "tenancy" ||
    input.contractDurationMonths < Number(promotion.minimum_contract_months)
  ) {
    throw new Error(
      `This referral requires a minimum ${promotion.minimum_contract_months}-month tenancy agreement.`,
    );
  }

  const referralText = input.referralInput.trim();
  let referrerTenantId: string | null = null;
  let referralCode: string | null = null;

  const { data: codeRecord } = await admin
    .from("tenant_referral_codes")
    .select("tenant_id, referral_code")
    .eq("company_id", input.companyId)
    .ilike("referral_code", referralText)
    .maybeSingle();

  if (codeRecord) {
    referrerTenantId = codeRecord.tenant_id;
    referralCode = codeRecord.referral_code;
  } else {
    const referralPhone = normalizeInternationalPhone(referralText);
    if (!referralPhone) {
      throw new Error("Enter a valid referrer's phone number.");
    }

    const { data: referrerProfile } = await admin
      .from("profiles")
      .select("id")
      .in("normalized_phone", referralPhone.lookupDigits)
      .limit(1)
      .maybeSingle();

    if (referrerProfile) {
      const { data: referrerTenant } = await admin
        .from("tenants")
        .select("id")
        .eq("company_id", input.companyId)
        .eq("profile_id", referrerProfile.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      referrerTenantId = referrerTenant?.id ?? null;
    }

    if (referrerTenantId) {
      const { data: tenantCode } = await admin
        .from("tenant_referral_codes")
        .select("referral_code")
        .eq("tenant_id", referrerTenantId)
        .maybeSingle();
      referralCode = tenantCode?.referral_code ?? referralText;
    }
  }

  if (!referrerTenantId || !referralCode) {
    throw new Error("The referring tenant could not be found.");
  }

  const { data: referrer } = await admin
    .from("tenants")
    .select("id, profile_id, phone, identity_number")
    .eq("id", referrerTenantId)
    .eq("company_id", input.companyId)
    .eq("status", "active")
    .maybeSingle();

  if (!referrer?.profile_id) {
    throw new Error("The referring tenant is not currently eligible.");
  }

  const { data: activeTenancy } = await admin
    .from("tenancies")
    .select("id")
    .eq("tenant_id", referrer.id)
    .eq("status", "active")
    .eq("billing_status", "active")
    .eq("rental_model", "tenancy")
    .is("checkout_date", null)
    .limit(1)
    .maybeSingle();

  if (!activeTenancy) {
    throw new Error("The referring tenant is not currently checked in.");
  }

  const newPhone = normalizeInternationalPhone(input.newTenantPhone);
  const referrerPhone = normalizeInternationalPhone(referrer.phone ?? "");
  if (newPhone && referrerPhone && newPhone.digits === referrerPhone.digits) {
    throw new Error("Self-referral using the same phone number is not allowed.");
  }

  if (
    normalizedIdentity(input.identityNumber) &&
    normalizedIdentity(input.identityNumber) ===
      normalizedIdentity(referrer.identity_number)
  ) {
    throw new Error("Self-referral using the same IC or passport is not allowed.");
  }

  return {
    promotionId: promotion.id,
    referralCode: referrer.phone?.trim() || referralCode,
    referrerTenantId,
    rewardAmount: Number(promotion.reward_amount),
  };
}
