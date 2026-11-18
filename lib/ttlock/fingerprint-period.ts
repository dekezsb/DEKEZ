import { malaysiaEnd, resolveContractEndDate } from "@/lib/ttlock/contract-end";

const monthMs = 30 * 24 * 60 * 60 * 1000;

export function fingerprintValidityPeriod(input: {
  now?: Date;
  currentUntil?: string | null;
  tenancy: {
    tenancy_end_date?: string | null;
    contract_end?: string | null;
    end_date?: string | null;
    rental_model?: string | null;
  };
}) {
  const now = input.now ?? new Date();
  const endDate = resolveContractEndDate(input.tenancy);
  const contractUntil = endDate ? malaysiaEnd(endDate) : null;
  const validUntil = contractUntil
    ?? (input.tenancy.rental_model === "monthly_stay"
      ? new Date(now.getTime() + monthMs)
      : null);

  if (!validUntil || Number.isNaN(validUntil.getTime()) || validUntil.getTime() <= now.getTime()) {
    throw new Error("The tenancy has already ended.");
  }

  const currentUntil = input.currentUntil ? new Date(input.currentUntil) : null;
  const unchanged = Boolean(
    currentUntil
    && !Number.isNaN(currentUntil.getTime())
    && Math.abs(validUntil.getTime() - currentUntil.getTime()) < 60_000,
  );

  return {
    validFrom: new Date(now.getTime() - 5 * 60_000),
    validUntil,
    unchanged,
  };
}
