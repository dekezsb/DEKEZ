// Accounts-receivable aging: pure functions only (no database access) so the
// bucket rules, grouping and balance-sheet reconciliation can be tested alone.
// All money is added in cents so nothing drifts.

export const arBucketKeys = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type ArBucketKey = (typeof arBucketKeys)[number];
export const arBucketLabels: Record<ArBucketKey, string> = {
  current: "Current",
  d1_30: "1-30 days",
  d31_60: "31-60 days",
  d61_90: "61-90 days",
  d90_plus: "90+ days",
};

/** One open invoice, already reduced to what is still unpaid. */
export type ArInvoice = {
  id: string;
  propertyId: string;
  propertyName: string;
  tenantKey: string;
  tenantName: string;
  roomName: string;
  /** Number as stored on the invoice (old style today). */
  invoiceNumber: string;
  /** The other numbering style from document_number_aliases, when there is one. */
  aliasNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  status: string;
  invoiceAmount: number;
  paidAmount: number;
  /** Rent + charges less payments and credits, never below zero. */
  rentOutstanding: number;
  /** Deposit due less deposit payments received, never below zero. */
  depositOutstanding: number;
};

export type ArAmounts = Record<ArBucketKey, number> & { deposit: number; total: number };
export type ArInvoiceRow = ArInvoice & { ageDate: string; daysOverdue: number; bucket: ArBucketKey; total: number; href: string };
export type ArTenant = { key: string; name: string; rooms: string[]; invoices: ArInvoiceRow[]; amounts: ArAmounts };
export type ArProperty = { propertyId: string; name: string; tenants: ArTenant[]; amounts: ArAmounts };
export type ArAging = { asAt: string; properties: ArProperty[]; totals: ArAmounts; invoiceCount: number };

const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;
const isOpen = (invoice: Pick<ArInvoice, "rentOutstanding" | "depositOutstanding">) => invoice.rentOutstanding + invoice.depositOutstanding > 0.005;

export const emptyAmounts = (): ArAmounts => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, deposit: 0, total: 0 });

export function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
}

/** Today's calendar date in Malaysia (UTC+8) as YYYY-MM-DD. */
export function arToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The date an invoice ages from: its due date, or its invoice date when there is no due date. */
export function ageDateOf(invoice: { dueDate?: string | null; invoiceDate?: string | null }): string {
  return invoice.dueDate || invoice.invoiceDate || "";
}

/** Whole days past the age date (0 or negative = not overdue yet). */
export function daysOverdue(ageDate: string, asAt: string): number {
  return Math.round((Date.parse(`${asAt}T00:00:00Z`) - Date.parse(`${ageDate}T00:00:00Z`)) / 86400000);
}

export function bucketFor(days: number): ArBucketKey {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export function invoiceHref(invoiceNumber: string) {
  return `/rental-invoices?search=${encodeURIComponent(invoiceNumber)}`;
}

function addInto(target: Record<string, number>, row: ArInvoiceRow) {
  target[row.bucket] += cents(row.rentOutstanding);
  target.deposit += cents(row.depositOutstanding);
  target.total += cents(row.total);
}
const finish = (cent: ArAmounts): ArAmounts => ({
  current: fromCents(cent.current), d1_30: fromCents(cent.d1_30), d31_60: fromCents(cent.d31_60), d61_90: fromCents(cent.d61_90), d90_plus: fromCents(cent.d90_plus),
  deposit: fromCents(cent.deposit), total: fromCents(cent.total),
});

/**
 * Invoices on the report: still open, and dated on or before the as-at date.
 * Invoices the system has already generated for later dates are not receivables yet.
 */
export function agingInvoices(invoices: ArInvoice[], asAt: string, propertyId?: string | null): ArInvoice[] {
  return invoices.filter((invoice) => isOpen(invoice) && (invoice.invoiceDate || ageDateOf(invoice)) <= asAt && (!propertyId || invoice.propertyId === propertyId));
}

export function buildArAging(invoices: ArInvoice[], asAt: string, propertyId?: string | null): ArAging {
  const included = agingInvoices(invoices, asAt, propertyId);
  const properties = new Map<string, { property: ArProperty; cents: ArAmounts; tenants: Map<string, { tenant: ArTenant; cents: ArAmounts }> }>();
  const grand = emptyAmounts();
  for (const invoice of included) {
    const ageDate = ageDateOf(invoice);
    const days = daysOverdue(ageDate, asAt);
    const row: ArInvoiceRow = {
      ...invoice, ageDate, daysOverdue: days, bucket: bucketFor(days),
      total: fromCents(cents(invoice.rentOutstanding) + cents(invoice.depositOutstanding)),
      href: invoiceHref(invoice.invoiceNumber),
    };
    let property = properties.get(invoice.propertyId);
    if (!property) {
      property = { property: { propertyId: invoice.propertyId, name: invoice.propertyName, tenants: [], amounts: emptyAmounts() }, cents: emptyAmounts(), tenants: new Map() };
      properties.set(invoice.propertyId, property);
    }
    let tenant = property.tenants.get(invoice.tenantKey);
    if (!tenant) {
      tenant = { tenant: { key: invoice.tenantKey, name: invoice.tenantName, rooms: [], invoices: [], amounts: emptyAmounts() }, cents: emptyAmounts() };
      property.tenants.set(invoice.tenantKey, tenant);
      property.property.tenants.push(tenant.tenant);
    }
    tenant.tenant.invoices.push(row);
    if (invoice.roomName && !tenant.tenant.rooms.includes(invoice.roomName)) tenant.tenant.rooms.push(invoice.roomName);
    addInto(tenant.cents, row);
    addInto(property.cents, row);
    addInto(grand, row);
  }
  const result: ArProperty[] = [];
  for (const { property, cents: propertyCents, tenants } of properties.values()) {
    for (const { tenant, cents: tenantCents } of tenants.values()) {
      tenant.amounts = finish(tenantCents);
      tenant.invoices.sort((a, b) => a.ageDate.localeCompare(b.ageDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
    }
    property.tenants.sort((a, b) => a.name.localeCompare(b.name));
    property.amounts = finish(propertyCents);
    result.push(property);
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return { asAt, properties: result, totals: finish(grand), invoiceCount: included.length };
}

// ---------------------------------------------------------------- page parameters

export type ArParams = { asAt: string; property: string; error: string };

export function parseArParams(search: Record<string, string | undefined>, today: string = arToday()): ArParams {
  const raw = (search.asAt ?? search.as_at ?? "").trim();
  const property = (search.property ?? "").trim();
  if (!raw) return { asAt: today, property, error: "" };
  if (!isIsoDate(raw)) return { asAt: today, property, error: "The as-at date is not a valid date." };
  if (raw < "2020-01-01") return { asAt: today, property, error: "The as-at date looks wrong (before 2020)." };
  return { asAt: raw, property, error: "" };
}

export function arQuery(params: Pick<ArParams, "asAt" | "property">) {
  const query = new URLSearchParams({ asAt: params.asAt });
  if (params.property) query.set("property", params.property);
  return query.toString();
}

export const arScopeNote =
  "Each invoice ages from its due date (invoice date when it has no due date). The balance is what is still unpaid after payments and credits. Unpaid deposits are shown in their own column and are not aged. Invoices dated after the as-at date are not receivables yet and are left out. Balances are the current unpaid amounts for invoices dated up to the as-at date; payments received after a past as-at date are not added back.";

// ---------------------------------------------------------------- reconciliation

export type ArManualSource = { label: string; rental: number; deposit: number };

export type ArReconciliationInput = {
  invoices: ArInvoice[];
  asAt: string;
  propertyId?: string | null;
  /** Posted postings on the receivable accounts that are not invoices (journals, bank vouchers, historical bank credits). */
  manual: ArManualSource[];
};

export type ArReconciliation = {
  agingTotal: number;
  agingRental: number;
  agingDeposit: number;
  notYetDue: number;
  notYetDueDeposit: number;
  dueButDatedLater: number;
  dueButDatedLaterCount: number;
  invoiceReceivable: number;
  invoiceRental: number;
  invoiceDeposit: number;
  manual: ArManualSource[];
  manualRental: number;
  manualDeposit: number;
  balanceSheetRental: number;
  balanceSheetDeposit: number;
  balanceSheetTotal: number;
  /** Aging total minus balance sheet receivables. */
  difference: number;
  /** Generated invoices dated after as-at: shown for transparency, in neither figure. */
  futureDated: { count: number; amount: number };
  /** Invoices paid above their amount; the credit is not netted (the balance sheet does the same). */
  overpaid: { count: number; amount: number };
};

/**
 * Mirrors the Balance Sheet: receivables = open invoices due on or before the
 * as-at date, plus postings made straight to the receivable accounts.
 * `invoices` must hold every open invoice (dated or not) for the as-at date.
 */
export function reconcileWithBalanceSheet(input: ArReconciliationInput, overpaid: { count: number; amount: number } = { count: 0, amount: 0 }): ArReconciliation {
  const { asAt, propertyId } = input;
  const open = input.invoices.filter((invoice) => isOpen(invoice) && (!propertyId || invoice.propertyId === propertyId));
  const included = agingInvoices(open, asAt, null);
  const sum = (rows: ArInvoice[], pick: (invoice: ArInvoice) => number) => rows.reduce((total, invoice) => total + cents(pick(invoice)), 0);
  const agingRental = sum(included, (invoice) => invoice.rentOutstanding);
  const agingDeposit = sum(included, (invoice) => invoice.depositOutstanding);
  const notYetDueRows = included.filter((invoice) => ageDateOf(invoice) > asAt);
  const notYetDue = sum(notYetDueRows, (invoice) => invoice.rentOutstanding + invoice.depositOutstanding);
  const notYetDueDeposit = sum(notYetDueRows, (invoice) => invoice.depositOutstanding);
  const dueLaterRows = open.filter((invoice) => (invoice.invoiceDate || ageDateOf(invoice)) > asAt && ageDateOf(invoice) <= asAt);
  const dueButDatedLater = sum(dueLaterRows, (invoice) => invoice.rentOutstanding + invoice.depositOutstanding);
  // Balance sheet invoice figure: every open invoice due on or before as-at.
  const bsRows = open.filter((invoice) => ageDateOf(invoice) <= asAt);
  const invoiceRental = sum(bsRows, (invoice) => invoice.rentOutstanding);
  const invoiceDeposit = sum(bsRows, (invoice) => invoice.depositOutstanding);
  const futureRows = open.filter((invoice) => (invoice.invoiceDate || ageDateOf(invoice)) > asAt && ageDateOf(invoice) > asAt);
  const manualRental = input.manual.reduce((total, row) => total + cents(row.rental), 0);
  const manualDeposit = input.manual.reduce((total, row) => total + cents(row.deposit), 0);
  const balanceSheetRental = invoiceRental + manualRental;
  const balanceSheetDeposit = invoiceDeposit + manualDeposit;
  const agingTotal = agingRental + agingDeposit;
  const balanceSheetTotal = balanceSheetRental + balanceSheetDeposit;
  return {
    agingTotal: fromCents(agingTotal), agingRental: fromCents(agingRental), agingDeposit: fromCents(agingDeposit),
    notYetDue: fromCents(notYetDue), notYetDueDeposit: fromCents(notYetDueDeposit),
    dueButDatedLater: fromCents(dueButDatedLater), dueButDatedLaterCount: dueLaterRows.length,
    invoiceReceivable: fromCents(invoiceRental + invoiceDeposit), invoiceRental: fromCents(invoiceRental), invoiceDeposit: fromCents(invoiceDeposit),
    manual: input.manual, manualRental: fromCents(manualRental), manualDeposit: fromCents(manualDeposit),
    balanceSheetRental: fromCents(balanceSheetRental), balanceSheetDeposit: fromCents(balanceSheetDeposit), balanceSheetTotal: fromCents(balanceSheetTotal),
    difference: fromCents(agingTotal - balanceSheetTotal),
    futureDated: { count: futureRows.length, amount: fromCents(sum(futureRows, (invoice) => invoice.rentOutstanding + invoice.depositOutstanding)) },
    overpaid,
  };
}

// ---------------------------------------------------------------- CSV

const amountCells = (amounts: ArAmounts) => [amounts.current, amounts.d1_30, amounts.d31_60, amounts.d61_90, amounts.d90_plus, amounts.deposit, amounts.total].map((value) => value.toFixed(2));

export function arCsvRows(aging: ArAging, companyName: string): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    [companyName],
    ["AR Aging"],
    ["As at", aging.asAt],
    [],
    ["Property", "Tenant", "Room", "Invoice no.", "Other no.", "Invoice date", "Due date", "Days overdue", "Status", "Current", "1-30 days", "31-60 days", "61-90 days", "90+ days", "Unpaid deposit", "Total"],
  ];
  for (const property of aging.properties) {
    for (const tenant of property.tenants) {
      for (const invoice of tenant.invoices) {
        const amounts = emptyAmounts();
        amounts[invoice.bucket] = invoice.rentOutstanding;
        amounts.deposit = invoice.depositOutstanding;
        amounts.total = invoice.total;
        rows.push([property.name, tenant.name, invoice.roomName, invoice.invoiceNumber, invoice.aliasNumber ?? "", invoice.invoiceDate, invoice.dueDate, Math.max(invoice.daysOverdue, 0), invoice.status, ...amountCells(amounts)]);
      }
      rows.push([property.name, `${tenant.name} - tenant total`, "", "", "", "", "", "", "", ...amountCells(tenant.amounts)]);
    }
    rows.push([`${property.name} - property total`, "", "", "", "", "", "", "", "", ...amountCells(property.amounts)]);
  }
  rows.push(["GRAND TOTAL", "", "", "", "", "", "", "", "", ...amountCells(aging.totals)]);
  return rows;
}
