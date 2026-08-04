const TENANT_INVOICE_LEAD_DAYS = 7;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addCalendarDays(dateText: string, days: number) {
  if (!DATE_PATTERN.test(dateText)) return null;

  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function malaysiaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function tenantInvoiceVisibilityCutoffDate(
  currentDate = malaysiaDateString(),
) {
  return addCalendarDays(currentDate, TENANT_INVOICE_LEAD_DAYS) ?? currentDate;
}

export function tenantInvoiceVisibleFromDate(dueDate: string) {
  return addCalendarDays(dueDate, -TENANT_INVOICE_LEAD_DAYS);
}

export function isTenantInvoiceVisible(
  dueDate: string,
  currentDate = malaysiaDateString(),
) {
  const visibleFrom = tenantInvoiceVisibleFromDate(dueDate);
  return Boolean(visibleFrom && DATE_PATTERN.test(currentDate) && currentDate >= visibleFrom);
}
