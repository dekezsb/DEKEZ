import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgreementArchiveItem } from "@/components/verification/agreement-archive";

type AgreementRow = Omit<
  AgreementArchiveItem,
  "tenancies" | "renewal_reminder_status" | "renewal_reminder_at"
> & {
  tenancy_id: string;
};

type TenancyRow = {
  id: string;
  status: string;
  checkout_date: string | null;
  tenants:
    | { full_name: string; phone: string | null }
    | { full_name: string; phone: string | null }[]
    | null;
  properties:
    | { name: string; property_code: string | null; area: string | null }
    | { name: string; property_code: string | null; area: string | null }[]
    | null;
  rooms:
    | { name: string | null; room_number: string }
    | { name: string | null; room_number: string }[]
    | null;
};

export type AgreementArchiveResult = {
  agreements: AgreementArchiveItem[];
  error: string | null;
};

export async function loadTenancyAgreementArchive(
  supabase: SupabaseClient,
): Promise<AgreementArchiveResult> {
  const agreementsResult = await supabase
    .from("tenancy_agreements")
    .select(
      "id, tenancy_id, term_type, agreement_type, version_number, status, term_start_date, term_end_date, generated_at, signed_at, admin_verified_at, admin_verified_by, admin_rejected_at, admin_rejected_by, admin_rejection_reason, replacement_agreement_id, retention_until, pdf_url, tenant_name_snapshot, property_name_snapshot, room_name_snapshot, monthly_rent_snapshot",
    )
    .order("generated_at", { ascending: false });

  if (agreementsResult.error) {
    console.error("[tenancy-agreements] agreement query failed", {
      code: agreementsResult.error.code,
      message: agreementsResult.error.message,
    });
    return {
      agreements: [],
      error: "Tenancy agreements could not be loaded. Please try again.",
    };
  }

  const agreementRows = (agreementsResult.data ?? []) as AgreementRow[];
  const tenancyIds = [
    ...new Set(agreementRows.map((agreement) => agreement.tenancy_id)),
  ];

  if (!tenancyIds.length) {
    return { agreements: [], error: null };
  }

  const unsignedRenewalIds = agreementRows
    .filter(
      (agreement) =>
        agreement.term_type === "renewal" &&
        !agreement.signed_at &&
        !["signed", "renewal_signed"].includes(agreement.status),
    )
    .map((agreement) => agreement.id);

  const [tenanciesResult, notificationsResult] = await Promise.all([
    supabase
      .from("tenancies")
      .select(
        "id, status, checkout_date, tenants(full_name, phone), properties(name, property_code, area), rooms!tenancies_room_id_fkey(name, room_number)",
      )
      .in("id", tenancyIds),
    unsignedRenewalIds.length
      ? supabase
          .from("agreement_notifications")
          .select("agreement_id, status, sent_at, created_at")
          .in("agreement_id", unsignedRenewalIds)
          .eq("notification_type", "renewal_signature_request")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tenanciesResult.error) {
    console.error("[tenancy-agreements] tenancy detail query failed", {
      code: tenanciesResult.error.code,
      message: tenanciesResult.error.message,
    });
    return {
      agreements: agreementRows.map((agreement) => ({
        ...agreement,
        renewal_reminder_status: null,
        renewal_reminder_at: null,
        tenancies: null,
      })),
      error:
        "The agreements are available, but some tenant status details could not be loaded.",
    };
  }

  const tenancyById = new Map(
    ((tenanciesResult.data ?? []) as TenancyRow[]).map((tenancy) => [
      tenancy.id,
      tenancy,
    ]),
  );
  const latestReminderByAgreement = new Map<
    string,
    { status: string; at: string | null }
  >();
  for (const notification of notificationsResult.data ?? []) {
    if (!latestReminderByAgreement.has(notification.agreement_id)) {
      latestReminderByAgreement.set(notification.agreement_id, {
        status: notification.status,
        at: notification.sent_at ?? notification.created_at ?? null,
      });
    }
  }
  const closedStatuses = new Set([
    "ended",
    "terminated",
    "completed",
    "cancelled",
  ]);
  const visibleAgreements = agreementRows.filter((agreement) => {
    const tenancy = tenancyById.get(agreement.tenancy_id);
    const isCheckedOut =
      Boolean(tenancy?.checkout_date) ||
      Boolean(tenancy?.status && closedStatuses.has(tenancy.status));

    return !isCheckedOut || Boolean(agreement.signed_at);
  });

  return {
    agreements: visibleAgreements.map((agreement) => ({
      ...agreement,
      renewal_reminder_status:
        latestReminderByAgreement.get(agreement.id)?.status ?? null,
      renewal_reminder_at:
        latestReminderByAgreement.get(agreement.id)?.at ?? null,
      tenancies: tenancyById.get(agreement.tenancy_id) ?? null,
    })),
    error: null,
  };
}
