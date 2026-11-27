const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
for (const ext of ['.ts']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const d = require('../lib/payments/payment-date.ts');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Malaysia today follows UTC+8, not the server clock', () => {
  assert.equal(d.malaysiaToday(new Date('2026-11-26T16:30:00Z')), '2026-11-27');
  assert.equal(d.malaysiaToday(new Date('2026-11-26T15:59:00Z')), '2026-11-26');
});

test('bank-in date is required and is never replaced by today', () => {
  const now = new Date('2026-11-27T05:00:00Z');
  assert.deepEqual(d.checkPaymentDate('', now), { ok: false, error: 'payment_date_required' });
  assert.deepEqual(d.checkPaymentDate(undefined, now), { ok: false, error: 'payment_date_required' });
  assert.deepEqual(d.checkPaymentDate('2026-11-03', now), { ok: true, date: '2026-11-03' });
  assert.deepEqual(d.checkPaymentDate('2026-11-27', now), { ok: true, date: '2026-11-27' }, 'same-day bank-in is fine');
});

test('future, impossible and implausibly old dates are rejected', () => {
  const now = new Date('2026-11-27T05:00:00Z');
  assert.equal(d.checkPaymentDate('2026-11-28', now).error, 'payment_date_future');
  assert.equal(d.checkPaymentDate('2026-02-30', now).error, 'payment_date_invalid');
  assert.equal(d.checkPaymentDate('27/11/2026', now).error, 'payment_date_invalid');
  assert.equal(d.checkPaymentDate('2019-12-31', now).error, 'payment_date_too_old');
  for (const key of ['payment_date_required', 'payment_date_invalid', 'payment_date_future', 'payment_date_too_old']) assert.ok(d.paymentDateMessages[key]);
});

test('date field prefill uses the slip or bank line date, else stays blank', () => {
  assert.equal(d.paymentDateDefault('2026-11-03'), '2026-11-03');
  assert.equal(d.paymentDateDefault(null, '2026-10-31T00:00:00+08:00'), '2026-10-31');
  assert.equal(d.paymentDateDefault(null, undefined, ''), '');
});

test('no knock-off or payment-record flow falls back to today', () => {
  const files = [
    'app/payments/actions.ts', 'app/rent-due-tracker/actions.ts', 'app/onboarding/actions.ts',
    'app/payment-verification/actions.ts', 'app/rent-due-tracker/page.tsx', 'components/dashboard/compact-rent-due-tracker.tsx',
    'app/reservations/page.tsx', 'components/renovation/payments.tsx',
  ];
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /(paymentDate|paidDate|"date"|payment_date)["')]*\)?\s*\|\|\s*(new Date\(\)|malaysiaDateString\(\))/, `${file} must not default a payment date to today`);
    assert.doesNotMatch(src, /payment_date:\s*textValue\([^)]*\)\s*\|\|/, `${file} must validate the bank-in date`);
    assert.doesNotMatch(src, /paymentDateDefault=\{today\}|paidDateDefault=\{today\}|date=\{malaysiaDateString\(\)\}/, `${file} must not prefill today`);
  }
  assert.doesNotMatch(read('components/renovation/payments.tsx'), /name="payment_date"[^>]*defaultValue=\{today\}/);
});

test('server actions validate with checkPaymentDate and date inputs block future dates', () => {
  for (const file of ['app/payments/actions.ts', 'app/rent-due-tracker/actions.ts', 'app/onboarding/actions.ts', 'app/payment-verification/actions.ts'])
    assert.match(read(file), /checkPaymentDate\(/, `${file} validates the bank-in date`);
  assert.match(read('app/payment-verification/actions.ts'), /decision === "verified" && !checkPaymentDate\(effectivePaymentDate\)\.ok/);
  for (const file of ['app/rent-due-tracker/monthly-payment-folder.tsx', 'app/rent-due-tracker/rent-due-actions.tsx', 'app/rent-due-tracker/admin-payment-slip-upload.tsx',
    'app/payment-verification/payment-record-actions.tsx', 'app/reservations/payment-form.tsx', 'app/payments/page.tsx', 'app/onboarding/page.tsx'])
    assert.match(read(file), /max=\{malaysiaToday\(\)\}/, `${file} blocks future dates in the picker`);
  assert.match(read('components/renovation/payments.tsx'), /name="payment_date" type="date" required max=\{today\}/);
});

test('bank reconciliation and verification post on the slip / bank line date', () => {
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).map((f) => read(`supabase/migrations/${f}`)).join('\n');
  assert.match(migrations, /target_line\.transaction_date, 'bank_transfer'/, 'bank-matched tenant payments use the statement date');
  assert.match(migrations, /s\.amount,s\.payment_date,s\.payment_method/, 'payment folder verification uses the slip date');
  assert.match(read('app/payment-verification/actions.ts'), /p_payment_date: effectivePaymentDate/);
  assert.match(read('lib/payments/other-payment.ts'), /input\.paymentDate > today/, 'other payments already reject future dates');
});
