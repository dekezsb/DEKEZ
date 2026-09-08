import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfitLossLedgerDetail = {
  id: string;
  sourceType: "rental_invoice" | "invoice_charge" | "company_expense" | "utility_bill" | "bank_adjustment" | "journal_entry";
  sourceLabel: string;
  date: string;
  documentNumber: string;
  referenceNumber: string | null;
  propertyName: string;
  roomName: string | null;
  partyName: string | null;
  description: string;
  debit: number;
  credit: number;
  amount: number;
};

export type ProfitLossRow = {
  key: string;
  label: string;
  amount: number;
  details: ProfitLossLedgerDetail[];
};

type ReportingAccount = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  account_type?: string | null;
  report_group?: string | null;
  system_key?: string | null;
};

export type ProfitLossReport = {
  revenue: ProfitLossRow[];
  costsOfSales: ProfitLossRow[];
  expenses: ProfitLossRow[];
  totalRevenue: number;
  totalCostOfSales: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  invoiceCount: number;
  expenseCount: number;
};

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function assertQuerySucceeded(source: string, error: unknown) {
  if (!error) return;
  const message = typeof error === "object" && error && "message" in error
    ? String(error.message)
    : "Unknown database error";
  throw new Error(`Accurate P&L unavailable: ${source} could not be loaded. ${message}`);
}

function addRow(
  rows: Map<string, ProfitLossRow>,
  key: string,
  label: string,
  amount: number,
  detail?: ProfitLossLedgerDetail | null,
) {
  if (Math.abs(amount) < 0.005) return;
  const current = rows.get(key);
  rows.set(key, {
    key,
    label,
    amount: numberValue(current?.amount) + amount,
    details: detail ? [...(current?.details ?? []), detail] : current?.details ?? [],
  });
}

const canonicalAccountRows: Record<string, Pick<ProfitLossRow, "key" | "label">> = {
  rental_income: { key: "rental_income", label: "Rental Income" },
  top_up_utilities_income: { key: "top_up_utilities_income", label: "Top Up Utilities Income" },
  electricity_income: { key: "electricity_income", label: "Electricity Charges Income" },
  other_tenant_income: { key: "other_tenant_income", label: "Other Tenant Charges Income" },
};

function reportingRowForAccount(account: ReportingAccount) {
  const systemKey = account.system_key?.trim();
  if (systemKey && canonicalAccountRows[systemKey]) return canonicalAccountRows[systemKey];

  const name = account.name?.trim() || "Uncategorised Account";
  return {
    key: systemKey || `account_${account.id ?? account.code ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    label: name,
  };
}

function normalizedExpenseLabel(name: string | null | undefined) {
  const value = name?.trim() || "Other Operating Expenses";
  if (/repair|maintenance/i.test(value)) return "Repairs & Maintenance";
  if (/electric|water|utilit|internet|telephone/i.test(value)) return "Utilities";
  if (/clean/i.test(value)) return "Cleaning";
  if (/professional|legal|account/i.test(value)) return "Professional Fees";
  if (/salary|staff|wage/i.test(value)) return "Staff Costs";
  if (/office|admin/i.test(value)) return "Office & Administration";
  if (/bank/i.test(value)) return "Bank Charges";
  return value;
}

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function propertyLabel(value: unknown) {
  const property = singleRelation(value as { name?: string | null; property_code?: string | null } | { name?: string | null; property_code?: string | null }[] | null);
  return property?.name?.trim() || property?.property_code?.trim() || "General company";
}

function roomLabel(value: unknown) {
  const room = singleRelation(value as { name?: string | null; room_number?: string | null } | { name?: string | null; room_number?: string | null }[] | null);
  if (!room) return null;
  return room.name?.trim() || (room.room_number ? `Room ${room.room_number}` : null);
}

function tenancyTenantName(value: unknown) {
  const tenancy = singleRelation(value as { tenants?: { full_name?: string | null } | { full_name?: string | null }[] | null } | { tenants?: { full_name?: string | null } | { full_name?: string | null }[] | null }[] | null);
  const tenant = singleRelation(tenancy?.tenants);
  return tenant?.full_name?.trim() || null;
}

function ledgerMonthLabel(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}/.test(value)) return "the rental month";
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value.slice(0, 7)}-01T00:00:00Z`));
}

function shortDocument(prefix: string, id: string) {
  return `${prefix} ${id.slice(0, 8).toUpperCase()}`;
}

export async function getProfitLossReport(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    startDate: string;
    endDate: string;
    propertyId?: string | null;
    includeDetails?: boolean;
  },
): Promise<ProfitLossReport> {
  let rentBillsQuery = supabase
    .from("rent_bills")
    .select("id, tenancy_id, tenant_id, tenant_record_id, property_id, room_id, bill_month, invoice_date, invoice_number, notes, amount, status, removed_at, properties!inner(id, company_id, name, property_code), rooms(id, name, room_number), tenancies(id, tenants(id, full_name))")
    .eq("properties.company_id", input.companyId)
    .gte("bill_month", input.startDate)
    .lte("bill_month", input.endDate)
    .not("status", "in", '("cancelled","waived","draft")')
    .is("removed_at", null);

  let expensesQuery = supabase
    .from("expenses")
    .select("id, property_id, room_id, amount, tax_amount, charge_to, status, expense_date, supplier, description, receipt_number, expense_categories(name), properties(id, name, property_code), rooms(id, name, room_number)")
    .eq("company_id", input.companyId)
    .eq("charge_to", "company")
    .in("status", ["verified", "reimbursed"])
    .gte("expense_date", input.startDate)
    .lte("expense_date", input.endDate);

  let utilityBillsQuery = supabase
    .from("utility_bills")
    .select("id, tenant_id, property_id, room_id, utility_type, amount, status, bill_month, notes, reference_number, properties!inner(id, company_id, name, property_code), rooms(id, name, room_number)")
    .eq("properties.company_id", input.companyId)
    .neq("status", "cancelled")
    .gte("bill_month", input.startDate)
    .lte("bill_month", input.endDate);

  if (input.propertyId) {
    rentBillsQuery = rentBillsQuery.eq("property_id", input.propertyId);
    expensesQuery = expensesQuery.eq("property_id", input.propertyId);
    utilityBillsQuery = utilityBillsQuery.eq("property_id", input.propertyId);
  }

  const [rentBillsResult, expensesResult, utilityBillsResult] = await Promise.all([
    rentBillsQuery,
    expensesQuery,
    utilityBillsQuery,
  ]);
  assertQuerySucceeded("rental invoices", rentBillsResult.error);
  assertQuerySucceeded("company expenses", expensesResult.error);
  assertQuerySucceeded("utility bills", utilityBillsResult.error);
  const rentBills = rentBillsResult.data;
  const expenses = expensesResult.data;
  const utilityBills = utilityBillsResult.data;

  const billIds = (rentBills ?? []).map((bill) => bill.id);
  const lineItemsResult = billIds.length
    ? await supabase
        .from("rental_invoice_line_items")
        .select("id, rent_bill_id, category, description, amount")
        .in("rent_bill_id", billIds)
    : { data: [], error: null };
  assertQuerySucceeded("rental invoice charges", lineItemsResult.error);
  const lineItems = lineItemsResult.data;

  let manualTransactionsQuery = supabase
    .from("bank_manual_transactions")
    .select("id, amount, transaction_date, property_id, description, reference_number, properties(id, name, property_code), accounting_accounts!bank_manual_transactions_offset_account_id_fkey(id, code, name, account_type, report_group, system_key)")
    .eq("company_id", input.companyId)
    .gte("transaction_date", input.startDate)
    .lte("transaction_date", input.endDate);
  if (input.propertyId) manualTransactionsQuery = manualTransactionsQuery.eq("property_id", input.propertyId);
  const manualTransactionsResult = await manualTransactionsQuery;
  assertQuerySucceeded("bank adjustments", manualTransactionsResult.error);
  const manualTransactions = manualTransactionsResult.data;

  const journalEntriesResult = await supabase
    .from("accounting_journal_entries")
    .select("id, entry_date, entry_number, source_type, source_id, reference_number, description")
    .eq("company_id", input.companyId)
    .eq("status", "posted")
    .gte("entry_date", input.startDate)
    .lte("entry_date", input.endDate);
  assertQuerySucceeded("posted journal entries", journalEntriesResult.error);
  const journalEntries = journalEntriesResult.data;
  const journalEntryIds = (journalEntries ?? []).map((entry) => entry.id);
  let journalLinesQuery = journalEntryIds.length
      ? supabase
          .from("accounting_journal_lines")
          .select("id, journal_entry_id, property_id, tenant_id, description, debit, credit, properties(id, name, property_code), accounting_accounts!inner(id, code, name, account_type, report_group, system_key)")
        .in("journal_entry_id", journalEntryIds)
    : null;
  if (journalLinesQuery && input.propertyId) {
    journalLinesQuery = journalLinesQuery.eq("property_id", input.propertyId);
  }
  const journalLinesResult = journalLinesQuery
    ? await journalLinesQuery
    : { data: [], error: null };
  assertQuerySucceeded("posted journal lines", journalLinesResult.error);
  const journalLines = journalLinesResult.data;

  const journalSourceIds = Array.from(new Set(
    (journalEntries ?? []).map((entry) => entry.source_id).filter((id): id is string => Boolean(id)),
  ));
  const profileIds = Array.from(new Set([
    ...(rentBills ?? []).map((bill) => bill.tenant_id),
    ...(utilityBills ?? []).map((bill) => bill.tenant_id),
    ...(journalLines ?? []).map((line) => line.tenant_id),
  ].filter((id): id is string => Boolean(id))));
  const [sourceTenanciesResult, profilesResult] = input.includeDetails
    ? await Promise.all([
        journalSourceIds.length
          ? supabase
              .from("tenancies")
              .select("id, property_id, room_id, properties!tenancies_property_id_fkey(id, name, property_code), rooms!tenancies_room_id_fkey(id, name, room_number), tenants!tenancies_tenant_id_fkey(id, full_name)")
              .in("id", journalSourceIds)
          : Promise.resolve({ data: [], error: null }),
        profileIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
          : Promise.resolve({ data: [], error: null }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  assertQuerySucceeded("tenancy references for the supporting ledger", sourceTenanciesResult.error);
  assertQuerySucceeded("tenant and payee names for the supporting ledger", profilesResult.error);
  const sourceTenancies = sourceTenanciesResult.data;
  const profiles = profilesResult.data;

  const rentBillById = new Map((rentBills ?? []).map((bill) => [bill.id, bill]));
  const journalEntryById = new Map((journalEntries ?? []).map((entry) => [entry.id, entry]));
  const sourceTenancyById = new Map((sourceTenancies ?? []).map((tenancy) => [tenancy.id, tenancy]));
  const profileNameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name?.trim() || "Tenant"]));
  const revenue = new Map<string, ProfitLossRow>();
  const costOfSalesRows = new Map<string, ProfitLossRow>();
  const expenseRows = new Map<string, ProfitLossRow>();

  for (const bill of rentBills ?? []) {
    const amount = numberValue(bill.amount);
    addRow(revenue, "rental_income", "Rental Income", amount, input.includeDetails ? {
      id: `rent:${bill.id}`,
      sourceType: "rental_invoice",
      sourceLabel: "Rental invoice",
      date: bill.bill_month,
      documentNumber: bill.invoice_number || shortDocument("Invoice", bill.id),
      referenceNumber: bill.invoice_date && bill.invoice_date !== bill.bill_month ? `Issued ${bill.invoice_date}` : null,
      propertyName: propertyLabel(bill.properties),
      roomName: roomLabel(bill.rooms),
      partyName: tenancyTenantName(bill.tenancies) || (bill.tenant_id ? profileNameById.get(bill.tenant_id) ?? null : null),
      description: bill.notes?.trim() || `Monthly rent · ${ledgerMonthLabel(bill.bill_month)}`,
      debit: 0,
      credit: amount,
      amount,
    } : null);
  }

  for (const line of lineItems ?? []) {
    const category = String(line.category ?? "other");
    const amount = numberValue(line.amount);
    const bill = rentBillById.get(line.rent_bill_id);
    const detail: ProfitLossLedgerDetail | null = input.includeDetails ? {
      id: `line:${line.id}`,
      sourceType: "invoice_charge",
      sourceLabel: category === "top_up_utilities" ? "Top-up invoice line" : category === "electricity" ? "Electricity invoice line" : "Tenant charge invoice line",
      date: bill?.bill_month ?? input.startDate,
      documentNumber: bill?.invoice_number || shortDocument("Invoice line", line.id),
      referenceNumber: bill?.invoice_date && bill.invoice_date !== bill.bill_month ? `Issued ${bill.invoice_date}` : null,
      propertyName: propertyLabel(bill?.properties),
      roomName: roomLabel(bill?.rooms),
      partyName: tenancyTenantName(bill?.tenancies) || (bill?.tenant_id ? profileNameById.get(bill.tenant_id) ?? null : null),
      description: line.description?.trim() || category.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase()),
      debit: 0,
      credit: amount,
      amount,
    } : null;
    if (category === "top_up_utilities") {
      addRow(revenue, "top_up_utilities_income", "Top Up Utilities Income", amount, detail);
    } else if (category === "electricity") {
      addRow(revenue, "electricity_income", "Electricity Charges Income", amount, detail);
    } else {
      addRow(revenue, "other_tenant_income", "Other Tenant Charges Income", amount, detail);
    }
  }

  for (const expense of expenses ?? []) {
    const relation = expense.expense_categories as
      | { name: string | null }
      | { name: string | null }[]
      | null;
    const category = Array.isArray(relation) ? relation[0]?.name : relation?.name;
    const label = normalizedExpenseLabel(category);
    const amount = numberValue(expense.amount);
    addRow(expenseRows, label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label, amount, input.includeDetails ? {
      id: `expense:${expense.id}`,
      sourceType: "company_expense",
      sourceLabel: "Verified company expense",
      date: expense.expense_date,
      documentNumber: expense.receipt_number?.trim() || shortDocument("Expense", expense.id),
      referenceNumber: null,
      propertyName: propertyLabel(expense.properties),
      roomName: roomLabel(expense.rooms),
      partyName: expense.supplier?.trim() || null,
      description: expense.description?.trim() || category || "Company expense",
      debit: amount,
      credit: 0,
      amount,
    } : null);
  }

  for (const utility of utilityBills ?? []) {
    const label = `${String(utility.utility_type ?? "Utility").replace(/^./, (value) => value.toUpperCase())} Utilities`;
    const amount = numberValue(utility.amount);
    addRow(expenseRows, `utility_${utility.utility_type ?? "other"}`, label, amount, input.includeDetails ? {
      id: `utility:${utility.id}`,
      sourceType: "utility_bill",
      sourceLabel: "Utility bill",
      date: utility.bill_month,
      documentNumber: utility.reference_number?.trim() || shortDocument("Utility", utility.id),
      referenceNumber: null,
      propertyName: propertyLabel(utility.properties),
      roomName: roomLabel(utility.rooms),
      partyName: utility.tenant_id ? profileNameById.get(utility.tenant_id) ?? null : null,
      description: utility.notes?.trim() || `${label} · ${ledgerMonthLabel(utility.bill_month)}`,
      debit: amount,
      credit: 0,
      amount,
    } : null);
  }

  for (const transaction of manualTransactions ?? []) {
    const relation = transaction.accounting_accounts;
    const account = Array.isArray(relation) ? relation[0] : relation;
    const amount = Math.abs(numberValue(transaction.amount));
    if (account?.account_type === "income") {
      const row = reportingRowForAccount(account);
      addRow(revenue, row.key, row.label, amount, input.includeDetails ? {
        id: `manual:${transaction.id}`,
        sourceType: "bank_adjustment",
        sourceLabel: "Bank adjustment",
        date: transaction.transaction_date,
        documentNumber: shortDocument("Bank adjustment", transaction.id),
        referenceNumber: transaction.reference_number?.trim() || null,
        propertyName: propertyLabel(transaction.properties),
        roomName: null,
        partyName: null,
        description: transaction.description,
        debit: 0,
        credit: amount,
        amount,
      } : null);
    } else if (account?.account_type === "expense") {
      const target = account.report_group === "cost_of_sales" ? costOfSalesRows : expenseRows;
      const row = reportingRowForAccount(account);
      addRow(target, row.key, row.label, amount, input.includeDetails ? {
        id: `manual:${transaction.id}`,
        sourceType: "bank_adjustment",
        sourceLabel: "Bank adjustment",
        date: transaction.transaction_date,
        documentNumber: shortDocument("Bank adjustment", transaction.id),
        referenceNumber: transaction.reference_number?.trim() || null,
        propertyName: propertyLabel(transaction.properties),
        roomName: null,
        partyName: null,
        description: transaction.description,
        debit: amount,
        credit: 0,
        amount,
      } : null);
    }
  }

  for (const line of journalLines ?? []) {
    const relation = line.accounting_accounts;
    const account = Array.isArray(relation) ? relation[0] : relation;
    const debit = numberValue(line.debit);
    const credit = numberValue(line.credit);
    const entry = journalEntryById.get(line.journal_entry_id);
    const sourceTenancy = entry?.source_id ? sourceTenancyById.get(entry.source_id) : null;
    const sourceLabel = entry?.source_type
      ? String(entry.source_type).replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase())
      : "Posted journal";
    if (account?.account_type === "income") {
      const row = reportingRowForAccount(account);
      const amount = credit - debit;
      addRow(revenue, row.key, row.label, amount, input.includeDetails ? {
        id: `journal:${line.id}`,
        sourceType: "journal_entry",
        sourceLabel,
        date: entry?.entry_date ?? input.startDate,
        documentNumber: entry?.entry_number || shortDocument("Journal", line.id),
        referenceNumber: entry?.reference_number?.trim() || null,
        propertyName: propertyLabel(singleRelation(line.properties) ?? sourceTenancy?.properties),
        roomName: roomLabel(sourceTenancy?.rooms),
        partyName: (line.tenant_id ? profileNameById.get(line.tenant_id) : null) || tenancyTenantName(sourceTenancy),
        description: line.description?.trim() || entry?.description?.trim() || "Posted journal entry",
        debit,
        credit,
        amount,
      } : null);
    } else if (account?.account_type === "expense") {
      const target = account.report_group === "cost_of_sales" ? costOfSalesRows : expenseRows;
      const row = reportingRowForAccount(account);
      const amount = debit - credit;
      addRow(target, row.key, row.label, amount, input.includeDetails ? {
        id: `journal:${line.id}`,
        sourceType: "journal_entry",
        sourceLabel,
        date: entry?.entry_date ?? input.startDate,
        documentNumber: entry?.entry_number || shortDocument("Journal", line.id),
        referenceNumber: entry?.reference_number?.trim() || null,
        propertyName: propertyLabel(singleRelation(line.properties) ?? sourceTenancy?.properties),
        roomName: roomLabel(sourceTenancy?.rooms),
        partyName: (line.tenant_id ? profileNameById.get(line.tenant_id) : null) || tenancyTenantName(sourceTenancy),
        description: line.description?.trim() || entry?.description?.trim() || "Posted journal entry",
        debit,
        credit,
        amount,
      } : null);
    }
  }

  const finalizeRows = (rows: Map<string, ProfitLossRow>) => Array.from(rows.values())
    .map((row) => ({
      ...row,
      details: row.details.sort((left, right) => left.date.localeCompare(right.date) || left.documentNumber.localeCompare(right.documentNumber)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const revenueRows = finalizeRows(revenue);
  const directCostRows = finalizeRows(costOfSalesRows);
  const operatingExpenseRows = finalizeRows(expenseRows);
  const totalRevenue = revenueRows.reduce((total, row) => total + row.amount, 0);
  const totalCostOfSales = directCostRows.reduce((total, row) => total + row.amount, 0);
  const grossProfit = totalRevenue - totalCostOfSales;
  const totalExpenses = operatingExpenseRows.reduce((total, row) => total + row.amount, 0);

  return {
    revenue: revenueRows,
    costsOfSales: directCostRows,
    expenses: operatingExpenseRows,
    totalRevenue,
    totalCostOfSales,
    grossProfit,
    totalExpenses,
    netProfit: grossProfit - totalExpenses,
    invoiceCount: (rentBills ?? []).length,
    expenseCount: (expenses ?? []).length + (utilityBills ?? []).length,
  };
}

export function previousPeriod(startDate: string, _endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const previousStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const previousEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}
