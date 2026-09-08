"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  malaysiaToday,
  regenerateAllUnsignedAgreements,
  renderSignedAgreementReplacement,
} from "@/lib/tenancy/agreement";
import { commercialDepositSchedule } from "@/lib/tenancy/commercial-deposit-policy";
import { sendAgreementRequest } from "@/lib/tenancy/agreement-whatsapp";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

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

export async function deleteWrongUnsignedAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "tenancy_agreements",
    level: "manage",
  });
  const user = await getCurrentUser();
  if (!user) {
    redirect("/");
  }

  const agreementId = textValue(formData, "agreementId");
  const reason =
    textValue(formData, "reason") ||
    "Wrong unsigned agreement removed by Admin";
  if (!agreementId) {
    redirect("/tenancy-agreements?deleteError=missing");
  }

  const admin = createAdminClient();
  const { data: agreement, error: agreementError } = await admin
    .from("tenancy_agreements")
    .select("*")
    .eq("id", agreementId)
    .maybeSingle();

  if (agreementError || !agreement) {
    console.error("Unable to find agreement for deletion.", {
      agreementId,
      message: agreementError?.message,
    });
    redirect("/tenancy-agreements?deleteError=not_found");
  }

  if (
    agreement.signed_at ||
    ["signed", "renewal_signed"].includes(String(agreement.status))
  ) {
    redirect("/tenancy-agreements?deleteError=signed");
  }

  const { count: signatureCount, error: signatureError } = await admin
    .from("tenancy_agreement_signatures")
    .select("id", { count: "exact", head: true })
    .eq("agreement_id", agreementId);

  if (signatureError || (signatureCount ?? 0) > 0) {
    console.error("Agreement deletion blocked by signature check.", {
      agreementId,
      message: signatureError?.message,
      signatureCount,
    });
    redirect("/tenancy-agreements?deleteError=signed");
  }

  const { error: logError } = await admin
    .from("tenancy_agreement_deletion_logs")
    .insert({
      agreement_id: agreement.id,
      tenancy_id: agreement.tenancy_id,
      performed_by: user.id,
      reason,
      original_agreement: agreement,
    });

  if (logError) {
    console.error("Unable to record agreement deletion.", {
      agreementId,
      message: logError.message,
    });
    redirect("/tenancy-agreements?deleteError=audit");
  }

  const { error: deleteError } = await admin
    .from("tenancy_agreements")
    .delete()
    .eq("id", agreementId);

  if (deleteError) {
    console.error("Unable to delete wrong unsigned agreement.", {
      agreementId,
      message: deleteError.message,
    });
    redirect("/tenancy-agreements?deleteError=failed");
  }

  revalidatePath("/tenancy-agreements");
  revalidatePath("/e-tenancy");
  revalidatePath("/tenant");
  revalidatePath("/dashboard");
  redirect("/tenancy-agreements?deleted=1");
}

export async function issueCorrectedCommercialAgreement(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "tenancy_agreements",
    level: "manage",
  });
  const user = await getCurrentUser();
  const agreementId = textValue(formData, "agreementId");
  if (!user || !agreementId) {
    redirect("/tenancy-agreements?correctionError=missing");
  }

  const admin = createAdminClient();
  const { data: source, error: sourceError } = await admin
    .from("tenancy_agreements")
    .select(
      "id, tenancy_id, term_type, term_start_date, term_end_date, version_number, monthly_rent_snapshot, agreement_type, status, signed_at, admin_rejected_at, replacement_agreement_id, is_correction",
    )
    .eq("id", agreementId)
    .maybeSingle();

  if (sourceError || !source) {
    redirect("/tenancy-agreements?correctionError=not_found");
  }
  if (source.replacement_agreement_id) {
    redirect(`/e-tenancy/${source.replacement_agreement_id}?corrected=1`);
  }
  if (
    source.agreement_type !== "commercial_office" ||
    source.is_correction ||
    !source.signed_at ||
    !["signed", "renewal_signed"].includes(source.status) ||
    source.admin_rejected_at
  ) {
    redirect(`/e-tenancy/${source.id}?correctionError=unavailable`);
  }

  const { data: tenancy } = await admin
    .from("tenancies")
    .select("id, status, checkout_date, properties(is_commercial)")
    .eq("id", source.tenancy_id)
    .maybeSingle();
  const property = Array.isArray(tenancy?.properties)
    ? tenancy.properties[0]
    : tenancy?.properties;
  const today = malaysiaToday();
  if (
    !tenancy ||
    tenancy.status !== "active" ||
    tenancy.checkout_date ||
    !property?.is_commercial ||
    !source.term_start_date ||
    !source.term_end_date ||
    source.term_start_date > today ||
    source.term_end_date < today
  ) {
    redirect(`/e-tenancy/${source.id}?correctionError=not_current`);
  }

  if (source.term_type === "renewal") {
    const { data: currentRenewal } = await admin
      .from("tenancy_renewals")
      .select("id")
      .eq("tenancy_id", source.tenancy_id)
      .eq("new_agreement_id", source.id)
      .maybeSingle();
    if (!currentRenewal) {
      redirect(`/e-tenancy/${source.id}?correctionError=not_current`);
    }
  }

  let replacement;
  try {
    replacement = await renderSignedAgreementReplacement(
      admin,
      source.id,
      user.id,
    );
  } catch (error) {
    console.error("Unable to render the corrected commercial agreement.", {
      agreementId: source.id,
      error: error instanceof Error ? error.message : String(error),
    });
    redirect(`/e-tenancy/${source.id}?correctionError=render`);
  }

  if (replacement.agreementType !== "commercial_office") {
    redirect(`/e-tenancy/${source.id}?correctionError=classification`);
  }

  const monthlyRent = Number(source.monthly_rent_snapshot ?? 0);
  const deposits = commercialDepositSchedule(monthlyRent);
  const amount = (value: number) =>
    new Intl.NumberFormat("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  const reason = `Correct and restate the commercial office agreement with Security Deposit RM ${amount(
    deposits.securityDeposit,
  )} (two months), Utility Deposit RM ${amount(
    deposits.utilityDeposit,
  )} (one-half month), and Total Deposit RM ${amount(deposits.totalDeposit)}.`;
  const { data: replacementId, error: replacementError } = await admin.rpc(
    "issue_corrected_commercial_agreement",
    {
      source_agreement_id: source.id,
      correction_reason: reason,
      replacement_rendered_content: replacement.renderedContent,
      replacement_template_id: replacement.templateId,
      performed_by_user_id: user.id,
    },
  );

  if (replacementError || typeof replacementId !== "string") {
    console.error("Unable to issue the corrected commercial agreement.", {
      agreementId: source.id,
      error: replacementError?.message,
    });
    redirect(`/e-tenancy/${source.id}?correctionError=save`);
  }

  revalidatePath("/tenancy-agreements");
  revalidatePath("/verification");
  revalidatePath("/e-tenancy");
  revalidatePath(`/e-tenancy/${source.id}`);
  revalidatePath(`/e-tenancy/${replacementId}`);
  redirect(`/e-tenancy/${replacementId}?corrected=1`);
}

export async function sendRenewalWhatsAppReminder(formData: FormData) {
  await requireRole(["super_admin", "admin"], {
    module: "tenancy_agreements",
    level: "manage",
  });

  const agreementId = textValue(formData, "agreementId");
  if (!agreementId) {
    redirect(
      "/tenancy-agreements?reminder=invalid#renewal-signature-reminders",
    );
  }

  const result = await sendAgreementRequest(
    createAdminClient(),
    agreementId,
    { renewalOnly: true },
  );

  revalidatePath("/tenancy-agreements");
  revalidatePath("/verification");
  revalidatePath("/dashboard");
  revalidatePath("/e-tenancy");
  revalidatePath(`/e-tenancy/${agreementId}`);

  redirect(
    `/tenancy-agreements?reminder=${result.status}#renewal-signature-reminders`,
  );
}
