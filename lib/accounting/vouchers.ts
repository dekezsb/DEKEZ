// Pure helpers for Payment / Receipt / Journal vouchers. No database access here,
// so the rules can be unit tested and shared by the forms, pages and actions.

export type VoucherType = "PV" | "RV" | "JV";
export type VoucherStatus = "posted" | "amended" | "voided";
export type RegisterKind = "voucher" | "journal" | "bank";

export type VoucherFormLine = {
  accountId: string;
  propertyId: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
};

export type RegisterHistoryItem = {
  revision: number;
  status: VoucherStatus;
  date: string;
  amount: number;
  at: string;
  reason: string | null;
  label: string;
};

export type RegisterRow = {
  key: string;
  kind: RegisterKind;
  id: string;
  type: VoucherType;
  number: string;
  aliasNumber: string | null;
  revision: number;
  date: string;
  party: string;
  description: string;
  reference: string | null;
  propertyIds: string[];
  amount: number;
  status: VoucherStatus;
  sourceLabel: string;
  editable: boolean;
  notEditableReason: string | null;
  history: RegisterHistoryItem[];
};

export type RegisterFilters = {
  type?: string;
  from?: string;
  to?: string;
  property?: string;
  status?: string;
  q?: string;
};

export const voucherTypeLabels: Record<VoucherType, string> = {
  PV: "Payment Voucher",
  RV: "Receipt Voucher",
  JV: "Journal Voucher",
};

export const voucherErrorMessages: Record<string, string> = {
  voucher_details: "Fill in the date, payee / payer, description and every line.",
  voucher_line_count: "Add at least one line (two for a journal) and no more than 100.",
  voucher_amount: "Amounts must be positive numbers with at most 2 decimals.",
  voucher_invalid_line: "Each line needs an account and an amount (journal lines: debit OR credit).",
  voucher_account: "Choose an active account for every line. A line cannot use the same cash / bank account being paid from.",
  voucher_payment_account: "Choose the cash or bank account the money was paid from / received into.",
  voucher_property: "That property is not available.",
  voucher_property_required: "Choose the property for this rental-cost line.",
  voucher_not_balanced: "Total debit must equal total credit.",
  voucher_period_locked: "That month is locked. Reopen the accounting period first, then edit.",
  voucher_reason_required: "Give a reason (at least 5 characters). It is kept in the audit trail.",
  voucher_already_changed: "This voucher was already edited or voided. Open the latest revision.",
  voucher_bank_matched: "This voucher is matched to a bank statement line. You can change accounts and descriptions, but to change the amount or bank account (or to void it), unlink it in Bank Reconciliation first.",
  voucher_missing: "That voucher could not be found. Refresh and try again.",
  voucher_source_not_editable: "This entry is created by another module and must be corrected there.",
  voucher_total: "The corrected lines must add up to the same bank amount.",
  voucher_statement_closed: "The bank statement for this voucher is already reconciled. Reopen it before voiding.",
  voucher_not_allowed: "Only owners and admins can post or change vouchers.",
  voucher_failed: "The voucher could not be saved. Nothing was changed.",
};

export function voucherErrorCode(message: string | undefined | null) {
  const match = (message ?? "").match(/voucher_[a-z_]+/);
  return match && voucherErrorMessages[match[0]] ? match[0] : "voucher_failed";
}

const money2 = /^\d+(\.\d{1,2})?$/;

export function cleanAmount(value: string | number | undefined | null) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return "";
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return "";
  return (Math.round(number * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

/** Validates the form lines and returns the RPC payload, or an error code. */
export function voucherLinesPayload(type: VoucherType, lines: VoucherFormLine[]) {
  const used = lines.filter((line) => line.accountId || line.amount || line.debit || line.credit || line.description);
  if (used.length < (type === "JV" ? 2 : 1) || used.length > 100) return { error: "voucher_line_count" as const };
  if (type === "JV") {
    const payload = used.map((line) => ({
      account_id: line.accountId,
      property_id: line.propertyId || null,
      description: line.description.trim() || null,
      debit: cleanAmount(line.debit) || "0",
      credit: cleanAmount(line.credit) || "0",
    }));
    if (payload.some((line) => !line.account_id || !money2.test(line.debit) || !money2.test(line.credit)
      || !((Number(line.debit) > 0) !== (Number(line.credit) > 0)))) return { error: "voucher_invalid_line" as const };
    const debit = sumCents(payload.map((line) => line.debit));
    const credit = sumCents(payload.map((line) => line.credit));
    if (debit <= 0 || debit !== credit) return { error: "voucher_not_balanced" as const };
    return { lines: payload, total: debit / 100 };
  }
  const payload = used.map((line) => ({
    account_id: line.accountId,
    property_id: line.propertyId || null,
    description: line.description.trim() || null,
    amount: cleanAmount(line.amount),
  }));
  if (payload.some((line) => !line.account_id || !money2.test(line.amount) || Number(line.amount) <= 0)) {
    return { error: "voucher_invalid_line" as const };
  }
  return { lines: payload, total: sumCents(payload.map((line) => line.amount)) / 100 };
}

export function sumCents(values: string[]) {
  return values.reduce((total, value) => total + Math.round(Number(value || 0) * 100), 0);
}

/** Journal preview for a PV/RV: detail lines plus the balancing cash/bank line. */
export function voucherJournalPreview(type: VoucherType, lines: VoucherFormLine[], paymentAccountId: string) {
  const result = voucherLinesPayload(type, lines);
  if ("error" in result) return null;
  if (type === "JV") return result.lines.map((line) => ({ accountId: line.account_id, debit: Number((line as { debit: string }).debit), credit: Number((line as { credit: string }).credit) }));
  const details = result.lines.map((line) => ({
    accountId: line.account_id,
    debit: type === "PV" ? Number((line as { amount: string }).amount) : 0,
    credit: type === "RV" ? Number((line as { amount: string }).amount) : 0,
  }));
  return [...details, { accountId: paymentAccountId, debit: type === "RV" ? result.total : 0, credit: type === "PV" ? result.total : 0 }];
}

export const newStyleNumberPattern = /^[A-Z]{1,6}\d{4}-\d{3,}$/;

export function isNewStyleNumber(value: string) {
  return newStyleNumberPattern.test(value.trim().toUpperCase());
}

/** Journal sources and whether / where they can be corrected. */
export function journalEditability(sourceType: string): { editable: boolean; reason: string | null } {
  switch (sourceType) {
    case "manual_journal":
    case "tenant_deposit_settlement":
    case "payment_voucher":
    case "receipt_voucher":
      return { editable: true, reason: null };
    case "journal_reversal":
      return { editable: false, reason: "Automatic reversal created by an edit or void. It cannot be changed; edit the voucher instead." };
    case "renovation_invoice":
    case "renovation_invoice_adjustment":
      return { editable: false, reason: "Renovation invoice posting. Correct or void it from the renovation invoice itself (Renovation > invoice > Correct / Void)." };
    case "historical_rental_credit":
      return { editable: false, reason: "Historical bank clean-up batch. It is locked so the audited clean-up cannot drift; post a JV to adjust." };
    default:
      return { editable: false, reason: "Created by another module. Correct it from that module." };
  }
}

export function filterRegister(rows: RegisterRow[], filters: RegisterFilters) {
  const query = (filters.q ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.type && ["PV", "RV", "JV"].includes(filters.type) && row.type !== filters.type) return false;
    if (filters.status && ["posted", "amended", "voided"].includes(filters.status)) {
      if (filters.status === "amended" ? row.revision < 2 : row.status !== filters.status) return false;
    }
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    if (filters.property && !row.propertyIds.includes(filters.property)) return false;
    if (query) {
      const haystack = [row.number, row.aliasNumber, row.party, row.description, row.reference, row.amount.toFixed(2)]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function statusLabel(row: Pick<RegisterRow, "status" | "revision">) {
  if (row.status === "voided") return "Voided";
  if (row.revision > 1) return `Amended (rev ${row.revision})`;
  return "Posted";
}

export function registerCsvRows(rows: RegisterRow[], propertyNames: Map<string, string>) {
  return [
    ["Voucher No", "New-style No", "Type", "Revision", "Date", "Payee / Payer", "Description", "Reference", "Property", "Amount (RM)", "Status", "Source"],
    ...rows.map((row) => [
      row.number, row.aliasNumber ?? "", row.type, row.revision, row.date, row.party, row.description, row.reference ?? "",
      row.propertyIds.map((id) => propertyNames.get(id) ?? "").filter(Boolean).join(" / ") || "General company",
      row.amount.toFixed(2), statusLabel(row), row.sourceLabel,
    ]),
  ];
}

export function amountInWords(value: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const words = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`;
    if (n < 1000) return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${words(n % 100)}` : ""}`;
    if (n < 1_000_000) return `${words(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${words(n % 1000)}` : ""}`;
    return `${words(Math.floor(n / 1_000_000))} Million${n % 1_000_000 ? ` ${words(n % 1_000_000)}` : ""}`;
  };
  const cents = Math.round(value * 100);
  const ringgit = Math.floor(cents / 100);
  const sen = cents % 100;
  return `Ringgit Malaysia ${ringgit ? words(ringgit) : "Zero"}${sen ? ` and Sen ${words(sen)}` : ""} Only`;
}

export function editHref(row: Pick<RegisterRow, "kind" | "id">) {
  return `/reports/vouchers/edit?${new URLSearchParams({ kind: row.kind, id: row.id }).toString()}`;
}

export function printHref(row: Pick<RegisterRow, "kind" | "id">) {
  return `/reports/vouchers/print?${new URLSearchParams({ kind: row.kind, id: row.id }).toString()}`;
}
