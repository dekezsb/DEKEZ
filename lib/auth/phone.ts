export type InternationalPhone = {
  digits: string;
  e164: string;
  lookupDigits: string[];
};

// Dashes, hyphens and minus signs that phone keyboards and copy/paste produce
// (U+2010-U+2015, U+2212, U+FE58, U+FE63, U+FF0D) plus ordinary separators.
const separatorPattern = /[\s\u00a0\u2000-\u200b\u202f\u205f\u3000().\-\u2010-\u2015\u2212\ufe58\ufe63\uff0d/_]/g;

/**
 * Turns what people actually type into a phone field into plain digits with an
 * optional leading "+": full-width digits, Unicode dashes and spaces, and a
 * letter O typed instead of zero (for example "O12-345 6789").
 */
export function cleanPhoneInput(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const compact = normalized.replace(separatorPattern, "");
  const plus = compact.startsWith("+") || compact.startsWith("\uff0b");
  const body = plus ? compact.slice(1) : compact;
  // Only treat O/o as zero when everything else is a digit, so real text is
  // still rejected instead of silently becoming a number.
  const withZeros = /^[\dOo]+$/.test(body) ? body.replace(/[Oo]/g, "0") : body;
  return `${plus ? "+" : ""}${withZeros}`;
}

function malaysianMobile(local: string, countryCodeFirst = false): InternationalPhone {
  // local is "1xxxxxxxx" (9 or 10 digits after the leading 0).
  const digits = `60${local}`;
  return {
    digits,
    e164: `+${digits}`,
    lookupDigits: countryCodeFirst ? [digits, `0${local}`] : [`0${local}`, digits],
  };
}

export function normalizeInternationalPhone(
  value: string,
): InternationalPhone | null {
  const compact = cleanPhoneInput(value);
  let enteredDigits = compact.startsWith("+") ? compact.slice(1) : compact;
  // "00" is the international dialling prefix (0060 12-...).
  if (!compact.startsWith("+") && /^00[1-9]/.test(enteredDigits)) {
    enteredDigits = enteredDigits.slice(2);
  }

  if (!/^\d{8,15}$/.test(enteredDigits)) {
    return null;
  }

  if (/^01\d{8,9}$/.test(enteredDigits)) {
    return malaysianMobile(enteredDigits.slice(1));
  }

  // "+60 012-345 6789": the trunk 0 kept after the country code.
  if (/^6001\d{8,9}$/.test(enteredDigits)) {
    return malaysianMobile(enteredDigits.slice(3), true);
  }

  if (!/^[1-9]\d{7,14}$/.test(enteredDigits)) {
    return null;
  }

  if (/^601\d{8,9}$/.test(enteredDigits)) {
    return malaysianMobile(enteredDigits.slice(2), true);
  }

  return {
    digits: enteredDigits,
    e164: `+${enteredDigits}`,
    lookupDigits: [enteredDigits],
  };
}

/** A plain-language reason the phone cannot be used, or null when it is fine. */
export function phoneInputProblem(value: string): string | null {
  const raw = value.trim();
  if (!raw) return "Enter the tenant's phone / WhatsApp number.";
  if (normalizeInternationalPhone(raw)) return null;
  const compact = cleanPhoneInput(raw);
  const digits = compact.replace(/^\+/, "");
  if (/[^\d]/.test(digits)) {
    return "Phone number can only contain digits, spaces, dashes and a leading +.";
  }
  if (/^0[02-9]/.test(digits)) {
    return "Use a mobile number starting with 01 (e.g. 012-345 6789), or add the country code for a foreign number (e.g. +62 812 3456 7890).";
  }
  if (/^0?1/.test(digits) && digits.length < 10) {
    return "This phone number is too short. Malaysian mobile numbers have 10 or 11 digits (e.g. 012-345 6789).";
  }
  return "Enter a valid phone number, e.g. 012-345 6789 or +country code.";
}
