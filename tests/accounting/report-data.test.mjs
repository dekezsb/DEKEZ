import assert from "node:assert/strict";
import test from "node:test";

import { getProfitLossReport } from "../../lib/accounting/report-data.ts";

const COMPANY_ID = "company-1";
const PROPERTY = {
  id: "property-1",
  company_id: COMPANY_ID,
  name: "PTT - PUTATAN",
  property_code: "PTT",
};

function valueAtPath(row, path) {
  return path.split(".").reduce((value, key) => {
    if (Array.isArray(value)) return value[0]?.[key];
    return value?.[key];
  }, row);
}

function listFilterValues(value) {
  return String(value)
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""));
}

class FakeQuery {
  #rows;
  #filters = [];

  constructor(rows) {
    this.#rows = rows;
  }

  select() {
    return this;
  }

  eq(path, expected) {
    this.#filters.push((row) => valueAtPath(row, path) === expected);
    return this;
  }

  neq(path, expected) {
    this.#filters.push((row) => valueAtPath(row, path) !== expected);
    return this;
  }

  gte(path, expected) {
    this.#filters.push((row) => valueAtPath(row, path) >= expected);
    return this;
  }

  lte(path, expected) {
    this.#filters.push((row) => valueAtPath(row, path) <= expected);
    return this;
  }

  is(path, expected) {
    this.#filters.push((row) => valueAtPath(row, path) === expected);
    return this;
  }

  in(path, expected) {
    this.#filters.push((row) => expected.includes(valueAtPath(row, path)));
    return this;
  }

  not(path, operator, expected) {
    assert.equal(operator, "in", `Unsupported fake-query operator: ${operator}`);
    const excluded = listFilterValues(expected);
    this.#filters.push((row) => !excluded.includes(String(valueAtPath(row, path))));
    return this;
  }

  then(resolve, reject) {
    const data = this.#rows.filter((row) => this.#filters.every((filter) => filter(row)));
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

function fakeSupabase(overrides = {}) {
  const tables = {
    rent_bills: [],
    rental_invoice_line_items: [],
    expenses: [],
    utility_bills: [],
    bank_manual_transactions: [],
    accounting_journal_entries: [],
    accounting_journal_lines: [],
    accounting_category_mappings: [],
    tenancies: [],
    profiles: [],
    payments: [],
    ...overrides,
  };

  return {
    from(table) {
      assert.ok(table in tables, `Unexpected table queried by P&L: ${table}`);
      return new FakeQuery(tables[table]);
    },
  };
}

function report(supabase, startDate, endDate, includeDetails = true) {
  return getProfitLossReport(supabase, {
    companyId: COMPANY_ID,
    startDate,
    endDate,
    includeDetails,
  });
}

test("a July 5050 bank adjustment appears in July COGS and never leaks into September", async () => {
  const supabase = fakeSupabase({
    bank_manual_transactions: [{
      id: "manual-july-landlord-rent",
      company_id: COMPANY_ID,
      amount: -1_000,
      transaction_date: "2026-07-07",
      property_id: PROPERTY.id,
      description: "July master rent for PTT",
      reference_number: "PV-2026-0707",
      properties: PROPERTY,
      accounting_accounts: {
        id: "account-5050",
        code: "5050",
        name: "Property Rental Cost",
        account_type: "expense",
        report_group: "cost_of_sales",
        system_key: "property_rental_cost",
      },
    }],
  });

  const july = await report(supabase, "2026-07-01", "2026-07-31");
  assert.equal(july.totalCostOfSales, 1_000);
  assert.equal(july.costsOfSales.length, 1);
  assert.equal(july.costsOfSales[0].label, "Property Rental Cost");
  assert.equal(july.costsOfSales[0].details[0].date, "2026-07-07");
  assert.equal(july.grossProfit, -1_000);

  const september = await report(supabase, "2026-09-01", "2026-09-30");
  assert.equal(september.totalCostOfSales, 0);
  assert.deepEqual(september.costsOfSales, []);
});

test("matched bank income and expense use the correct P&L direction", async () => {
  const supabase = fakeSupabase({
    bank_manual_transactions: [
      {
        id: "manual-income",
        company_id: COMPANY_ID,
        amount: 50,
        transaction_date: "2026-07-08",
        property_id: PROPERTY.id,
        description: "Electricity top-up",
        reference_number: "CR-50",
        properties: PROPERTY,
        accounting_accounts: {
          id: "electricity-income",
          code: "4100",
          name: "Electricity Charges Income",
          account_type: "income",
          report_group: "revenue",
          system_key: "electricity_income",
        },
      },
      {
        id: "manual-expense",
        company_id: COMPANY_ID,
        amount: -30,
        transaction_date: "2026-07-09",
        property_id: PROPERTY.id,
        description: "Direct repair paid",
        reference_number: "DB-30",
        properties: PROPERTY,
        accounting_accounts: {
          id: "repairs-expense",
          code: "6100",
          name: "Repairs & Maintenance",
          account_type: "expense",
          report_group: "operating_expense",
          system_key: "repairs_maintenance",
        },
      },
      {
        id: "manual-income-refund",
        company_id: COMPANY_ID,
        amount: -10,
        transaction_date: "2026-07-10",
        property_id: PROPERTY.id,
        description: "Electricity top-up refunded",
        reference_number: "DB-10",
        properties: PROPERTY,
        accounting_accounts: {
          id: "electricity-income",
          code: "4100",
          name: "Electricity Charges Income",
          account_type: "income",
          report_group: "revenue",
          system_key: "electricity_income",
        },
      },
      {
        id: "manual-expense-recovery",
        company_id: COMPANY_ID,
        amount: 5,
        transaction_date: "2026-07-11",
        property_id: PROPERTY.id,
        description: "Repair supplier refund",
        reference_number: "CR-5",
        properties: PROPERTY,
        accounting_accounts: {
          id: "repairs-expense",
          code: "6100",
          name: "Repairs & Maintenance",
          account_type: "expense",
          report_group: "operating_expense",
          system_key: "repairs_maintenance",
        },
      },
    ],
  });

  const july = await report(supabase, "2026-07-01", "2026-07-31");
  assert.equal(july.totalRevenue, 40);
  assert.equal(july.revenue[0].amount, 40);
  assert.deepEqual(
    { debit: july.revenue[0].details[0].debit, credit: july.revenue[0].details[0].credit },
    { debit: 0, credit: 50 },
  );
  assert.deepEqual(
    { debit: july.revenue[0].details[1].debit, credit: july.revenue[0].details[1].credit },
    { debit: 10, credit: 0 },
  );
  assert.equal(july.totalExpenses, 25);
  assert.equal(july.expenses[0].amount, 25);
  assert.deepEqual(
    { debit: july.expenses[0].details[0].debit, credit: july.expenses[0].details[0].credit },
    { debit: 30, credit: 0 },
  );
  assert.deepEqual(
    { debit: july.expenses[0].details[1].debit, credit: july.expenses[0].details[1].credit },
    { debit: 0, credit: 5 },
  );
  assert.equal(july.netProfit, 15);
});

test("matching a tenant receipt settles assets but does not create COGS", async () => {
  const supabase = fakeSupabase({
    rent_bills: [{
      id: "rent-bill-july",
      tenancy_id: "tenancy-1",
      tenant_id: "tenant-1",
      tenant_record_id: "tenant-record-1",
      property_id: PROPERTY.id,
      room_id: "room-2",
      bill_month: "2026-07-01",
      invoice_date: "2026-06-24",
      invoice_number: "DINV-2026-0701",
      notes: "July monthly rent",
      amount: 500,
      status: "paid",
      removed_at: null,
      properties: PROPERTY,
      rooms: { id: "room-2", name: "Room 2", room_number: "2" },
      tenancies: { id: "tenancy-1", tenants: { id: "tenant-1", full_name: "Test Tenant" } },
    }],
    accounting_journal_entries: [{
      id: "tenant-receipt-entry",
      company_id: COMPANY_ID,
      entry_date: "2026-07-07",
      entry_number: "RCPT-2026-0707",
      source_type: "tenant_payment",
      source_id: "tenancy-1",
      reference_number: "BANK-RECEIPT-500",
      description: "Tenant rental receipt matched",
      status: "posted",
    }],
    accounting_journal_lines: [
      {
        id: "tenant-receipt-bank-line",
        journal_entry_id: "tenant-receipt-entry",
        property_id: PROPERTY.id,
        tenant_id: "tenant-1",
        description: "Bank received",
        debit: 500,
        credit: 0,
        properties: PROPERTY,
        accounting_accounts: {
          id: "bank-account",
          code: "1010",
          name: "Company Bank",
          account_type: "asset",
          report_group: "current_asset",
          system_key: "company_bank",
        },
      },
      {
        id: "tenant-receipt-ar-line",
        journal_entry_id: "tenant-receipt-entry",
        property_id: PROPERTY.id,
        tenant_id: "tenant-1",
        description: "Rental receivable settled",
        debit: 0,
        credit: 500,
        properties: PROPERTY,
        accounting_accounts: {
          id: "rental-receivables",
          code: "1100",
          name: "Rental Receivables",
          account_type: "asset",
          report_group: "current_asset",
          system_key: "rental_receivables",
        },
      },
    ],
    payments: [{
      id: "matched-payment",
      rent_bill_id: "rent-bill-july",
      amount: 500,
      status: "verified",
    }],
  });

  const july = await report(supabase, "2026-07-01", "2026-07-31");
  assert.equal(july.totalRevenue, 500, "rent is recognised once from the rental invoice");
  assert.equal(july.revenue[0].label, "Rental Income");
  assert.equal(july.totalCostOfSales, 0, "bank/receivable settlement is not a direct cost");
  assert.deepEqual(july.costsOfSales, []);
  assert.equal(july.totalExpenses, 0);
  assert.equal(july.netProfit, 500);
});
