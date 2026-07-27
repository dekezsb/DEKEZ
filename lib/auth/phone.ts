export type InternationalPhone = {
  digits: string;
  e164: string;
  lookupDigits: string[];
};

export function normalizeInternationalPhone(
  value: string,
): InternationalPhone | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const enteredDigits = compact.startsWith("+") ? compact.slice(1) : compact;

  if (!/^\d{8,15}$/.test(enteredDigits)) {
    return null;
  }

  if (/^01\d{8,9}$/.test(enteredDigits)) {
    const digits = `60${enteredDigits.slice(1)}`;

    return {
      digits,
      e164: `+${digits}`,
      lookupDigits: [enteredDigits, digits],
    };
  }

  if (!/^[1-9]\d{7,14}$/.test(enteredDigits)) {
    return null;
  }

  const malaysiaLocal =
    /^601\d{8,9}$/.test(enteredDigits)
      ? `0${enteredDigits.slice(2)}`
      : null;

  return {
    digits: enteredDigits,
    e164: `+${enteredDigits}`,
    lookupDigits: malaysiaLocal
      ? [enteredDigits, malaysiaLocal]
      : [enteredDigits],
  };
}
