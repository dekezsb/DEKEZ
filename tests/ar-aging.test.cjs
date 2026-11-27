const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
Module._load = function (request, ...args) {
  if (request === '@/lib/accounting/report-data') return { allReportRows: async (query) => query };
  return originalLoad.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);

const ar = require('../lib/accounting/ar-aging.ts');
const arData = require('../lib/accounting/ar-aging-data.ts');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const invoice = (over = {}) => ({
  id: 'i1', propertyId: 'p1', propertyName: 'Alpha', tenantKey: 't1', tenantName: 'Ali', roomName: 'R1',
  invoiceNumber: 'DINV-2026-0001', aliasNumber: 'DINV2611-001', invoiceDate: '2026-11-01', dueDate: '2026-11-01', status: 'unpaid',
  invoiceAmount: 400, paidAmount: 0, rentOutstanding: 400, depositOutstanding: 0, ...over,
});

test('bucket edges: not overdue, 1-30, 31-60, 61-90, 90+', () => {
  const days = (due) => ar.daysOverdue(due, '2026-11-27');
  assert.equal(ar.bucketFor(days('2026-11-28')), 'current');
  assert.equal(ar.bucketFor(days('2026-11-27')), 'current');
  assert.equal(ar.bucketFor(days('2026-11-26')), 'd1_30');
  assert.equal(ar.bucketFor(days('2026-10-28')), 'd1_30'); // 30 days
  assert.equal(ar.bucketFor(days('2026-10-27')), 'd31_60'); // 31 days
  assert.equal(ar.bucketFor(days('2026-09-28')), 'd31_60'); // 60 days
  assert.equal(ar.bucketFor(days('2026-09-27')), 'd61_90'); // 61 days
  assert.equal(ar.bucketFor(days('2026-08-29')), 'd61_90'); // 90 days
  assert.equal(ar.bucketFor(days('2026-08-28')), 'd90_plus'); // 91 days
});

test('ages from the due date and falls back to the invoice date when there is no due date', () => {
  assert.equal(ar.ageDateOf({ dueDate: '2026-10-01', invoiceDate: '2026-09-01' }), '2026-10-01');
  assert.equal(ar.ageDateOf({ dueDate: '', invoiceDate: '2026-09-01' }), '2026-09-01');
  const aging = ar.buildArAging([invoice({ dueDate: '', invoiceDate: '2026-09-01' })], '2026-11-27');
  assert.equal(aging.properties[0].tenants[0].invoices[0].bucket, 'd61_90');
  assert.equal(aging.totals.d61_90, 400);
});

test('groups by property then tenant, deposits stay out of the buckets, totals add up', () => {
  const aging = ar.buildArAging([
    invoice({ id: 'a', rentOutstanding: 100.1, dueDate: '2026-11-20' }),
    invoice({ id: 'b', rentOutstanding: 200.2, dueDate: '2026-09-01', invoiceDate: '2026-09-01' }),
    invoice({ id: 'c', tenantKey: 't2', tenantName: 'Bala', depositOutstanding: 150, rentOutstanding: 0, dueDate: '2026-01-05', invoiceDate: '2026-01-05' }),
    invoice({ id: 'd', propertyId: 'p2', propertyName: 'Beta', tenantKey: 't3', tenantName: 'Chan', rentOutstanding: 50, dueDate: '2026-11-27', invoiceDate: '2026-11-20' }),
  ], '2026-11-27');
  assert.deepEqual(aging.properties.map((p) => p.name), ['Alpha', 'Beta']);
  const alpha = aging.properties[0];
  assert.deepEqual(alpha.tenants.map((t) => t.name), ['Ali', 'Bala']);
  assert.equal(alpha.tenants[0].amounts.d1_30, 100.1);
  assert.equal(alpha.tenants[0].amounts.d61_90, 200.2);
  assert.equal(alpha.tenants[0].amounts.total, 300.3);
  assert.equal(alpha.tenants[1].amounts.deposit, 150);
  assert.equal(alpha.tenants[1].amounts.d90_plus, 0);
  assert.equal(alpha.tenants[1].amounts.total, 150);
  assert.equal(aging.totals.current, 50);
  assert.equal(aging.totals.deposit, 150);
  assert.equal(aging.totals.total, 500.3);
  const bucketSum = ar.arBucketKeys.reduce((t, k) => t + aging.totals[k], 0) + aging.totals.deposit;
  assert.equal(Math.round(bucketSum * 100) / 100, aging.totals.total);
});

test('fully paid invoices are left out and invoices dated after the as-at date are not receivables yet', () => {
  const aging = ar.buildArAging([
    invoice({ id: 'paid', rentOutstanding: 0, depositOutstanding: 0 }),
    invoice({ id: 'future', invoiceDate: '2026-12-01', dueDate: '2026-12-01' }),
    invoice({ id: 'open' }),
  ], '2026-11-27');
  assert.equal(aging.invoiceCount, 1);
  assert.equal(aging.properties[0].tenants[0].invoices[0].id, 'open');
});

test('a property filter keeps only that property', () => {
  const aging = ar.buildArAging([invoice({ id: 'a' }), invoice({ id: 'b', propertyId: 'p2', propertyName: 'Beta' })], '2026-11-27', 'p2');
  assert.deepEqual(aging.properties.map((p) => p.name), ['Beta']);
});

test('each invoice links to the invoice list by its number, and both numbers are kept', () => {
  const row = ar.buildArAging([invoice()], '2026-11-27').properties[0].tenants[0].invoices[0];
  assert.equal(row.href, '/rental-invoices?search=DINV-2026-0001');
  assert.equal(row.invoiceNumber, 'DINV-2026-0001');
  assert.equal(row.aliasNumber, 'DINV2611-001');
});

test('as-at defaults to today in Malaysia and bad dates are rejected', () => {
  assert.equal(ar.arToday(new Date('2026-11-26T17:00:00Z')), '2026-11-27'); // 01:00 MYT next day
  assert.equal(ar.arToday(new Date('2026-11-26T15:59:00Z')), '2026-11-26');
  assert.equal(ar.parseArParams({}, '2026-11-27').asAt, '2026-11-27');
  assert.equal(ar.parseArParams({ asAt: '2026-10-31' }, '2026-11-27').asAt, '2026-10-31');
  assert.match(ar.parseArParams({ asAt: '2026-02-30' }, '2026-11-27').error, /not a valid date/);
  assert.match(ar.parseArParams({ asAt: '2019-01-01' }, '2026-11-27').error, /before 2020/);
});

// Production open invoices (amounts and dates only, read-only export, 27 Nov 2026).
const fixture = JSON.parse(read('tests/fixtures/ar-aging-open-invoices.json'));
const prodInvoices = fixture.map((row, index) => invoice({ id: `f${index}`, tenantKey: `t${index}`, tenantName: `T${index}`, invoiceNumber: `N${index}`, aliasNumber: null, invoiceDate: row.i, dueDate: row.d, rentOutstanding: row.r, depositOutstanding: row.dp }));

test('production totals as at 27 Nov 2026 match the independent SQL calculation', () => {
  const aging = ar.buildArAging(prodInvoices, '2026-11-27');
  assert.deepEqual(aging.totals, { current: 1200, d1_30: 4131, d31_60: 650, d61_90: 50, d90_plus: 0, deposit: 1000, total: 7031 });
  assert.equal(aging.invoiceCount, 24);
});

test('reconciliation: aging total less not-yet-due plus manual postings equals the balance sheet receivables', () => {
  const manual = [
    { label: 'Bank vouchers', rental: 2590, deposit: 12000 },
    { label: 'Historical bank credits', rental: -214937.19, deposit: 0 },
  ];
  const recon = ar.reconcileWithBalanceSheet({ invoices: prodInvoices, asAt: '2026-11-27', manual });
  assert.equal(recon.agingTotal, 7031);
  assert.equal(recon.notYetDue, 0);
  assert.equal(recon.invoiceReceivable, 7031);
  assert.equal(recon.invoiceRental, 6031);
  assert.equal(recon.invoiceDeposit, 1000);
  assert.equal(recon.futureDated.count, 42);
  assert.equal(recon.futureDated.amount, 17740);
  assert.equal(recon.manualRental, -212347.19);
  assert.equal(recon.balanceSheetRental, 6031 - 212347.19);
  assert.equal(recon.balanceSheetDeposit, 13000);
  assert.equal(recon.balanceSheetTotal, Math.round((7031 + 2590 + 12000 - 214937.19) * 100) / 100);
  assert.equal(recon.difference, Math.round((recon.agingTotal - recon.balanceSheetTotal) * 100) / 100);
});

test('reconciliation treats an invoice that is issued but not due as the only aging-vs-balance-sheet timing item', () => {
  const invoices = [
    invoice({ id: 'a', dueDate: '2026-11-20', invoiceDate: '2026-11-01', rentOutstanding: 100 }),
    invoice({ id: 'b', dueDate: '2026-12-15', invoiceDate: '2026-11-25', rentOutstanding: 40 }), // issued, not due
    invoice({ id: 'c', dueDate: '2026-11-26', invoiceDate: '2026-12-01', rentOutstanding: 7 }), // due but dated later
    invoice({ id: 'd', dueDate: '2027-01-01', invoiceDate: '2027-01-01', rentOutstanding: 9 }), // generated ahead
  ];
  const recon = ar.reconcileWithBalanceSheet({ invoices, asAt: '2026-11-27', manual: [] });
  assert.equal(recon.agingTotal, 140);
  assert.equal(recon.notYetDue, 40);
  assert.equal(recon.dueButDatedLater, 7);
  assert.equal(recon.invoiceReceivable, 107); // a + c: what the balance sheet counts (due <= as-at)
  assert.equal(recon.balanceSheetTotal, 107);
  assert.equal(recon.agingTotal - recon.notYetDue + recon.dueButDatedLater, recon.balanceSheetTotal);
  assert.deepEqual(recon.futureDated, { count: 1, amount: 9 });
  // And the aging page itself puts the issued-not-due invoice in Current.
  assert.equal(ar.buildArAging(invoices, '2026-11-27').totals.current, 40);
});

test('CSV has a header, one row per invoice, tenant and property totals and a grand total', () => {
  const aging = ar.buildArAging([invoice({ id: 'a', dueDate: '2026-11-20', rentOutstanding: 100 }), invoice({ id: 'b', depositOutstanding: 20, rentOutstanding: 0, dueDate: '2026-11-26' })], '2026-11-27');
  const rows = ar.arCsvRows(aging, 'DEKEZ SDN BHD');
  assert.equal(rows[0][0], 'DEKEZ SDN BHD');
  assert.deepEqual(rows[4].slice(9), ['Current', '1-30 days', '31-60 days', '61-90 days', '90+ days', 'Unpaid deposit', 'Total']);
  assert.equal(rows.filter((row) => row[3] === 'DINV-2026-0001').length, 2);
  const grand = rows[rows.length - 1];
  assert.equal(grand[0], 'GRAND TOTAL');
  assert.equal(grand[grand.length - 1], '120.00');
});

// ----------------------------------------------------------------- loader (fake database, read-only)

function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const builder = {
        select: () => builder,
        eq: () => builder, in: () => builder, is: () => builder, lte: () => builder, order: () => builder,
        then: (resolve, reject) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject),
      };
      for (const name of ['insert', 'update', 'delete', 'upsert', 'rpc']) builder[name] = () => { calls.push(`${table}.${name}`); throw new Error('AR aging must not write'); };
      return builder;
    },
  };
}

test('loader: outstanding = invoice + charges - payments, deposit = deposit due - deposit received, never below zero', async () => {
  const supabase = fakeSupabase({
    rent_bills: [
      { id: 'b1', tenancy_id: 'ty1', tenant_record_id: 'tr1', tenant_id: 'u1', property_id: 'p1', room_id: 'r1', bill_month: '2026-11-01', due_date: '2026-11-10', invoice_date: '2026-11-10', invoice_number: 'DINV-2026-0100', amount: 400, deposit_amount: 200, paid_amount: 100, status: 'partially_paid' },
      { id: 'b2', tenancy_id: 'ty2', tenant_record_id: null, tenant_id: 'u2', property_id: 'p1', room_id: 'r2', bill_month: '2026-10-01', due_date: '2026-10-05', invoice_date: '2026-10-05', invoice_number: 'DINV-2026-0050', amount: 300, deposit_amount: 0, paid_amount: 350, status: 'paid' },
    ],
    rental_invoice_line_items: [{ id: 'l1', rent_bill_id: 'b1', amount: 50 }, { id: 'l2', rent_bill_id: 'b1', amount: -20 }],
    payments: [{ id: 'd1', tenancy_id: 'ty1', amount: 75 }],
    tenant_records: [{ id: 'tr1', full_name: 'Ali Bin Abu' }],
    tenancies: [{ id: 'ty2', tenants: { full_name: 'Legacy Tenant' } }],
    rooms: [{ id: 'r1', name: 'A-01', room_number: '1' }, { id: 'r2', name: null, room_number: '2' }],
    document_number_aliases: [{ id: 'a1', source_id: 'b1', legacy_number: 'DINV-2026-0100', new_number: 'DINV2611-004' }],
    accounting_accounts: [],
  });
  const result = await arData.loadArAging(supabase, 'c1', [{ id: 'p1', name: 'Alpha' }], '2026-11-27');
  const b1 = result.invoices.find((row) => row.id === 'b1');
  assert.equal(b1.invoiceAmount, 430);
  assert.equal(b1.rentOutstanding, 330);
  assert.equal(b1.depositOutstanding, 125);
  assert.equal(b1.tenantName, 'Ali Bin Abu');
  assert.equal(b1.roomName, 'A-01');
  assert.equal(b1.invoiceNumber, 'DINV-2026-0100');
  assert.equal(b1.aliasNumber, 'DINV2611-004');
  const b2 = result.invoices.find((row) => row.id === 'b2');
  assert.equal(b2.rentOutstanding, 0);
  assert.equal(b2.tenantName, 'Legacy Tenant');
  assert.equal(b2.roomName, 'Room 2');
  assert.deepEqual(result.overpaid, { count: 1, amount: 50 });
  assert.deepEqual(supabase.calls, []);
});

test('loader: receivable account postings are separated into journals, bank vouchers and historical bank credits', async () => {
  const supabase = fakeSupabase({
    accounting_accounts: [{ id: 'ar', system_key: 'rental_receivable', normal_balance: 'debit' }, { id: 'dep', system_key: 'deposit_receivable', normal_balance: 'debit' }],
    accounting_journal_entries: [{ id: 'e1', entry_date: '2026-11-01', status: 'posted' }],
    accounting_journal_lines: [
      { id: 'x1', journal_entry_id: 'e1', account_id: 'ar', property_id: null, debit: 500, credit: 120 },
      { id: 'x2', journal_entry_id: 'void-entry', account_id: 'ar', property_id: null, debit: 999, credit: 0 }, // not posted: ignored
    ],
    bank_manual_transactions: [{ id: 'm1', amount: -2590, offset_account_id: 'ar', property_id: null }, { id: 'm2', amount: -12000, offset_account_id: 'dep', property_id: null }],
    historical_bank_credit_classifications: [{ id: 'h1', account_id: 'ar', amount: 214937.19 }],
  });
  const result = await arData.loadArAging(supabase, 'c1', [{ id: 'p1', name: 'Alpha' }], '2026-11-27');
  const by = Object.fromEntries(result.manual.map((row) => [row.label.split(' ')[0], row]));
  assert.equal(by.Manual.rental, 380);
  assert.equal(by.Bank.rental, 2590);
  assert.equal(by.Bank.deposit, 12000);
  assert.equal(by.Historical.rental, -214937.19);
});

test('loader never writes and the page files only read', () => {
  for (const file of ['lib/accounting/ar-aging-data.ts', 'app/reports/ar-aging/page.tsx', 'app/reports/ar-aging/print/page.tsx', 'lib/accounting/ar-aging.ts']) {
    assert.doesNotMatch(read(file), /\.(insert|update|delete|upsert|rpc)\(/, file);
  }
});

test('Reports has an AR Aging tab and both pages carry the Dekez header, print and CSV', () => {
  assert.match(read('app/reports/page.tsx'), /key: "ar-aging", label: "AR Aging"[^}]*href: "\/reports\/ar-aging"/);
  assert.match(read('app/reports/ar-aging/print/page.tsx'), /reportCompany/);
  assert.match(read('app/reports/ar-aging/page.tsx'), /CsvDownloadButton/);
  assert.match(read('app/reports/ar-aging/page.tsx'), /\/reports\/ar-aging\/print/);
});
