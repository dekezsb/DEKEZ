export const COMMERCIAL_SECURITY_DEPOSIT_MONTHS = 2;
export const COMMERCIAL_UTILITY_DEPOSIT_MONTHS = 0.5;
export const COMMERCIAL_TOTAL_DEPOSIT_MONTHS =
  COMMERCIAL_SECURITY_DEPOSIT_MONTHS +
  COMMERCIAL_UTILITY_DEPOSIT_MONTHS;

function moneyAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function commercialDepositSchedule(
  monthlyRent: number | string | null | undefined,
  agreed?: { securityDeposit?: number | string | null; utilityDeposit?: number | string | null },
) {
  if (agreed?.securityDeposit != null && agreed.utilityDeposit != null) {
    const securityDeposit = moneyAmount(agreed.securityDeposit);
    const utilityDeposit = moneyAmount(agreed.utilityDeposit);
    return { securityDeposit, utilityDeposit, totalDeposit: moneyAmount(securityDeposit + utilityDeposit) };
  }
  const rent = moneyAmount(monthlyRent);
  const securityDeposit = moneyAmount(
    rent * COMMERCIAL_SECURITY_DEPOSIT_MONTHS,
  );
  const utilityDeposit = moneyAmount(
    rent * COMMERCIAL_UTILITY_DEPOSIT_MONTHS,
  );

  return {
    securityDeposit,
    utilityDeposit,
    totalDeposit: moneyAmount(securityDeposit + utilityDeposit),
  };
}

export function requiredTenancyDeposit({
  isCommercial,
  monthlyRent,
  statedDeposit,
  agreed,
}: {
  isCommercial: boolean;
  monthlyRent: number | string | null | undefined;
  statedDeposit: number | string | null | undefined;
  agreed?: { securityDeposit?: number | string | null; utilityDeposit?: number | string | null };
}) {
  return isCommercial
    ? commercialDepositSchedule(monthlyRent, agreed).totalDeposit
    : moneyAmount(statedDeposit);
}
