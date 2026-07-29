export const EXTRA_CHARGE_OPTIONS = [
  { value: "key_lock", label: "Key lock" },
  { value: "electricity", label: "Electricity extra charge" },
  { value: "water", label: "Water extra charge" },
  { value: "access_card", label: "Access card" },
  { value: "damage", label: "Damage charge" },
  { value: "cleaning", label: "Cleaning charge" },
  { value: "other", label: "Other" },
] as const;

export type ExtraChargeCategory =
  (typeof EXTRA_CHARGE_OPTIONS)[number]["value"];

export function isExtraChargeCategory(
  value: string,
): value is ExtraChargeCategory {
  return EXTRA_CHARGE_OPTIONS.some((option) => option.value === value);
}

export function extraChargeLabel(category: ExtraChargeCategory) {
  return (
    EXTRA_CHARGE_OPTIONS.find((option) => option.value === category)?.label ??
    "Other charge"
  );
}
