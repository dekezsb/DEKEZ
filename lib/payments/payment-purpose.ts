export const PAYMENT_PURPOSES = [
  "monthly_rent",
  "deposit",
  "rent_and_deposit",
  "other",
] as const;

export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export function isPaymentPurpose(value: string): value is PaymentPurpose {
  return PAYMENT_PURPOSES.includes(value as PaymentPurpose);
}

export function paymentPurposeLabel(value: string) {
  if (value === "deposit") return "Deposit";
  if (value === "rent_and_deposit") return "Rent + Deposit";
  if (value === "other") return "Other / Extra Charge";
  return "Monthly Rent";
}

export function paymentPurposeTotal(
  purpose: PaymentPurpose,
  rentOutstanding: number,
  depositOutstanding: number,
) {
  if (purpose === "deposit") return Math.max(depositOutstanding, 0);
  if (purpose === "rent_and_deposit") {
    return Math.max(rentOutstanding, 0) + Math.max(depositOutstanding, 0);
  }
  if (purpose === "other") return 0;
  return Math.max(rentOutstanding, 0);
}

export function allocatePaymentPurpose(input: {
  purpose: PaymentPurpose;
  amount: number;
  rentOutstanding: number;
  depositOutstanding: number;
}) {
  const amount = Math.max(input.amount, 0);
  const rentOutstanding = Math.max(input.rentOutstanding, 0);
  const depositOutstanding = Math.max(input.depositOutstanding, 0);

  if (input.purpose === "other") {
    return { rent: 0, deposit: 0, extra: amount };
  }

  if (input.purpose === "deposit") {
    const deposit = Math.min(amount, depositOutstanding);
    return { rent: 0, deposit, extra: Math.max(amount - deposit, 0) };
  }

  if (input.purpose === "monthly_rent") {
    const rent = Math.min(amount, rentOutstanding);
    return { rent, deposit: 0, extra: Math.max(amount - rent, 0) };
  }

  const rent = Math.min(amount, rentOutstanding);
  const deposit = Math.min(Math.max(amount - rent, 0), depositOutstanding);

  return {
    rent,
    deposit,
    extra: Math.max(amount - rent - deposit, 0),
  };
}
