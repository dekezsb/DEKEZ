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
) {
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
}: {
  isCommercial: boolean;
  monthlyRent: number | string | null | undefined;
  statedDeposit: number | string | null | undefined;
}) {
  return isCommercial
    ? commercialDepositSchedule(monthlyRent).totalDeposit
    : moneyAmount(statedDeposit);
}
