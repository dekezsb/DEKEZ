import type { AgreementArchiveItem } from "@/components/verification/agreement-archive";

export function neverSignedTenancies(agreements: AgreementArchiveItem[], today: string) {
  const groups = new Map<string, AgreementArchiveItem[]>();
  for (const agreement of agreements) {
    const tenancy = Array.isArray(agreement.tenancies) ? agreement.tenancies[0] : agreement.tenancies;
    if (tenancy?.status !== "active" || tenancy.checkout_date) continue;
    const rows = groups.get(agreement.tenancy_id) ?? [];
    rows.push(agreement);
    groups.set(agreement.tenancy_id, rows);
  }
  return [...groups.entries()].flatMap(([tenancyId, rows]) => {
    // Even a rejected/replaced signed copy means this tenant HAS signed before.
    if (rows.some(a => a.signed_at || ["signed", "renewal_signed"].includes(a.status))) return [];
    const pending = rows.filter(a => !a.admin_rejected_at && !a.replacement_agreement_id)
      .sort((a, b) => (a.term_start_date ?? "").localeCompare(b.term_start_date ?? "") || a.version_number - b.version_number);
    if (!pending.length) return [];
    const one = <T,>(value: T | T[] | null | undefined) => Array.isArray(value) ? value[0] : value;
    const tenancy = one(pending[0].tenancies);
    const propertyName = one(tenancy?.properties)?.name ?? pending[0].property_name_snapshot ?? "";
    const currentRoom = one(tenancy?.rooms);
    const roomName = currentRoom?.room_number ?? currentRoom?.name ?? pending[0].room_name_snapshot ?? "";
    const tenantName = one(tenancy?.tenants)?.full_name ?? pending[0].tenant_name_snapshot ?? "";
    const expired = pending.some(a => a.term_end_date && a.term_end_date < today);
    const standby = pending.some(a => a.term_type === "renewal" && a.term_end_date && a.term_end_date >= today);
    const overlap = pending.some((a, index) => pending.slice(index + 1).some(b =>
      a.term_start_date && a.term_end_date && b.term_start_date && b.term_end_date &&
      a.term_start_date <= b.term_end_date && b.term_start_date <= a.term_end_date));
    return [{ tenancyId, pending, expired, standby, overlap, propertyName, roomName, tenantName }];
  }).sort((a, b) => Number(b.expired) - Number(a.expired) ||
    a.propertyName.localeCompare(b.propertyName) ||
    a.roomName.localeCompare(b.roomName, undefined, { numeric: true }));
}
