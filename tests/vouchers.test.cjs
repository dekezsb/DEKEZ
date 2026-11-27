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
  if (request === '@/app/reports/voucher-actions') return { postVoucher: async () => {}, amendVoucher: async () => {}, voidVoucher: async () => {} };
  if (request === '@/lib/accounting/report-data') return { allReportRows: async () => ({ data: [], error: null }) };
  return originalLoad.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const v = require('../lib/accounting/vouchers.ts');
const data = require('../lib/accounting/voucher-data.ts');
const { VoucherForm } = require('../components/accounting/voucher-form.tsx');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('PV/RV lines need an account and a positive 2-decimal amount', () => {
  assert.deepEqual(v.voucherLinesPayload('PV', []), { error: 'voucher_line_count' });
  assert.deepEqual(v.voucherLinesPayload('PV', [{ accountId: '', propertyId: '', description: '', amount: '10' }]), { error: 'voucher_invalid_line' });
  const ok = v.voucherLinesPayload('PV', [
    { accountId: 'a', propertyId: 'p', description: ' Paint ', amount: '0.1' },
    { accountId: 'b', propertyId: '', description: '', amount: '0.2' },
    { accountId: '', propertyId: '', description: '', amount: '' },
  ]);
  assert.equal(ok.total, 0.3, 'cents arithmetic, no float drift');
  assert.deepEqual(ok.lines[0], { account_id: 'a', property_id: 'p', description: 'Paint', amount: '0.10' });
  assert.equal(ok.lines.length, 2, 'blank rows are ignored');
  assert.equal(v.cleanAmount('1,250.555'), '1250.56');
});

test('JV lines must balance and use one side per line', () => {
  assert.deepEqual(v.voucherLinesPayload('JV', [{ accountId: 'a', propertyId: '', description: '', debit: '10', credit: '' }]), { error: 'voucher_line_count' });
  assert.deepEqual(v.voucherLinesPayload('JV', [{ accountId: 'a', propertyId: '', description: '', debit: '10', credit: '10' }, { accountId: 'b', propertyId: '', description: '', debit: '', credit: '10' }]), { error: 'voucher_invalid_line' });
  assert.deepEqual(v.voucherLinesPayload('JV', [{ accountId: 'a', propertyId: '', description: '', debit: '10', credit: '' }, { accountId: 'b', propertyId: '', description: '', debit: '', credit: '9.99' }]), { error: 'voucher_not_balanced' });
  assert.equal(v.voucherLinesPayload('JV', [{ accountId: 'a', propertyId: '', description: '', debit: '10', credit: '' }, { accountId: 'b', propertyId: '', description: '', debit: '', credit: '10' }]).total, 10);
});

test('PV journal preview balances detail lines against the cash/bank account', () => {
  const preview = v.voucherJournalPreview('PV', [{ accountId: 'exp', propertyId: '', description: '', amount: '120' }], 'bank');
  assert.deepEqual(preview, [{ accountId: 'exp', debit: 120, credit: 0 }, { accountId: 'bank', debit: 0, credit: 120 }]);
  const rv = v.voucherJournalPreview('RV', [{ accountId: 'inc', propertyId: '', description: '', amount: '50' }], 'cash');
  assert.deepEqual(rv[1], { accountId: 'cash', debit: 50, credit: 0 });
});

test('error codes from the database map to plain messages', () => {
  assert.equal(v.voucherErrorCode('ERROR: voucher_period_locked'), 'voucher_period_locked');
  assert.equal(v.voucherErrorCode('something else'), 'voucher_failed');
  assert.match(v.voucherErrorMessages.voucher_bank_matched, /unlink it in Bank Reconciliation/);
});

test('only journals that are safe to correct are editable here', () => {
  for (const source of ['manual_journal', 'tenant_deposit_settlement', 'payment_voucher', 'receipt_voucher']) assert.equal(v.journalEditability(source).editable, true);
  assert.match(v.journalEditability('renovation_invoice').reason, /renovation invoice/i);
  assert.equal(v.journalEditability('journal_reversal').editable, false);
  assert.equal(v.journalEditability('historical_rental_credit').editable, false);
});

test('new-style numbers are PREFIX + YYMM + 3 digits', () => {
  assert.equal(v.isNewStyleNumber('PV2611-001'), true);
  assert.equal(v.isNewStyleNumber('dinv2611-120'), true);
  assert.equal(v.isNewStyleNumber('PV-20261030-ABC'), false);
  assert.equal(v.isNewStyleNumber('DINV-2026-1161'), false);
});

const voucher = (over) => ({ id: 'v1', root_voucher_id: 'v1', revision: 1, voucher_type: 'PV', voucher_number: 'PV2611-001', voucher_date: '2026-11-05', party_name: 'Ah Seng', property_id: null, payment_account_id: 'bank', reference_number: 'CHQ1', description: 'Paint', total_amount: '200', status: 'posted', origin: 'voucher', journal_entry_id: 'j1', change_reason: null, void_reason: null, voided_at: null, created_at: '2026-11-05T01:00:00Z', ...over });

test('register shows one row per voucher with amendment history and status', () => {
  const rows = data.voucherRegisterRows([
    voucher({ status: 'amended' }),
    voucher({ id: 'v2', revision: 2, total_amount: '180', change_reason: 'Discount', journal_entry_id: 'j2', created_at: '2026-11-06T01:00:00Z' }),
    voucher({ id: 'v3', root_voucher_id: 'v3', voucher_number: 'PV2611-002', status: 'voided', void_reason: 'Duplicate', voided_at: '2026-11-07T00:00:00Z', journal_entry_id: 'j3' }),
  ], [{ id: 'l1', voucher_id: 'v2', line_no: 1, account_id: 'a', property_id: 'p1', description: null, debit: '180', credit: '0' }], new Map());
  const amended = rows.find((row) => row.number === 'PV2611-001');
  assert.equal(amended.revision, 2);
  assert.equal(amended.amount, 180);
  assert.equal(amended.editable, true);
  assert.equal(v.statusLabel(amended), 'Amended (rev 2)');
  assert.deepEqual(amended.propertyIds, ['p1']);
  assert.equal(amended.history[1].reason, 'Discount');
  const voided = rows.find((row) => row.number === 'PV2611-002');
  assert.equal(voided.status, 'voided');
  assert.equal(voided.editable, false);
  assert.equal(voided.history.at(-1).reason, 'Duplicate');
  assert.equal(v.filterRegister(rows, { status: 'amended' }).length, 1);
  assert.equal(v.filterRegister(rows, { status: 'voided' }).length, 1);
  assert.equal(v.filterRegister(rows, { q: 'pv2611-002' }).length, 1);
  assert.equal(v.filterRegister(rows, { from: '2026-12-01' }).length, 0);
  assert.equal(v.filterRegister(rows, { property: 'p1' }).length, 1);
});

test('bank reconciliation vouchers are grouped by number and track edits and voids', () => {
  const base = { bank_account_id: 'bank', offset_account_id: 'exp', property_id: null, transaction_date: '2026-11-12', reference_number: 'PV2611-003', voucher_revision: 1, reversal_of_id: null, superseded_at: null, superseded_reason: null, created_at: '2026-11-12T01:00:00Z' };
  const rows = data.bankVoucherRegisterRows([
    { ...base, id: 'r1', amount: '-90', description: 'TNB · Bill', superseded_at: '2026-11-13T00:00:00Z', superseded_reason: 'edited - Split bill' },
    { ...base, id: 'r1x', amount: '90', description: 'Auto reversal', reversal_of_id: 'r1', superseded_at: '2026-11-13T00:00:00Z' },
    { ...base, id: 'r2', amount: '-60', description: 'TNB · Bill', voucher_revision: 2, property_id: 'p1' },
    { ...base, id: 'r3', amount: '-30', description: 'TNB · Refund', voucher_revision: 2 },
    { ...base, id: 'o1', amount: '-20', description: 'Old · x', reference_number: 'PV-20261030-AAAA', superseded_at: '2026-11-14T00:00:00Z', superseded_reason: 'voided - Wrong line' },
    { ...base, id: 'o1x', amount: '20', description: 'Auto reversal', reference_number: 'PV-20261030-AAAA', reversal_of_id: 'o1', superseded_at: '2026-11-14T00:00:00Z' },
  ], new Map([['PV-20261030-AAAA', 'PV2610-001']]));
  const edited = rows.find((row) => row.number === 'PV2611-003');
  assert.equal(edited.amount, 90);
  assert.equal(edited.revision, 2);
  assert.equal(edited.party, 'TNB');
  assert.equal(edited.history[1].reason, 'Split bill');
  assert.equal(edited.status, 'posted');
  const voided = rows.find((row) => row.number === 'PV-20261030-AAAA');
  assert.equal(voided.status, 'voided');
  assert.equal(voided.aliasNumber, 'PV2610-001');
  assert.equal(voided.history.at(-1).reason, 'Wrong line');
  assert.deepEqual(data.splitBankDescription('Ah Seng · Paint · wall'), { party: 'Ah Seng', detail: 'Paint · wall' });
});

test('CSV export lists number, alias, status and source', () => {
  const rows = data.voucherRegisterRows([voucher({})], [], new Map());
  const csv = v.registerCsvRows(rows, new Map());
  assert.deepEqual(csv[0].slice(0, 3), ['Voucher No', 'New-style No', 'Type']);
  assert.equal(csv[1][0], 'PV2611-001');
  assert.equal(csv[1][9], '200.00');
  assert.equal(csv[1][10], 'Posted');
});

test('amount in words for printed vouchers', () => {
  assert.equal(v.amountInWords(1250.5), 'Ringgit Malaysia One Thousand Two Hundred Fifty and Sen Fifty Only');
  assert.equal(v.amountInWords(0.05), 'Ringgit Malaysia Zero and Sen Five Only');
});

test('edit form opens prefilled with a reason box; bank edits lock the total', () => {
  const accounts = [{ id: 'exp', code: '5200', name: 'Repairs', accountType: 'expense' }];
  const html = renderToStaticMarkup(React.createElement(VoucherForm, {
    mode: 'edit', kind: 'voucher', id: 'v1', type: 'PV', accounts, paymentAccounts: [{ id: 'bank', code: '1011', name: 'Dekez Bank', accountType: 'asset' }], properties: [],
    initial: { date: '2026-11-05', party: 'Ah Seng', propertyId: '', paymentAccountId: 'bank', reference: 'CHQ1', description: 'Paint', lines: [{ accountId: 'exp', propertyId: '', description: 'Wall', amount: '200' }] },
  }));
  assert.match(html, /value="Ah Seng"/);
  assert.match(html, /value="200"/);
  assert.match(html, /Reason for this change/);
  assert.match(html, /Save changes/);
  assert.match(html, /same voucher number/);
  const bank = renderToStaticMarkup(React.createElement(VoucherForm, {
    mode: 'edit', kind: 'bank', id: 'PV2611-003', type: 'PV', accounts, paymentAccounts: [], properties: [], lockedTotal: 90, bankAccountName: 'Dekez Sdn Bhd',
    initial: { date: '2026-11-12', party: 'TNB', propertyId: '', paymentAccountId: '', reference: '', description: '', lines: [{ accountId: 'exp', propertyId: 'office', description: 'Bill', amount: '90' }] },
  }));
  assert.match(bank, /Bank amount/);
  assert.match(bank, /Dekez Sdn Bhd/);
  assert.doesNotMatch(bank, /name="paymentAccountId"/);
  const journal = renderToStaticMarkup(React.createElement(VoucherForm, {
    mode: 'new', type: 'JV', accounts, paymentAccounts: [], properties: [],
    initial: { date: '2026-11-05', party: '', propertyId: '', paymentAccountId: '', reference: '', description: '', lines: [] },
  }));
  assert.match(journal, /Total debit/);
  assert.doesNotMatch(journal, /Reason for this change/);
});

test('reports page links the voucher register and lets journals be edited', () => {
  const page = read('app/reports/page.tsx');
  assert.match(page, /href: "\/reports\/vouchers"/);
  assert.match(page, /\/reports\/vouchers\/edit\?kind=journal&id=\$\{entry\.id\}/);
  assert.doesNotMatch(page, /Corrections should be made with a separate reversing journal/);
  const candidates = read('lib/accounting/bank-candidates.ts');
  assert.match(candidates, /\.is\("superseded_at", null\)/);
  assert.match(candidates, /sourceType: "accounting_voucher"/);
});
