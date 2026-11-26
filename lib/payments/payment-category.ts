import { EXTRA_CHARGE_OPTIONS } from "@/lib/payments/extra-charges";

export const PAYMENT_CATEGORY_OPTIONS = [
  { value: "monthly_rent", label: "Monthly rent" },
  { value: "deposit", label: "Rental deposit" },
  // Verified "Other payment" categories (not invoice extra-charge lines).
  { value: "key_replacement", label: "Lost key / key replacement" },
  { value: "top_up", label: "Electricity top-up" },
  { value: "top_up_utilities", label: "Electricity top-up" },
  ...EXTRA_CHARGE_OPTIONS,
] as const;

export function isPaymentCategory(value: string) {
  return PAYMENT_CATEGORY_OPTIONS.some((option) => option.value === value);
}

export function paymentCategoryLabel(value: string | null | undefined) {
  return (
    PAYMENT_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ??
    value?.replaceAll("_", " ") ??
    "Not categorised"
  );
}
