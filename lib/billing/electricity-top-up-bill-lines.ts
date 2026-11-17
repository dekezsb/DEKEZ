export type InvoiceChargeLine = {
  id: string;
  category: string;
  description: string;
  amount: number;
  alreadyPaid?: boolean;
  smartMeterTopUpRequestId?: string | null;
};

export type VerifiedElectricityTopUp = {
  id: string;
  tenancy_id: string | null;
  rent_bill_id: string | null;
  bill_month: string;
  amount: number | string;
  status: string;
};

const VISIBLE_STATUSES = new Set([
  "approved_awaiting_top_up",
  "credited",
]);

export function calendarMonth(value: string | null | undefined) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? String(value).slice(0, 10);
}

export function numberAmount(value: number | string | null | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function alreadyOnInvoice(
  lineItems: InvoiceChargeLine[],
  requestId: string,
) {
  return lineItems.some(
    (item) => item.smartMeterTopUpRequestId === requestId,
  );
}

export function topUpBelongsToBill(
  bill: { id: string; tenancy_id?: string | null; bill_month: string },
  topUp: VerifiedElectricityTopUp,
) {
  if (!VISIBLE_STATUSES.has(topUp.status)) return false;
  if (topUp.rent_bill_id && topUp.rent_bill_id === bill.id) return true;
  return Boolean(
    bill.tenancy_id
      && topUp.tenancy_id === bill.tenancy_id
      && calendarMonth(topUp.bill_month) === calendarMonth(bill.bill_month),
  );
}

/**
 * Attach verified (or later credited) electricity top-ups to a monthly invoice
 * as informational paid lines. Official credited line items already stored on
 * the invoice are left in place and not duplicated. Virtual lines increase
 * display total and display paid by the same amount so rent outstanding and
 * unpaid reminders are unchanged.
 */
export function attachPrepaidElectricityTopUps(input: {
  bill: { id: string; tenancy_id?: string | null; bill_month: string };
  lineItems: InvoiceChargeLine[];
  topUps: VerifiedElectricityTopUp[];
}) {
  const lineItems = input.lineItems.map((item) =>
    item.category === "top_up_utilities" || item.smartMeterTopUpRequestId
      ? { ...item, alreadyPaid: true }
      : item,
  );
  const virtual: InvoiceChargeLine[] = [];

  for (const topUp of input.topUps) {
    if (!topUpBelongsToBill(input.bill, topUp)) continue;
    if (alreadyOnInvoice(lineItems, topUp.id)) continue;
    const amount = numberAmount(topUp.amount);
    if (amount <= 0) continue;
    virtual.push({
      id: `electricity-topup-${topUp.id}`,
      category: "top_up_utilities",
      description: "Top Up Utilities - Electricity (Paid)",
      amount,
      alreadyPaid: true,
      smartMeterTopUpRequestId: topUp.id,
    });
  }

  const prepaidAddedAmount = virtual.reduce(
    (total, item) => total + item.amount,
    0,
  );

  return {
    lineItems: [...lineItems, ...virtual],
    prepaidAddedAmount,
  };
}

export function invoiceTotalsWithPrepaidTopUps(input: {
  amount: number;
  depositAmount: number;
  paidAmount: number;
  depositPaidAmount: number;
  lineItems: InvoiceChargeLine[];
  prepaidAddedAmount: number;
  cancelled?: boolean;
}) {
  const extraChargeAmount = input.lineItems.reduce(
    (total, item) => total + item.amount,
    0,
  );
  const invoiceTotal =
    input.amount + input.depositAmount + extraChargeAmount;
  const invoicePaidAmount = Math.min(
    input.paidAmount + input.depositPaidAmount + input.prepaidAddedAmount,
    invoiceTotal,
  );
  const outstanding = input.cancelled
    ? 0
    : Math.max(invoiceTotal - invoicePaidAmount, 0);

  return { extraChargeAmount, invoiceTotal, invoicePaidAmount, outstanding };
}
