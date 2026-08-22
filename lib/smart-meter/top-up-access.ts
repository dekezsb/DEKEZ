const ELECTRICITY_TOP_UP_PROPERTY_CODES = new Set(["HLT", "BVH"]);

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
