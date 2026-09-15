export function reservationAmount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (!String(value).trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 1000000 && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001 ? amount : null;
}

export function validReservationPaymentDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function reservationPaymentError(amount: unknown, date: unknown, hasSlip: boolean) {
  if (reservationAmount(amount) === null) return "Enter the reservation deposit actually received (for example RM50).";
  if (!validReservationPaymentDate(date)) return "Choose a valid reservation deposit payment date.";
  if (!hasSlip) return "Upload the one reservation deposit slip before submitting.";
  return null;
}
