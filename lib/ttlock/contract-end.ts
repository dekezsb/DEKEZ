function malaysiaEnd(date: string) {
  return new Date(`${date}T23:59:59+08:00`);
}

export function resolveContractEndDate(tenancy: {
  tenancy_end_date?: string | null;
  contract_end?: string | null;
  end_date?: string | null;
}) {
  return tenancy.tenancy_end_date ?? tenancy.contract_end ?? tenancy.end_date ?? null;
}

/**
 * True once the contract end calendar day is fully over in Malaysia
 * (after 11:59:59pm MYT). Tenancies with no end date, including monthly
 * stays, are not treated as ended.
 */
export function hasContractEnded(
  contractEnd: string | null | undefined,
  now: Date = new Date(),
) {
  if (!contractEnd || !/^\d{4}-\d{2}-\d{2}$/.test(contractEnd)) return false;
  const until = malaysiaEnd(contractEnd);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() < now.getTime();
}

export { malaysiaEnd };
