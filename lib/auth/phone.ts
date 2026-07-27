export type InternationalPhone = {
  digits: string;
  e164: string;
};

export function normalizeInternationalPhone(
  value: string,
): InternationalPhone | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;

  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return null;
  }

  return {
    digits,
    e164: `+${digits}`,
  };
}
