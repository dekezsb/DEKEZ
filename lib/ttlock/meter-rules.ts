/** Pure helpers for TTLock electricity meters (unit-testable). */

export function parseKwh(value: string | number | null | undefined) {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/kwh/i, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** First day of the Malaysia-time month for a timestamp, as YYYY-MM-01. */
export function malaysiaBillingMonth(at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}-01`;
}

export function malaysiaDateString(at: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function providerTimestamp(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Monthly reading row from a cumulative total. Keeps readings monotonic:
 * the month's opening reading is last month's closing reading (or the
 * current total for a meter's first month), and a lower provider total
 * (meter reset/replaced) never rewrites history below the opening.
 */
export function planMonthlyReading(input: {
  totalKwh: number;
  existingThisMonth: { previous_reading: number; current_reading: number } | null;
  lastClosingReading: number | null;
}) {
  if (input.existingThisMonth) {
    const previous = Number(input.existingThisMonth.previous_reading);
    const current = Math.max(previous, input.totalKwh);
    return {
      previous_reading: previous,
      current_reading: current,
      changed: Math.abs(current - Number(input.existingThisMonth.current_reading)) >= 0.001,
    };
  }
  const opening =
    input.lastClosingReading != null && input.lastClosingReading <= input.totalKwh
      ? input.lastClosingReading
      : input.totalKwh;
  return { previous_reading: opening, current_reading: input.totalKwh, changed: true };
}

export const METER_POWER_REASONS = ["staff", "checkout", "move_in"] as const;
export type MeterPowerReason = (typeof METER_POWER_REASONS)[number];

/** Only restore power that DEKEZ itself cut at checkout. */
export function shouldRestorePowerOnMoveIn(meter: {
  power_state: string | null;
  power_control_reason: string | null;
}) {
  return meter.power_state !== "on" && meter.power_control_reason === "checkout";
}

export function operationRecordLabel(recordType: string | number | null | undefined) {
  switch (String(recordType ?? "")) {
    case "1":
      return "Balance cleared";
    case "2":
      return "Payment mode changed";
    case "4":
      return "Power on/off";
    case "5":
      return "Meter reading";
    case "6":
      return "Unit price updated";
    case "7":
      return "Recharge";
    case "8":
      return "Recharging";
    default:
      return "Event";
  }
}
