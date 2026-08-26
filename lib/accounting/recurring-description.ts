const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const writtenMonthPattern = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4}\b/i;

export function accountingMonthLabel(month: string) {
  const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (!match) return "";
  return `${monthNames[Number(match[2]) - 1]} ${match[1]}`;
}

export function recurringDescriptionForMonth(description: string, month: string) {
  const monthLabel = accountingMonthLabel(month);
  const value = description.trim();
  if (!monthLabel || !value) return value;
  if (writtenMonthPattern.test(value)) return value.replace(writtenMonthPattern, monthLabel);
  return `${value.replace(/\s*[·\-–—]\s*$/, "")} · ${monthLabel}`;
}
