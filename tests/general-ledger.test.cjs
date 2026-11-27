const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
let pnlMock = { revenue: [], costsOfSales: [], expenses: [] };
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
Module._load = function (request, ...args) {
  if (request === '@/lib/accounting/report-data') return { allReportRows: async (query) => query, getProfitLossReport: async () => pnlMock };
  return originalLoad.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);

const gl = require('../lib/accounting/general-ledger.ts');
const data = require('../lib/accounting/general-ledger-data.ts');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Production journal lines (amounts only, read-only export, 27 Nov 2026): TB is RM126,497.75 DR = CR.
const fixture = JSON.parse(read('tests/fixtures/gl-journal-lines.json'));
const accounts = Array.from(new Map(fixture.map((row) => [row.c, row])).values()).map((row) => ({ id: row.c, code: row.c, name: row.c, type: row.t, normalBalance: row.nb }));
const lines = fixture.map((row, index) => ({ key: `f${index}`, accountId: row.c, date: row.d, source: 'journal', number: row.n, aliasNumber: null, reference: null, party: '', property: '', description: '', debit: row.dr, credit: row.cr, href: null }));
const expectedNatural = { 1185: 90800, 2200: -7110, 2600: 23278.2, 2610: 4620, 2620: 689.55, 4000: 730, 4050: 90800, 4120: 1900, 4910: 4480, 5300: 25500, 5310: 2490, 5320: 438.45, 5330: 35.4, 5900: 123.9 };

test('ledger lines keep the trial balance at RM126,497.75 debit = credit', () => {
  const totals = gl.ledgerTotals(lines, '2099-12-31');
  assert.equal(totals.debit, 126497.75);
  assert.equal(totals.credit, 126497.75);
});

test('every account closing balance matches the live trial balance by account', () => {
  const ledgers = gl.activeAccounts(accounts, lines, '2000-01-01', '2099-12-31');
  assert.equal(ledgers.length, 14);
  for (const ledger of ledgers) assert.equal(Math.round(ledger.closing * 100) / 100, expectedNatural[ledger.account.code], ledger.account.code);
  // 2200 has a debit balance on a credit-normal account (settlements exceed receipts in the journals): shown negative, never hidden.
  assert.ok(ledgers.find((ledger) => ledger.account.code === '2200').closing < 0);
});

test('opening balance + period movement = closing; running balance follows each line', () => {
  for (const account of accounts) {
    const all = gl.buildAccountLedger(account, lines, '2000-01-01', '2099-12-31');
    const period = gl.buildAccountLedger(account, lines, '2026-10-01', '2026-11-30');
    const movement = period.rows.reduce((sum, row) => sum + gl.naturalMovement(row.debit, row.credit, account.normalBalance), 0);
    assert.equal(Math.round((period.opening + movement) * 100), Math.round(period.closing * 100), account.code);
    assert.equal(period.closing, all.closing, `${account.code} closing equals the full-history closing when the period runs to the end`);
    assert.equal(all.opening, 0);
    let running = period.opening;
    for (const row of period.rows) { running += gl.naturalMovement(row.debit, row.credit, account.normalBalance); assert.equal(Math.round(running * 100), Math.round(row.balance * 100)); }
  }
});

test('money is summed in cents and the date window is inclusive', () => {
  const account = { id: 'a', code: '1', name: 'A', type: 'asset', normalBalance: 'debit' };
  const make = (date, debit, credit, n) => ({ key: n, accountId: 'a', date, source: 'journal', number: n, aliasNumber: null, reference: null, party: '', property: '', description: '', debit, credit, href: null });
  const ledger = gl.buildAccountLedger(account, [make('2026-01-31', 0.1, 0, 'x1'), make('2026-02-01', 0.2, 0, 'x2'), make('2026-02-28', 0, 0.1, 'x3'), make('2026-03-01', 5, 0, 'x4')], '2026-02-01', '2026-02-28');
  assert.equal(ledger.opening, 0.1);
  assert.deepEqual(ledger.rows.map((row) => row.number), ['x2', 'x3']);
  assert.equal(ledger.closing, 0.2);
  assert.equal(ledger.totalDebit, 0.2);
  assert.equal(ledger.totalCredit, 0.1);
});

test('P&L row keys resolve to chart accounts, unmapped categories stay visible', () => {
  const chart = [{ id: 'u1', code: '5300', name: 'Salary', type: 'expense', normalBalance: 'debit', systemKey: 'staff_costs' }, { id: 'u2', code: '5800', name: 'Motor', type: 'expense', normalBalance: 'debit', systemKey: null }];
  assert.equal(gl.accountIdForPnlKey('staff_costs', chart), 'u1');
  assert.equal(gl.accountIdForPnlKey('account_u2', chart), 'u2');
  assert.equal(gl.accountIdForPnlKey('utility_electric', chart), null);
});

test('filters default to this year to today (Malaysia time) and reject reversed dates', () => {
  assert.deepEqual(gl.parseGlParams({}, new Date('2026-11-27T10:00:00Z')), { account: '', from: '2026-01-01', to: '2026-11-27', error: '' });
  assert.equal(gl.parseGlParams({ from: '2026-12-01', to: '2026-11-01' }).error, 'The start date is after the end date.');
  assert.equal(gl.parseGlParams({ from: 'nope', to: '2026-03-01' }).from.slice(5), '01-01');
});

test('CSV export has opening, lines and closing per account with both numbers', () => {
  const account = { id: 'a', code: '4000', name: 'Rental Income', type: 'income', normalBalance: 'credit' };
  const ledger = gl.buildAccountLedger(account, [{ key: 'k', accountId: 'a', date: '2026-11-01', source: 'invoice', number: 'DINV-2026-1288', aliasNumber: 'DINV2611-001', reference: 'R1', party: 'Tenant, "A"', property: 'HLT', description: 'Rent', debit: 0, credit: 380, href: null }], '2026-11-01', '2026-11-30');
  const rows = gl.glCsvRows([ledger]);
  assert.equal(rows[0][3], 'Legacy / stored no.'); assert.equal(rows[0][4], 'New-style no.');
  assert.deepEqual(rows[2].slice(3, 5), ['DINV-2026-1288', 'DINV2611-001']);
  assert.equal(rows[1][2], 'Opening balance'); assert.equal(rows[3][2], 'Closing balance'); assert.equal(rows[3][11], '380.00');
});

function fakeSupabase(tables) {
  return { from(table) {
    const chain = { select: () => chain, eq: () => chain, is: () => chain, lte: () => chain, in: () => chain, order: () => chain, then: (resolve) => resolve({ data: tables[table] ?? [], error: null }) };
    return chain;
  } };
}

test('loader drills every line to its source with legacy and new-style numbers', async () => {
  const chart = [
    { id: 'A-BANKOFF', code: '2200', name: 'Tenant Deposits', account_type: 'liability', normal_balance: 'credit', system_key: 'tenant_security_deposits' },
    { id: 'A-AR', code: '1185', name: 'Renovation AR', account_type: 'asset', normal_balance: 'debit', system_key: null },
    { id: 'A-REN', code: '4050', name: 'Renovation Income', account_type: 'income', normal_balance: 'credit', system_key: null },
    { id: 'A-RENT', code: '4000', name: 'Rental Income', account_type: 'income', normal_balance: 'credit', system_key: 'rental_income' },
    { id: 'A-OFFICE', code: '5600', name: 'Office', account_type: 'expense', normal_balance: 'debit', system_key: 'office_admin' },
  ];
  const tables = {
    accounting_accounts: chart,
    properties: [{ id: 'P1', name: 'Hilltop' }],
    accounting_journal_entries: [
      { id: 'E-LEGACY', entry_date: '2026-10-19', entry_number: 'JE-20261019-B76EB5AC', source_type: 'manual_journal', source_id: null, reference_number: null, description: 'Legacy manual', reversed_entry_id: null },
      { id: 'E-V', entry_date: '2026-11-27', entry_number: 'PV2611-001', source_type: 'payment_voucher', source_id: null, reference_number: 'CHQ1', description: 'Paint', reversed_entry_id: null },
      { id: 'E-VREV', entry_date: '2026-11-27', entry_number: 'PV2611-001-REV1', source_type: 'journal_reversal', source_id: null, reference_number: null, description: 'Reversal', reversed_entry_id: 'E-V' },
      { id: 'E-REN', entry_date: '2026-07-14', entry_number: 'JE-20260714-7FCA6B43', source_type: 'renovation_invoice', source_id: 'DOC1', reference_number: null, description: 'Reno', reversed_entry_id: null },
    ],
    accounting_vouchers: [{ id: 'V1', voucher_number: 'PV2611-001', voucher_type: 'PV', journal_entry_id: 'E-V', reversal_journal_entry_id: 'E-VREV', party_name: 'Ah Seng' }],
    document_number_aliases: [
      { source_table: 'accounting_journal_entries', source_id: 'E-LEGACY', legacy_number: 'JE-20261019-B76EB5AC', new_number: 'JE2610-001' },
      { source_table: 'renovation_documents', source_id: 'DOC1', legacy_number: 'DRI-2026-000004', new_number: 'DRI2607-001' },
      { source_table: 'rent_bills', source_id: 'B1', legacy_number: 'DINV-2026-1288', new_number: 'DINV2611-001' },
      { source_table: 'bank_payment_voucher', source_id: 'T1', legacy_number: 'PV-20261030-ABC', new_number: 'PV2610-001' },
    ],
    accounting_journal_lines: [
      { id: 'L1', journal_entry_id: 'E-LEGACY', account_id: 'A-OFFICE', property_id: 'P1', description: 'Office item', debit: 100, credit: 0 },
      { id: 'L2', journal_entry_id: 'E-LEGACY', account_id: 'A-BANKOFF', property_id: null, description: 'Deposit settle', debit: 100, credit: 0 },
      { id: 'L3', journal_entry_id: 'E-V', account_id: 'A-AR', property_id: null, description: 'Paint', debit: 50, credit: 0 },
      { id: 'L4', journal_entry_id: 'E-VREV', account_id: 'A-AR', property_id: null, description: 'Reversal', debit: 0, credit: 50 },
      { id: 'L5', journal_entry_id: 'E-REN', account_id: 'A-AR', property_id: null, description: 'Reno', debit: 500, credit: 0 },
    ],
    bank_manual_transactions: [{ id: 'T1', amount: -75, offset_account_id: 'A-AR', property_id: 'P1', transaction_date: '2026-10-30', reference_number: 'PV-20261030-ABC', description: 'Bank PV' }],
    payments: [{ id: 'PAY1', amount: 600, payment_date: '2026-10-05', property_id: 'P1', reference_number: 'DEP-1', notes: null }],
  };
  pnlMock = {
    revenue: [
      { key: 'rental_income', label: 'Rental Income', amount: 380, details: [{ id: 'rent:B1', sourceType: 'rental_invoice', date: '2026-11-01', documentNumber: 'DINV-2026-1288', referenceNumber: null, propertyName: 'Hilltop', partyName: 'Tenant', description: 'Monthly rent', debit: 0, credit: 380 }] },
      { key: 'account_A-REN', label: 'Renovation Income', amount: 500, details: [{ id: 'journal:L-X', sourceType: 'journal_entry', date: '2026-07-14', documentNumber: 'x', referenceNumber: null, propertyName: 'General company', partyName: null, description: 'unknown line is ignored', debit: 0, credit: 500 }] },
    ],
    costsOfSales: [],
    expenses: [
      { key: 'office_admin', label: 'Office', amount: 100, details: [{ id: 'journal:L1', sourceType: 'journal_entry', date: '2026-10-19', documentNumber: 'JE', referenceNumber: null, propertyName: 'Hilltop', partyName: null, description: 'Office item', debit: 100, credit: 0 }] },
      { key: 'utility_electric', label: 'Electric Utilities', amount: 40, details: [{ id: 'utility:U1', sourceType: 'utility_bill', date: '2026-11-01', documentNumber: 'UB-1', referenceNumber: null, propertyName: 'Hilltop', partyName: null, description: 'Bill', debit: 40, credit: 0 }] },
      { key: 'account_missing', label: 'Bank PV expense', amount: 75, details: [{ id: 'manual:T1', sourceType: 'bank_adjustment', date: '2026-10-30', documentNumber: 'Bank adjustment T1', referenceNumber: 'PV-20261030-ABC', propertyName: 'Hilltop', partyName: null, description: 'Bank PV', debit: 75, credit: 0 }] },
    ],
  };
  const result = await data.loadGeneralLedger(fakeSupabase(tables), 'C1', '2026-11-30');
  const byKey = new Map(result.lines.map((line) => [line.key, line]));

  const legacy = byKey.get('journal:L2');
  assert.deepEqual([legacy.source, legacy.number, legacy.aliasNumber, legacy.accountId], ['journal', 'JE-20261019-B76EB5AC', 'JE2610-001', 'A-BANKOFF']);
  assert.equal(legacy.href, '/reports/vouchers/edit?kind=journal&id=E-LEGACY');

  const voucher = byKey.get('journal:L3');
  assert.deepEqual([voucher.source, voucher.number, voucher.party], ['voucher', 'PV2611-001', 'Ah Seng']);
  assert.equal(voucher.href, '/reports/vouchers/edit?kind=voucher&id=V1');
  const reversal = byKey.get('journal:L4');
  assert.deepEqual([reversal.source, reversal.number, reversal.aliasNumber], ['reversal', 'PV2611-001-REV1', 'PV2611-001']);

  const reno = byKey.get('journal:L5');
  assert.deepEqual([reno.source, reno.aliasNumber, reno.href], ['renovation', 'DRI2607-001', '/renovation/DOC1']);

  const invoice = byKey.get('rent:B1');
  assert.deepEqual([invoice.source, invoice.number, invoice.aliasNumber, invoice.accountId, invoice.credit], ['invoice', 'DINV-2026-1288', 'DINV2611-001', 'A-RENT', 380]);
  assert.match(invoice.href, /^\/rental-invoices\?search=DINV-2026-1288/);

  const bankBalanceSheet = byKey.get('bank:T1');
  assert.deepEqual([bankBalanceSheet.source, bankBalanceSheet.accountId, bankBalanceSheet.debit, bankBalanceSheet.aliasNumber], ['bank_pv', 'A-AR', 75, 'PV2610-001']);
  assert.equal(bankBalanceSheet.href, '/reports/vouchers/edit?kind=bank&id=PV-20261030-ABC');

  const deposit = byKey.get('payment:PAY1');
  assert.deepEqual([deposit.accountId, deposit.credit, deposit.source], ['A-BANKOFF', 600, 'payment']);

  // P&L-side journal line comes once, from the P&L ledger, with the document links of the journal.
  assert.equal(result.lines.filter((line) => line.key === 'journal:L1').length, 1);
  assert.equal(byKey.get('journal:L1').accountId, 'A-OFFICE');
  // Unmapped categories are kept in the ledger under a visible placeholder account, not dropped.
  const electric = byKey.get('utility:U1');
  assert.match(electric.accountId, /^pseudo:Electric Utilities/);
  assert.ok(result.accounts.find((account) => account.id === electric.accountId && account.code === 'UNMAPPED'));
  const pvExpense = byKey.get('manual:T1');
  assert.equal(pvExpense.aliasNumber, 'PV2610-001');
  assert.equal(pvExpense.number, 'PV-20261030-ABC');
  // Unknown journal line ids from the P&L are ignored instead of crashing.
  assert.equal(byKey.has('journal:L-X'), false);
});

test('general ledger pages are read-only, role-gated and linked from Reports', () => {
  const page = read('app/reports/general-ledger/page.tsx');
  const print = read('app/reports/general-ledger/print/page.tsx');
  assert.match(page, /voucherPageContext\(\)/);
  assert.match(print, /voucherPageContext\(\)/);
  assert.match(print, /reportCompany\(company\)/, 'company header, same as the voucher register print');
  assert.match(page, /CsvDownloadButton/);
  assert.match(page, /Print \/ PDF/);
  assert.doesNotMatch(read('lib/accounting/general-ledger-data.ts'), /\.(insert|update|delete|upsert|rpc)\(/, 'the ledger only reads');
  assert.match(read('app/reports/page.tsx'), /href: "\/reports\/general-ledger"/);
});

test('deposit received edit needs a bank-in date and reason, and posts on that date', () => {
  const actions = read('app/properties/[id]/actions.ts');
  const branch = actions.slice(actions.indexOf('if (field === "depositReceived")'), actions.indexOf('if ((field === "contractEnd"'));
  assert.match(branch, /checkPaymentDate\(textValue\(formData, "effectiveDate"\)\)/);
  assert.ok(branch.indexOf('checkPaymentDate(') < branch.indexOf('ensureCanonicalTenancy'), 'validated before anything is written');
  assert.ok(branch.indexOf('checkPaymentDate(') < branch.indexOf('.update({'), 'validated before the old deposit is reversed');
  assert.match(branch, /payment_date: effectiveDate\.date/);
  assert.doesNotMatch(branch, /payment_date: today\(\)/);
  assert.match(branch, /correctionReason\.length < 3/);
  assert.match(branch, /reason: correctionReason/);
  assert.match(branch, /effective_date: effectiveDate\.date/);
  assert.match(branch, /reversed_payment_ids: manualDepositIds/);
  const controls = read('app/properties/[id]/property-controls.tsx');
  assert.match(controls, /name="effectiveDate"[^>]*required type="date"/);
  assert.match(controls, /max=\{malaysiaToday\(\)\}/);
  assert.match(controls, /name="reason"/);
  assert.match(controls, /setConfirming\(true\)/, 'blur no longer saves a deposit change by itself');
});

test('deposit date rules are the same as the bank-in fix', () => {
  const dates = require('../lib/payments/payment-date.ts');
  const now = new Date('2026-11-27T10:00:00Z');
  assert.equal(dates.checkPaymentDate('', now).error, 'payment_date_required');
  assert.equal(dates.checkPaymentDate('2026-11-28', now).error, 'payment_date_future');
  assert.equal(dates.checkPaymentDate('2019-12-31', now).error, 'payment_date_too_old');
  assert.equal(dates.checkPaymentDate('2026-11-03', now).ok, true);
});
