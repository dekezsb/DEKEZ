// Bank-in (knock-off) date rules shared by every payment-recording flow.
// A payment must post on the date the money reached the bank, taken from the
// slip or bank statement line. It is never filled in silently with today.

export type PaymentDateError = "payment_date_required" | "payment_date_invalid" | "payment_date_future" | "payment_date_too_old";
export type PaymentDateCheck = { ok: true; date: string } | { ok: false; error: PaymentDateError };

export const paymentDateMessages: Record<PaymentDateError, string> = {
  payment_date_required: "Enter the bank-in date shown on the slip or bank statement.",
  payment_date_invalid: "The bank-in date is not a valid date.",
  payment_date_future: "The bank-in date cannot be in the future.",
  payment_date_too_old: "The bank-in date looks wrong (before 2020). Check the slip.",
};

/** Today's calendar date in Malaysia (UTC+8), as YYYY-MM-DD. */
export function malaysiaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates a bank-in date. Missing dates are an error, never today. */
export function checkPaymentDate(value: string | null | undefined, now: Date = new Date()): PaymentDateCheck {
  const date = String(value ?? "").trim();
  if (!date) return { ok: false, error: "payment_date_required" };
  if (!isCalendarDate(date)) return { ok: false, error: "payment_date_invalid" };
  if (date > malaysiaToday(now)) return { ok: false, error: "payment_date_future" };
  if (date < "2020-01-01") return { ok: false, error: "payment_date_too_old" };
  return { ok: true, date };
}

/**
 * Value to prefill in a bank-in date field: the slip's or bank line's own date
 * when one exists, otherwise blank so the user must type it from the slip.
 */
export function paymentDateDefault(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const date = String(candidate ?? "").slice(0, 10);
    if (isCalendarDate(date)) return date;
  }
  return "";
}
