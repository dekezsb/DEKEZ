import type { SupabaseClient } from "@supabase/supabase-js";

type ProfitLossRow = {
  key: string;
  label: string;
  amount: number;
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

function addRow(rows: Map<string, ProfitLossRow>, key: string, label: string, amount: number) {
  if (Math.abs(amount) < 0.005) return;
  const current = rows.get(key);
  rows.set(key, {
    key,
    label,
    amount: numberValue(current?.amount) + amount,
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

export async function getProfitLossReport(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    startDate: string;
    endDate: string;
    propertyId?: string | null;
  },
): Promise<ProfitLossReport> {
  let rentBillsQuery = supabase
    .from("rent_bills")
    .select("id, property_id, bill_month, amount, status, removed_at, properties!inner(company_id)")
    .eq("properties.company_id", input.companyId)
    .gte("bill_month", input.startDate)
    .lte("bill_month", input.endDate)
    .not("status", "in", '("cancelled","waived","draft")')
    .is("removed_at", null);

  let expensesQuery = supabase
    .from("expenses")
    .select("id, property_id, amount, tax_amount, charge_to, status, expense_date, expense_categories(name)")
    .eq("company_id", input.companyId)
    .eq("charge_to", "company")
    .in("status", ["verified", "reimbursed"])
    .gte("expense_date", input.startDate)
    .lte("expense_date", input.endDate);

  let utilityBillsQuery = supabase
    .from("utility_bills")
    .select("id, property_id, utility_type, amount, status, bill_month, properties!inner(company_id)")
    .eq("properties.company_id", input.companyId)
    .neq("status", "cancelled")
    .gte("bill_month", input.startDate)
    .lte("bill_month", input.endDate);

  if (input.propertyId) {
    rentBillsQuery = rentBillsQuery.eq("property_id", input.propertyId);
    expensesQuery = expensesQuery.eq("property_id", input.propertyId);
    utilityBillsQuery = utilityBillsQuery.eq("property_id", input.propertyId);
  }

  const [{ data: rentBills }, { data: expenses }, { data: utilityBills }] = await Promise.all([
    rentBillsQuery,
    expensesQuery,
    utilityBillsQuery,
  ]);

  const billIds = (rentBills ?? []).map((bill) => bill.id);
  const { data: lineItems } = billIds.length
    ? await supabase
        .from("rental_invoice_line_items")
        .select("id, rent_bill_id, category, amount")
        .in("rent_bill_id", billIds)
    : { data: [] };

  const revenue = new Map<string, ProfitLossRow>();
  const costOfSalesRows = new Map<string, ProfitLossRow>();
  const expenseRows = new Map<string, ProfitLossRow>();

  addRow(
    revenue,
    "rental_income",
    "Rental Income",
    (rentBills ?? []).reduce((total, bill) => total + numberValue(bill.amount), 0),
  );

  for (const line of lineItems ?? []) {
    const category = String(line.category ?? "other");
    const amount = numberValue(line.amount);
    if (category === "top_up_utilities") {
      addRow(revenue, "top_up_utilities_income", "Top Up Utilities Income", amount);
    } else if (category === "electricity") {
      addRow(revenue, "electricity_income", "Electricity Charges Income", amount);
    } else {
      addRow(revenue, "other_tenant_income", "Other Tenant Charges Income", amount);
    }
  }

  for (const expense of expenses ?? []) {
    const relation = expense.expense_categories as
      | { name: string | null }
      | { name: string | null }[]
      | null;
    const category = Array.isArray(relation) ? relation[0]?.name : relation?.name;
    const label = normalizedExpenseLabel(category);
    addRow(expenseRows, label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label, numberValue(expense.amount));
  }

  for (const utility of utilityBills ?? []) {
    const label = `${String(utility.utility_type ?? "Utility").replace(/^./, (value) => value.toUpperCase())} Utilities`;
    addRow(expenseRows, `utility_${utility.utility_type ?? "other"}`, label, numberValue(utility.amount));
  }

  let manualTransactionsQuery = supabase
    .from("bank_manual_transactions")
    .select("id, amount, transaction_date, property_id, accounting_accounts!bank_manual_transactions_offset_account_id_fkey(id, code, name, account_type, report_group, system_key)")
    .eq("company_id", input.companyId)
    .gte("transaction_date", input.startDate)
    .lte("transaction_date", input.endDate);
  if (input.propertyId) manualTransactionsQuery = manualTransactionsQuery.eq("property_id", input.propertyId);
  const { data: manualTransactions } = await manualTransactionsQuery;

  for (const transaction of manualTransactions ?? []) {
    const relation = transaction.accounting_accounts;
    const account = Array.isArray(relation) ? relation[0] : relation;
    const amount = Math.abs(numberValue(transaction.amount));
    if (account?.account_type === "income") {
      const row = reportingRowForAccount(account);
      addRow(revenue, row.key, row.label, amount);
    } else if (account?.account_type === "expense") {
      const target = account.report_group === "cost_of_sales" ? costOfSalesRows : expenseRows;
      const row = reportingRowForAccount(account);
      addRow(target, row.key, row.label, amount);
    }
  }

  const { data: journalEntries } = await supabase
    .from("accounting_journal_entries")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("status", "posted")
    .gte("entry_date", input.startDate)
    .lte("entry_date", input.endDate);
  const journalEntryIds = (journalEntries ?? []).map((entry) => entry.id);
  let journalLinesQuery = journalEntryIds.length
    ? supabase
        .from("accounting_journal_lines")
        .select("debit, credit, property_id, accounting_accounts!inner(id, code, name, account_type, report_group, system_key)")
        .in("journal_entry_id", journalEntryIds)
    : null;
  if (journalLinesQuery && input.propertyId) {
    journalLinesQuery = journalLinesQuery.eq("property_id", input.propertyId);
  }
  const { data: journalLines } = journalLinesQuery
    ? await journalLinesQuery
    : { data: [] };

  for (const line of journalLines ?? []) {
    const relation = line.accounting_accounts;
    const account = Array.isArray(relation) ? relation[0] : relation;
    const debit = numberValue(line.debit);
    const credit = numberValue(line.credit);
    if (account?.account_type === "income") {
      const row = reportingRowForAccount(account);
      addRow(revenue, row.key, row.label, credit - debit);
    } else if (account?.account_type === "expense") {
      const target = account.report_group === "cost_of_sales" ? costOfSalesRows : expenseRows;
      const row = reportingRowForAccount(account);
      addRow(target, row.key, row.label, debit - credit);
    }
  }

  const revenueRows = Array.from(revenue.values()).sort((left, right) => left.label.localeCompare(right.label));
  const directCostRows = Array.from(costOfSalesRows.values()).sort((left, right) => left.label.localeCompare(right.label));
  const operatingExpenseRows = Array.from(expenseRows.values()).sort((left, right) => left.label.localeCompare(right.label));
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

export function previousPeriod(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start.getTime() - 86_400_000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86_400_000);
  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}
