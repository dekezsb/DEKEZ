import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgreementArchiveItem } from "@/components/verification/agreement-archive";

type AgreementRow = Omit<AgreementArchiveItem, "tenancies"> & {
  tenancy_id: string;
};

type TenancyRow = {
  id: string;
  status: string;
  checkout_date: string | null;
  tenants: { full_name: string } | { full_name: string }[] | null;
  properties:
    | { name: string; property_code: string | null }
    | { name: string; property_code: string | null }[]
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
      "id, tenancy_id, agreement_type, version_number, status, term_start_date, term_end_date, generated_at, signed_at, retention_until, pdf_url, tenant_name_snapshot, property_name_snapshot, room_name_snapshot, monthly_rent_snapshot",
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

  const tenanciesResult = await supabase
    .from("tenancies")
    .select(
      "id, status, checkout_date, tenants(full_name), properties(name, property_code), rooms!tenancies_room_id_fkey(name, room_number)",
    )
    .in("id", tenancyIds);

  if (tenanciesResult.error) {
    console.error("[tenancy-agreements] tenancy detail query failed", {
      code: tenanciesResult.error.code,
      message: tenanciesResult.error.message,
    });
    return {
      agreements: agreementRows.map((agreement) => ({
        ...agreement,
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

  return {
    agreements: agreementRows.map((agreement) => ({
      ...agreement,
      tenancies: tenancyById.get(agreement.tenancy_id) ?? null,
    })),
    error: null,
  };
}
