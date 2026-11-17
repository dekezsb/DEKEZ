const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/;

export function resolveTenancyStartDate(input: {
  check_in_date?: string | null;
  tenancy_start_date?: string | null;
  contract_start?: string | null;
  start_date?: string | null;
  proposed_start_date?: string | null;
}) {
  return (
    input.check_in_date ??
    input.tenancy_start_date ??
    input.contract_start ??
    input.start_date ??
    input.proposed_start_date ??
    null
  );
}

export function dueDayFromStartDate(startDate: string | null | undefined) {
  if (!startDate) return null;
  const match = dateOnly.exec(startDate);
  if (!match) return null;
  const day = Number(match[3]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

/**
 * Due day for a newly created tenancy: the calendar day of the check-in /
 * contract start date. Never returns 1 unless that start date is the 1st,
 * and does not trust a stored due_day that may be the schema default.
 */
export function dueDayForNewTenancy(startDate: string) {
  const day = dueDayFromStartDate(startDate);
  if (day == null) {
    throw new Error("The tenancy start or check-in date is missing or invalid.");
  }
  return day;
}
