import { addDays, calculateTermEndDate } from "@/lib/e-tenancy";

export type StandbySource = {
  id: string; term_type: string; version_number: number;
  term_start_date: string | null; term_end_date: string | null;
  signed_at: string | null; admin_verified_at: string | null;
  admin_rejected_at: string | null; replacement_agreement_id: string | null;
  monthly_rent_snapshot: number | string | null;
};

export function standbyPlan(rows: StandbySource[], today: string) {
  const valid = rows.filter(a => !a.admin_rejected_at && !a.replacement_agreement_id && a.term_start_date && a.term_end_date);
  const source = [...valid].sort((a, b) => b.term_end_date!.localeCompare(a.term_end_date!) ||
    Number(b.term_type === "renewal") - Number(a.term_type === "renewal") || b.version_number - a.version_number)[0];
  if (!source) return { source: null, next: null, review: "Missing term dates" };
  if (source.signed_at && !source.admin_verified_at) return { source, next: null, review: null };
  if (source.term_end_date! > addDays(today, 30)) return { source, next: null, review: null };
  const months = [6, 12].find(n => calculateTermEndDate(source.term_start_date!, n) === source.term_end_date);
  if (!months) return { source, next: null, review: "Prior term is not six or twelve months; management must confirm duration" };
  const startDate = addDays(source.term_end_date!, 1);
  return { source, next: { startDate, endDate: calculateTermEndDate(startDate, months), months }, review: null };
}
