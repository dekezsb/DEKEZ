"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { regenerateAllUnsignedAgreements } from "@/lib/tenancy/agreement";
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
