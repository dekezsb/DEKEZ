// General Ledger core: pure functions only (no database access) so the
// opening balance, running balance and drill-down rules can be tested alone.

export type GlSource = "voucher" | "journal" | "reversal" | "renovation" | "invoice" | "payment" | "bank_pv" | "expense" | "utility_bill";

export type GlAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  normalBalance: "debit" | "credit";
  systemKey?: string | null;
};

export type GlLine = {
  key: string;
  accountId: string;
  date: string;
  source: GlSource;
  /** Number as stored today (legacy style for older documents, new style for vouchers). */
  number: string;
  /** The other numbering style when the document has both. */
  aliasNumber: string | null;
  reference: string | null;
  party: string;
  property: string;
  description: string;
  debit: number;
  credit: number;
  href: string | null;
};

export type GlRow = GlLine & { balance: number };
export type GlLedger = {
  account: GlAccount;
  opening: number;
  rows: GlRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
};

export const glSourceLabels: Record<GlSource, string> = {
  voucher: "Voucher",
  journal: "Journal",
  reversal: "Auto reversal",
  renovation: "Renovation invoice",
  invoice: "Tenant invoice",
  payment: "Payment",
  bank_pv: "Bank PV",
  expense: "Expense",
  utility_bill: "Utility bill",
};

const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

/** Balance in the account's natural direction: debit-normal = Dr - Cr, credit-normal = Cr - Dr. */
export function naturalMovement(debit: number, credit: number, normalBalance: "debit" | "credit") {
  return normalBalance === "credit" ? credit - debit : debit - credit;
}

export function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

/**
 * Opening balance = everything dated before `from`; the period lists only lines
 * dated from..to, in date then number order, with a running balance in cents so
 * nothing drifts. Closing = opening + period movement.
 */
export function buildAccountLedger(account: GlAccount, lines: GlLine[], from: string, to: string): GlLedger {
  let opening = 0;
  const inPeriod: GlLine[] = [];
  for (const line of lines) {
    if (line.accountId !== account.id) continue;
    if (line.date < from) opening += cents(naturalMovement(line.debit, line.credit, account.normalBalance));
    else if (line.date <= to) inPeriod.push(line);
  }
  inPeriod.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number) || a.key.localeCompare(b.key));
  let running = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: GlRow[] = inPeriod.map((line) => {
    running += cents(naturalMovement(line.debit, line.credit, account.normalBalance));
    totalDebit += cents(line.debit);
    totalCredit += cents(line.credit);
    return { ...line, balance: fromCents(running) };
  });
  return { account, opening: fromCents(opening), rows, totalDebit: fromCents(totalDebit), totalCredit: fromCents(totalCredit), closing: fromCents(running) };
}

/** Accounts that have an opening balance or any movement in the period, in code order. */
export function activeAccounts(accounts: GlAccount[], lines: GlLine[], from: string, to: string) {
  return accounts
    .map((account) => buildAccountLedger(account, lines, from, to))
    .filter((ledger) => ledger.rows.length > 0 || Math.abs(ledger.opening) > 0.004)
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
}

/**
 * The P&L loader labels each row with a key: a system key (e.g. "staff_costs"),
 * "account_<id>", or a plain label for categories with no mapped account.
 * Returns the chart account id, or null for an unmapped category.
 */
export function accountIdForPnlKey(key: string, accounts: GlAccount[]): string | null {
  const bySystemKey = accounts.find((account) => account.systemKey && account.systemKey === key);
  if (bySystemKey) return bySystemKey.id;
  if (key.startsWith("account_")) {
    const id = key.slice("account_".length);
    const byId = accounts.find((account) => account.id === id);
    if (byId) return byId.id;
    const byCode = accounts.find((account) => account.code === id);
    if (byCode) return byCode.id;
  }
  return null;
}

/** Trial balance of the same lines, to prove the ledger balances (debits = credits). */
export function ledgerTotals(lines: GlLine[], to: string) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (line.date > to) continue;
    debit += cents(line.debit);
    credit += cents(line.credit);
  }
  return { debit: fromCents(debit), credit: fromCents(credit) };
}

export function drillHref(line: Pick<GlLine, "source" | "href">) {
  return line.href;
}

export function glCsvRows(ledgers: GlLedger[]) {
  const header = ["Account", "Date", "Source", "Legacy / stored no.", "New-style no.", "Reference", "Party", "Property", "Description", "Debit", "Credit", "Balance"];
  const rows: Array<Array<string | number>> = [header];
  for (const ledger of ledgers) {
    const account = `${ledger.account.code} ${ledger.account.name}`;
    rows.push([account, "", "Opening balance", "", "", "", "", "", "", "", "", ledger.opening.toFixed(2)]);
    for (const row of ledger.rows) {
      rows.push([account, row.date, glSourceLabels[row.source], row.number, row.aliasNumber ?? "", row.reference ?? "", row.party, row.property, row.description,
        row.debit ? row.debit.toFixed(2) : "", row.credit ? row.credit.toFixed(2) : "", row.balance.toFixed(2)]);
    }
    rows.push([account, "", "Closing balance", "", "", "", "", "", "", ledger.totalDebit.toFixed(2), ledger.totalCredit.toFixed(2), ledger.closing.toFixed(2)]);
  }
  return rows;
}

export function glQuery(params: { account?: string; from: string; to: string }) {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.account) query.set("account", params.account);
  return query.toString();
}

/** Reads and validates the account/date filters. Defaults: this year to today (Malaysia time). */
export function parseGlParams(params: { account?: string; from?: string; to?: string }, now: Date = new Date()) {
  const today = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const from = isIsoDate(params.from) ? params.from : `${today.slice(0, 4)}-01-01`;
  const to = isIsoDate(params.to) ? params.to : today;
  const error = from > to ? "The start date is after the end date." : "";
  return { account: params.account?.trim() ?? "", from, to, error };
}

export const glScopeNote = "Income and expense accounts agree with the Profit & Loss report. Bank and cash balances come from imported bank statements and open receivables from open invoices, so those accounts list journal-posted movements only.";
