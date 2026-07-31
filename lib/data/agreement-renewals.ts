import { createClient } from "@/lib/supabase/server";

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export type AgreementReminder = {
  id: string;
  termType: "original" | "renewal";
  agreementType: "residential_room" | "commercial_office";
  status: string;
  termStartDate: string | null;
  termEndDate: string | null;
  tenantName: string;
  phone: string | null;
  propertyName: string;
  roomName: string;
  isCommercial: boolean;
};

export async function getAgreementRenewalReminders() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenancy_agreements")
    .select(
      "id, term_type, agreement_type, status, term_start_date, term_end_date, tenant_name_snapshot, property_name_snapshot, room_name_snapshot, tenancies(status, checkout_date, tenants(full_name, phone), properties(name, is_commercial), rooms(name, room_number))",
    )
    .in("status", [
      "pending_signature",
      "renewal_pending",
      "renewal_sent",
      "expiring_soon",
    ])
    .is("admin_rejected_at", null)
    .order("term_end_date", { ascending: true });

  return (data ?? [])
    .map((agreement) => {
      const tenancy = first(agreement.tenancies);
      const tenant = first(tenancy?.tenants);
      const property = first(tenancy?.properties);
      const room = first(tenancy?.rooms);

      if (
        !tenancy ||
        tenancy.status !== "active" ||
        tenancy.checkout_date
      ) {
        return null;
      }

      return {
        id: agreement.id,
        termType: agreement.term_type,
        agreementType: agreement.agreement_type,
        status: agreement.status,
        termStartDate: agreement.term_start_date,
        termEndDate: agreement.term_end_date,
        tenantName:
          agreement.tenant_name_snapshot ?? tenant?.full_name ?? "Tenant",
        phone: tenant?.phone ?? null,
        propertyName:
          agreement.property_name_snapshot ?? property?.name ?? "Property",
        roomName:
          agreement.room_name_snapshot ??
          room?.room_number ??
          room?.name ??
          "Room",
        isCommercial: property?.is_commercial ?? false,
      } satisfies AgreementReminder;
    })
    .filter((item): item is AgreementReminder => item !== null);
}
