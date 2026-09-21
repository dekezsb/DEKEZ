const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), resolve = Module._resolveFilename, load = Module._load;
let current, writes, role = 'super_admin';
const stop = new Error('Stopped at mocked write — no real payment is submitted');
const db = {
  from(table) {
    const data = table === 'payment_submissions' ? current : table === 'rent_bills' ? { amount: 380, deposit_amount: 100, paid_amount: 0 }
      : table === 'tenancies' ? { deposit: 100 } : [];
    const query = { select() { return this; }, eq() { return this; }, single() { return Promise.resolve({ data }); }, maybeSingle() { return this.single(); },
      then(ok, fail) { return Promise.resolve({ data }).then(ok, fail); },
      update(value) { writes.push({ table, value }); throw stop; } };
    return query;
  },
  rpc(name, value) { writes.push({ rpc: name, value }); throw stop; },
};
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args); };
Module._load = function(request, ...args) {
  if (request === 'next/navigation') return { redirect(url) { throw new Error(url); } };
  if (request === 'next/cache') return { revalidatePath() {} };
  if (request === '@/lib/auth/session') return { requireRole: async () => role };
  if (request === '@/lib/data/organization') return { getCurrentUser: async () => ({ id: 'actor' }) };
  if (request === '@/lib/supabase/admin') return { createAdminClient: () => db };
  if (request === '@/lib/supabase/server') return { createClient: async () => db };
  if (request === '@/lib/invoices/deposit-payments') return { getVerifiedDepositPaymentMaps: async () => ({}), verifiedDepositPaid: () => 0 };
  if (['@/lib/tenancy/agreement', '@/lib/tenancy/convert-application', '@/lib/ttlock/fingerprint'].includes(request)) return {};
  return load.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: f,
}).outputText, f);
const { verificationBankReference } = require('../lib/payments/bank-reference.ts');
const { reviewPaymentSubmission } = require('../app/payment-verification/actions.ts');
const { bankReferenceMatches, rankExistingPayments, directReconciliationPayment } = require('../lib/accounting/tenant-reconciliation.ts');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { PaymentRecordActions } = require('../app/payment-verification/payment-record-actions.tsx');
const form = values => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
const setup = purpose => {
  writes = []; role = 'super_admin';
  current = { id: 'submission', verification_status: 'pending_verification', payment_type: purpose,
    tenancy_id: 'tenancy', rent_bill_id: 'bill', payment_date: '2026-09-01', bill_month: '2026-09-01', amount: 100, reference_number: 'OLD-001' };
};
test('references retain zeroes; blank, omitted and rejection forms cannot erase them', () => {
  assert.equal(verificationBankReference(form({ bankReference: ' 001234 ' }), 'verified', null), '001234');
  for (const f of [form({}), form({ bankReference: ' ' })]) assert.equal(verificationBankReference(f, 'verified', '001234'), '001234');
  assert.equal(verificationBankReference(form({ bankReference: 'NEW-999' }), 'rejected', '001234'), '001234');
  for (const value of ['a'.repeat(121), '12\n34', '12\x0034', '12\x7f34']) assert.throws(() => verificationBankReference(form({ bankReference: value }), 'verified', null), /bank_reference/);
});
test('every confirmation shows an editable reference, including Admin and Rent + Deposit / booking fees', () => {
  for (const purpose of ['monthly_rent', 'rent_deposit', 'deposit', 'booking_fee']) for (const canCorrectPurpose of [false, true]) {
    const original = React.useState; let index = 0;
    React.useState = initial => original(index++ === 0 ? true : initial);
    let html;
    try { html = renderToStaticMarkup(React.createElement(PaymentRecordActions, { submissionId: 's', status: 'pending_verification', tenantName: 'Fixture tenant', propertyName: 'KLB', roomName: '17', billMonth: '2026-09-01', paymentDate: '2026-09-01', amountSubmitted: 'RM 100', amountSubmittedValue: 100, paymentPurpose: purpose, invoiceOutstanding: 480, rentOutstanding: 380, depositOutstanding: 100, referenceNumber: '001234', receiptIsImage: false, canCorrectPurpose })); }
    finally { React.useState = original; }
    assert.match(html, /Bank transaction reference \/ code/);
    const input = html.match(/<input[^>]*name="bankReference"[^>]*>/)?.[0];
    assert.ok(input); assert.match(input, /type="text"/); assert.match(input, /value="001234"/); assert.doesNotMatch(input, /disabled|readonly|required/);
    assert.ok(html.indexOf('name="bankReference"') < html.indexOf('Confirm &amp; Verify'));
  }
});
test('normal verification persists the reference on the existing submission for all allocations', async () => {
  for (const purpose of ['monthly_rent', 'rent_deposit', 'deposit']) {
    setup(purpose); role = 'admin';
    await assert.rejects(reviewPaymentSubmission(form({ submissionId: current.id, decision: 'verified', bankReference: '001234' })), error => error === stop);
    assert.equal(writes.length, 1); assert.equal(writes[0].table, 'payment_submissions');
    assert.equal(writes[0].value.reference_number, '001234');
    assert.equal(writes[0].value.payment_type, purpose);
  }
});
test('booking verification passes reference into the atomic allocator without a separate update', async () => {
  setup('booking_fee');
  await assert.rejects(reviewPaymentSubmission(form({ submissionId: current.id, decision: 'verified', bankReference: '001234', paymentPurposeOverride: 'monthly_rent' })), error => error === stop);
  assert.deepEqual(writes, [{ rpc: 'verify_booking_fee_allocation_with_reference', value: { p_submission: 'submission', p_actor: 'actor', p_allocation: 'monthly_rent', p_amount: 100, p_payment_date: '2026-09-01', p_bank_reference: '001234' } }]);
});
test('bad references and already verified submissions stop before writes; rejection preserves reference', async () => {
  setup('monthly_rent');
  await assert.rejects(reviewPaymentSubmission(form({ submissionId: current.id, decision: 'verified', bankReference: 'bad\ncode' })), /error=bank_reference/); assert.equal(writes.length, 0);
  current.verification_status = 'verified';
  await assert.rejects(reviewPaymentSubmission(form({ submissionId: current.id, decision: 'verified', bankReference: 'NEW-999' })), /already_verified/); assert.equal(writes.length, 0);
  setup('monthly_rent');
  await assert.rejects(reviewPaymentSubmission(form({ submissionId: current.id, decision: 'rejected', notes: 'Fixture reject', bankReference: 'NEW-999' })), error => error === stop);
  assert.equal(writes[0].value.reference_number, 'OLD-001');
});
const bank = extra => ({ id: 'b', amount: 100, date: '2026-09-20', reference: '001234', description: 'Transfer', used: false, ...extra });
const payment = extra => ({ id: 'p', amount: 100, date: '2026-09-01', reference: '001234', tenant: 'Fixture tenant', property: 'KLB', propertyCode: 'KLB', room: '17', invoice: 'INV-1', invoiceId: 'bill', invoiceMonth: '2026-09-01', receipt: 'REC-1', slipUrl: null, arReference: '', eligible: true, bankId: null, legacyMatched: false, ...extra });
test('exact bank reference suggests a ready match without tenant name, but never matches substrings', () => {
  assert.equal(bankReferenceMatches(bank({ reference: 'QR-76449023' }), 'QR76449023'), true);
  for (const code of ['1234', '0001234', '0012345', 'Paid', '123']) assert.equal(bankReferenceMatches(bank(), code), false);
  const ranked = rankExistingPayments(bank(), [payment({ id: 'other', date: '2026-09-20', reference: '' }), payment()]);
  assert.equal(ranked[0].payment.id, 'p'); assert.equal(ranked[0].confidence, 'Exact Match');
  assert.equal(directReconciliationPayment(bank(), ranked).id, 'p'); assert.equal(ranked[1].status, 'MANUAL_REVIEW');
});
test('bank codes never bypass room/month, amount, duplicate or already reconciled protections', () => {
  for (const extra of [{ description: 'DGG 17' }, { date: '2026-08-20' }]) assert.equal(rankExistingPayments(bank(extra), [payment()]).length, 0);
  for (const extra of [{ amount: 101 }, { duplicate: true }, { used: true }]) assert.equal(directReconciliationPayment(bank(extra), rankExistingPayments(bank(extra), [payment()])), null);
  for (const extra of [{ duplicate: true }, { bankId: 'used' }, { legacyMatched: true }]) assert.equal(directReconciliationPayment(bank(), rankExistingPayments(bank(), [payment(extra)])), null);
  const duplicate = rankExistingPayments(bank(), [payment(), payment({ id: 'p2' })]);
  assert.ok(duplicate.every(x => x.status === 'MANUAL_REVIEW'));
});
test('payment propagation and protected booking transaction remain wired into release', () => {
  const action = fs.readFileSync(path.join(root, 'app/payment-verification/actions.ts'), 'utf8');
  assert.match(action, /reference_number: submission\.reference_number/);
  assert.match(action, /Bank reference: \$\{currentSubmission\.reference_number/);
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260921060215_booking_verification_bank_reference.sql'), 'utf8');
  assert.match(sql, /security invoker/); assert.match(sql, /for update/);
  assert.match(sql, /s\.verification_status <> 'verified'/);
  assert.match(sql, /result := public\.verify_booking_fee_allocation/);
  assert.doesNotMatch(sql, /exception when|insert into public\.payments/i);
  assert.match(sql, /from public, anon, authenticated/); assert.match(sql, /to service_role/);
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /tests\/verification-bank-reference\.test\.cjs/);
});
