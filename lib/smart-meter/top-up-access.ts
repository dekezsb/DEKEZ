const ELECTRICITY_TOP_UP_PROPERTY_CODES = new Set(["HLT", "BVH"]);

export const ELECTRICITY_TOP_UP_MIN_AMOUNT = 10;
export const ELECTRICITY_TOP_UP_MAX_AMOUNT = 500;
export const DEFAULT_ELECTRICITY_RM_PER_KWH = 0.57;
export const TTLOCK_ELECTRICITY_RATE_ENV_NAME = "TTLOCK_ELECTRICITY_RM_PER_KWH";

export function hasTenantElectricityTopUpAccess(
  propertyCode: string | null | undefined,
  propertyName: string | null | undefined,
) {
  const normalizedCode = propertyCode?.trim().toUpperCase() ?? "";
  const normalizedName = propertyName?.trim().toUpperCase() ?? "";

  return (
    ELECTRICITY_TOP_UP_PROPERTY_CODES.has(normalizedCode) ||
    normalizedName === "HLT" ||
    normalizedName.startsWith("HLT -") ||
    normalizedName.includes("HILLTOP") ||
    normalizedName === "BVH" ||
    normalizedName.startsWith("BVH -") ||
    normalizedName.includes("BEVERLY HILL")
  );
}

export function isTTLockElectricityMeter(provider?: string | null) {
  return provider?.trim().toLowerCase() === "ttlock";
}

/** Tenant and staff electricity top-up is only for a linked TTLock meter. */
export function hasElectricityTopUpAccess(input: {
  provider?: string | null;
  hasElectricityMeter?: boolean;
}) {
  return Boolean(input.hasElectricityMeter) && isTTLockElectricityMeter(input.provider);
}

export function isValidElectricityTopUpAmount(amount: number) {
  return Number.isInteger(amount)
    && amount >= ELECTRICITY_TOP_UP_MIN_AMOUNT
    && amount <= ELECTRICITY_TOP_UP_MAX_AMOUNT;
}

export function resolveElectricityRmPerKwh(meterRate?: number | null) {
  if (meterRate && Number.isFinite(meterRate) && meterRate > 0) {
    return meterRate;
  }
  const fromEnv = Number(process.env[TTLOCK_ELECTRICITY_RATE_ENV_NAME]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return DEFAULT_ELECTRICITY_RM_PER_KWH;
}

export function kwhEstimateForTopUp(
  amount: number,
  rmPerKwh = DEFAULT_ELECTRICITY_RM_PER_KWH,
) {
  if (!(amount > 0) || !(rmPerKwh > 0)) return null;
  return Math.round((amount / rmPerKwh) * 1000) / 1000;
}

/** Tenant-facing kWh estimate, rounded to 2 decimals. */
export function formatKwhEstimate(kwh: number | null) {
  if (kwh == null) return null;
  return kwh.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function electricityTopUpStatusLabel(status: string) {
  switch (status) {
    case "pending_verification":
      return "Pending";
    case "approved_awaiting_top_up":
    case "credited":
      return "Verified";
    case "rejected":
      return "Rejected";
    default:
      return status.replaceAll("_", " ");
  }
}
