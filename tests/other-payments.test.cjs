const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
const load = Module._load;

// ---- fake Supabase -------------------------------------------------------
let tables, accessed, actor, role, visibleProperties, uploads, removed, revalidated;
function resetDb() {
  tables = {
    tenants: [{ id: 'person-1', profile_id: 'tenant-user' }],
    tenancies: [
      { id: 'ty-1', tenant_id: 'person-1', company_id: 'co', organization_id: null, property_id: 'prop', unit_id: null, room_id: 'room-1', status: 'active', billing_status: 'active', checkout_date: null, deposit: 500, tenants: { profile_id: 'tenant-user' } },
      { id: 'ty-2', tenant_id: 'person-9', company_id: 'co', organization_id: null, property_id: 'prop', unit_id: null, room_id: 'room-9', status: 'active', billing_status: 'active', checkout_date: null, deposit: 300, tenants: { profile_id: 'someone-else' } },
    ],
    smart_meters: [],
    payment_submissions: [],
    payment_attachments: [],
    payments: [],
    payment_verification_audit_logs: [],
    profiles: [{ id: 'staff-1', full_name: 'Staff One' }],
    tenant_records: [],
    rent_bills: [{ id: 'bill-1', amount: 400, paid_amount: 0, status: 'unpaid' }],
    rental_invoice_line_items: [],
    rent_bill_audit_logs: [],
  };
  accessed = new Set();
  uploads = [];
  removed = [];
  revalidated = [];
}
let idCounter = 0;
function builder(table) {
  accessed.add(table);
  const filters = [];
  let op = 'select', payload = null, limit = Infinity, single = false;
  const run = () => {
    const rows = tables[table] ?? [];
    const match = (row) => filters.every((f) => f(row));
    if (op === 'insert') {
      const list = Array.isArray(payload) ? payload : [payload];
      const created = list.map((row) => ({ id: `id-${++idCounter}`, ...row }));
      if (table === 'payment_submissions' && created.some((r) => r.submission_key && rows.some((x) => x.submission_key === r.submission_key))) {
        return { data: null, error: { code: '23505', message: 'duplicate' } };
      }
      if (table === 'payments' && globalThis.__paymentInsertError) return { data: null, error: { message: 'boom' } };
      rows.push(...created);
      return { data: single ? created[0] : created, error: null };
    }
    if (op === 'update') {
      const hit = rows.filter(match);
      hit.forEach((row) => Object.assign(row, payload));
      const copies = hit.map((row) => ({ ...row }));
      return { data: single ? copies[0] ?? null : copies, error: null };
    }
    const hit = rows.filter(match).slice(0, limit).map((row) => ({ ...row }));
    return { data: single ? hit[0] ?? null : hit, error: null };
  };
  const api = {
    select() { return api; },
    insert(value) { op = 'insert'; payload = value; return api; },
    update(value) { op = 'update'; payload = value; return api; },
    eq(k, v) { filters.push((r) => r[k] === v); return api; },
    neq(k, v) { filters.push((r) => r[k] !== v); return api; },
    in(k, v) { filters.push((r) => v.includes(r[k])); return api; },
    is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api; },
    not() { return api; },
    order() { return api; },
    limit(n) { limit = n; return api; },
    maybeSingle() { single = true; return Promise.resolve(run()); },
    single() { single = true; return Promise.resolve(run()); },
    then(resolveFn, rejectFn) { return Promise.resolve(run()).then(resolveFn, rejectFn); },
  };
  return api;
}
const db = {
  from: builder,
  storage: { from: () => ({
    upload: async (p, bytes, options) => { uploads.push({ p, size: bytes.length, options }); return { error: null }; },
    remove: async (p) => { removed.push(...p); return { error: null }; },
  }) },
};

Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
Module._load = function (request, ...args) {
  if (request === 'next/cache') return { revalidatePath: (p) => revalidated.push(p) };
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }), redirect(url) { throw Error(url); } };
  if (request === '@/lib/auth/session') return { requireRole: async (allowed) => { if (!allowed.includes(role)) throw Error('Forbidden'); return role; } };
  if (request === '@/lib/data/organization') return { getCurrentUser: async () => actor, getProperties: async () => visibleProperties };
  if (request === '@/lib/supabase/admin') return { createAdminClient: () => db };
  if (request === './actions') return { reviewPaymentSubmission() {}, reviewPaymentSubmissionInline() {}, reversePaymentSubmission() {} };
  return load.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    fileName: f,
  }).outputText, f);
}

const other = require('../lib/payments/other-payment.ts');
const { submitOtherPayment, submitOtherPaymentForTenant } = require('../app/other-payments/actions.ts');
const { reviewOtherPaymentInline } = require('../app/payment-verification/other-payment-actions.ts');

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const KEY1 = '11111111-1111-4111-8111-111111111111';
const KEY2 = '22222222-2222-4222-8222-222222222222';

function slip(name = 'slip.jpg', type = 'image/jpeg', size = 2048, fill = 7) {
  return new File([Buffer.alloc(size, fill)], name, { type });
}
function form(values = {}) {
  const data = new FormData();
  const base = {
    paymentType: 'key_replacement', amount: '25.00', paymentDate: '2026-11-20', paymentMethod: 'bank_transfer',
    referenceNumber: 'REF123456', description: '', note: '', submissionKey: KEY1, tenancyId: 'ty-1', receipt: slip(),
  };
  for (const [k, v] of Object.entries({ ...base, ...values })) if (v !== null) data.set(k, v);
  return data;
}
function beforeEachCase() {
  resetDb();
  actor = { id: 'tenant-user' };
  role = 'tenant';
  visibleProperties = [{ id: 'prop' }];
  globalThis.__paymentInsertError = false;
}

// ---- pure rules ----------------------------------------------------------
test('four types map to safe payment categories and never to monthly_rent', () => {
  assert.deepEqual(other.OTHER_PAYMENT_TYPES.map((t) => t.value), ['top_up', 'key_replacement', 'deposit', 'other']);
  assert.equal(other.otherPaymentCategory('key_replacement'), 'key_replacement');
  assert.equal(other.otherPaymentCategory('top_up'), 'top_up');
  assert.equal(other.otherPaymentCategory('deposit'), 'deposit');
  assert.equal(other.otherPaymentCategory('other'), 'other');
  for (const type of other.OTHER_PAYMENT_TYPES) assert.notEqual(other.otherPaymentCategory(type.value), 'monthly_rent');
  assert.equal(other.otherPaymentDisplayLabel('key_replacement'), 'Other payment — Lost key / key replacement');
  assert.equal(other.isOtherPaymentSubmission({ bill_type: 'other_payment' }), true);
  assert.equal(other.isOtherPaymentSubmission({ bill_type: 'other' }), false);
  assert.equal(other.isOtherPaymentSubmission({ bill_type: 'monthly_rent' }), false);
});

test('field validation: amount, date, method, description and note', () => {
  const ok = { type: 'key_replacement', amount: 25, paymentDate: '2026-11-20', paymentMethod: 'duitnow', referenceNumber: ' ABC 123 ', description: '', note: ' hi ' };
  const good = other.validateOtherPaymentFields(ok, '2026-11-26');
  assert.equal(good.ok, true);
  assert.equal(good.value.referenceNumber, 'ABC 123');
  assert.equal(good.value.note, 'hi');
  const bad = (patch) => other.validateOtherPaymentFields({ ...ok, ...patch }, '2026-11-26').error;
  assert.equal(bad({ type: 'monthly_rent' }), 'type');
  assert.equal(bad({ amount: 0 }), 'amount');
  assert.equal(bad({ amount: -5 }), 'amount');
  assert.equal(bad({ amount: 10.123 }), 'amount');
  assert.equal(bad({ amount: 50001 }), 'amount');
  assert.equal(bad({ paymentDate: '2026-11-27' }), 'date');
  assert.equal(bad({ paymentDate: '2026-02-30' }), 'date');
  assert.equal(bad({ paymentMethod: 'cash' }), 'method');
  assert.equal(bad({ referenceNumber: 'x'.repeat(121) }), 'reference');
  assert.equal(bad({ type: 'other', description: 'ab' }), 'description');
  assert.equal(other.validateOtherPaymentFields({ ...ok, type: 'other', description: 'Parking sticker' }, '2026-11-26').ok, true);
  assert.equal(bad({ note: 'n'.repeat(501) }), 'note');
});

test('deposit balance cannot exceed the deposit still owed', () => {
  assert.deepEqual(other.depositBalanceCheck({ depositRequired: 500, depositReceived: 300, amount: 200 }), { remaining: 200, fits: true });
  assert.equal(other.depositBalanceCheck({ depositRequired: 500, depositReceived: 300, amount: 200.01 }).fits, false);
  assert.equal(other.depositBalanceCheck({ depositRequired: 500, depositReceived: 500, amount: 1 }).fits, false);
  assert.equal(other.depositBalanceCheck({ depositRequired: 0, depositReceived: 0, amount: 1 }).remaining, 0);
});

// ---- tenant submission ---------------------------------------------------
test('tenant submission is a pending slip with no rent bill and no tenancy link yet', async () => {
  beforeEachCase();
  const result = await submitOtherPayment(form());
  assert.equal(result.ok, true);
  assert.equal(result.code, 'saved');
  const [row] = tables.payment_submissions;
  assert.equal(row.bill_type, 'other_payment');
  assert.equal(row.payment_type, 'key_replacement');
  assert.equal(row.verification_status, 'pending_verification');
  assert.equal(row.tenant_id, 'tenant-user');
  assert.equal(row.rent_bill_id, undefined);
  assert.equal(row.tenancy_id, undefined);
  assert.equal(row.submitted_by_staff_id, null);
  assert.equal(row.amount, 25);
  assert.equal(row.property_id, 'prop');
  assert.equal(row.room_id, 'room-1');
  assert.match(row.receipt_sha256, /^[0-9a-f]{64}$/);
  assert.match(row.receipt_url, /^tenant-user\/other-payments\//);
  assert.equal(tables.payment_attachments.length, 1);
  assert.equal(tables.payment_attachments[0].payment_submission_id, row.id);
  assert.equal(tables.payments.length, 0, 'nothing is posted before verification');
  assert.equal(accessed.has('rent_bills'), false, 'submitting never reads or writes rent bills');
  assert.ok(revalidated.includes('/payment-verification'));
});

test('tenant cannot submit for someone else\'s room, with a bad slip, or twice', async () => {
  beforeEachCase();
  assert.equal((await submitOtherPayment(form({ tenancyId: 'ty-2' }))).code, 'tenancy');
  assert.equal((await submitOtherPayment(form({ receipt: null }))).code, 'slip');
  assert.equal((await submitOtherPayment(form({ receipt: slip('a.heic', 'image/heic') }))).code, 'slip');
  assert.equal((await submitOtherPayment(form({ receipt: slip('big.jpg', 'image/jpeg', 3 * 1024 * 1024 + 1) }))).code, 'slip');
  assert.equal((await submitOtherPayment(form({ amount: '0' }))).code, 'fields');
  assert.equal((await submitOtherPayment(form({ submissionKey: 'nope' }))).code, 'fields');
  assert.equal(tables.payment_submissions.length, 0);
  assert.equal((await submitOtherPayment(form())).ok, true);
  const again = await submitOtherPayment(form());
  assert.equal(again.code, 'duplicate');
  assert.equal(again.ok, true);
  const sameFile = await submitOtherPayment(form({ submissionKey: KEY2 }));
  assert.equal(sameFile.ok, false);
  assert.match(sameFile.message, /already been submitted/);
  assert.equal(tables.payment_submissions.length, 1);
});

test('electric top-up is routed to the existing meter box when the room has one', async () => {
  beforeEachCase();
  tables.smart_meters.push({ id: 'm1', room_id: 'room-1', meter_type: 'electricity', provider: 'ttlock', status: 'active' });
  const routed = await submitOtherPayment(form({ paymentType: 'top_up' }));
  assert.equal(routed.ok, false);
  assert.equal(routed.code, 'meter_top_up');
  assert.match(routed.message, /Electricity Top-Up box/);
  assert.equal(tables.payment_submissions.length, 0);
  // Other types still work for that room.
  assert.equal((await submitOtherPayment(form({ paymentType: 'key_replacement' }))).ok, true);
  // A room without a TTLock meter may submit a top-up slip.
  beforeEachCase();
  assert.equal((await submitOtherPayment(form({ paymentType: 'top_up' }))).ok, true);
  assert.equal(tables.payment_submissions[0].payment_type, 'top_up');
});

test('"other" needs a description and it is kept with the note', async () => {
  beforeEachCase();
  assert.equal((await submitOtherPayment(form({ paymentType: 'other' }))).code, 'fields');
  const ok = await submitOtherPayment(form({ paymentType: 'other', description: 'Parking sticker', note: 'paid by my sister' }));
  assert.equal(ok.ok, true);
  assert.match(tables.payment_submissions[0].payment_note, /For: Parking sticker/);
  assert.match(tables.payment_submissions[0].payment_note, /Note: paid by my sister/);
});

// ---- staff submission ----------------------------------------------------
test('staff can submit for a tenant: recorded as staff-submitted, still pending verification', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  const result = await submitOtherPaymentForTenant(form());
  assert.equal(result.ok, true);
  const [row] = tables.payment_submissions;
  assert.equal(row.tenant_id, 'tenant-user', 'filed under the tenant so it shows in their history');
  assert.equal(row.submitted_by_staff_id, 'staff-1');
  assert.equal(row.verification_status, 'pending_verification');
  assert.match(row.payment_note, /Submitted by management \(Staff One\)/);
  assert.equal(tables.payments.length, 0);
  assert.match(result.message, /Payment Verification/);
});

test('staff cannot submit for a property outside their access, a checked-out tenancy, or as a tenant', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  visibleProperties = [{ id: 'other-prop' }];
  assert.equal((await submitOtherPaymentForTenant(form())).code, 'tenancy');
  visibleProperties = [{ id: 'prop' }];
  tables.tenancies[0].checkout_date = '2026-11-01';
  assert.equal((await submitOtherPaymentForTenant(form())).code, 'tenancy');
  tables.tenancies[0].checkout_date = null;
  assert.equal((await submitOtherPaymentForTenant(form({ tenancyId: '' }))).code, 'tenancy');
  role = 'tenant';
  await assert.rejects(() => submitOtherPaymentForTenant(form()), /Forbidden/);
  role = 'admin';
  await assert.rejects(() => submitOtherPayment(form()), /Forbidden/);
  assert.equal(tables.payment_submissions.length, 0);
});

test('staff submission for a tenant without a portal login uses their tenant record', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  tables.tenancies[0].tenants = { profile_id: null };
  assert.equal((await submitOtherPaymentForTenant(form())).code, 'tenancy');
  tables.tenant_records.push({ id: 'rec-1', tenancy_id: 'ty-1' });
  const ok = await submitOtherPaymentForTenant(form());
  assert.equal(ok.ok, true);
  assert.equal(tables.payment_submissions[0].tenant_id, null);
  assert.equal(tables.payment_submissions[0].tenant_record_id, 'rec-1');
});

// ---- verification --------------------------------------------------------
function pendingSlip(patch = {}) {
  tables.payment_submissions.push({
    id: 'sub-1', verification_status: 'pending_verification', bill_type: 'other_payment', rent_bill_id: null,
    tenant_id: 'tenant-user', tenant_record_id: null, tenancy_id: null, property_id: 'prop', unit_id: null, room_id: 'room-1',
    payment_type: 'key_replacement', amount: 25, payment_date: '2026-11-20', payment_method: 'bank_transfer',
    reference_number: 'REF123456', payment_note: null, ...patch,
  });
}
function review(values = {}) {
  const data = new FormData();
  for (const [k, v] of Object.entries({ submissionId: 'sub-1', decision: 'verified', bankReference: 'REF123456', ...values })) data.set(k, v);
  return reviewOtherPaymentInline(data);
}

test('verifying posts exactly one payment with the right category and never touches rent', async () => {
  for (const [type, category] of [['key_replacement', 'key_replacement'], ['top_up', 'top_up'], ['other', 'other']]) {
    beforeEachCase();
    role = 'admin';
    actor = { id: 'staff-1' };
    pendingSlip({ payment_type: type });
    const before = JSON.stringify(tables.rent_bills);
    const result = await review();
    assert.deepEqual(result, { error: null, verified: true }, type);
    assert.equal(tables.payments.length, 1, type);
    const payment = tables.payments[0];
    assert.equal(payment.category, category);
    assert.equal(payment.rent_bill_id, null);
    assert.equal(payment.amount, 25);
    assert.equal(payment.status, 'confirmed');
    assert.equal(payment.tenancy_id, 'ty-1');
    assert.equal(payment.tenant_id, 'tenant-user');
    assert.equal(payment.payment_submission_id, 'sub-1');
    assert.equal(payment.reference_number, 'REF123456');
    assert.equal(tables.payment_submissions[0].verification_status, 'verified');
    assert.equal(tables.payment_submissions[0].tenancy_id, 'ty-1');
    assert.equal(JSON.stringify(tables.rent_bills), before, 'rent bill unchanged');
    for (const forbidden of ['rent_bills', 'rental_invoice_line_items', 'rent_bill_audit_logs']) {
      assert.equal(accessed.has(forbidden), false, `${forbidden} must not be touched`);
    }
    assert.equal(tables.payment_verification_audit_logs.at(-1).action, 'verified');
  }
});

test('verifying twice does not post a second payment', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  pendingSlip();
  assert.equal((await review()).verified, true);
  assert.equal((await review()).error, 'already_verified');
  assert.equal(tables.payments.length, 1);
});

test('verification refuses a slip tied to a rent bill, the wrong type, or a bank-transfer slip without a bank code', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  pendingSlip({ rent_bill_id: 'bill-1' });
  assert.equal((await review()).error, 'other_payment_review');
  tables.payment_submissions.length = 0;
  pendingSlip({ payment_type: 'monthly_rent' });
  assert.equal((await review()).error, 'other_payment_review');
  tables.payment_submissions.length = 0;
  pendingSlip({ bill_type: 'monthly_rent' });
  assert.equal((await review()).error, 'review', 'only other-payment slips can be verified here');
  tables.payment_submissions.length = 0;
  pendingSlip({ reference_number: null });
  assert.equal((await review({ bankReference: '' })).error, 'bank_reference_required');
  assert.equal(tables.payments.length, 0);
  visibleProperties = [];
  assert.equal((await review({ bankReference: 'REF123456' })).error, 'review');
});

test('deposit balance: capped at the deposit still owed, legacy slip-only deposits go to review', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  tables.tenancies[0].deposit = 500;
  tables.payments.push({ id: 'old', tenancy_id: 'ty-1', category: 'deposit', amount: 300, status: 'confirmed', reversed_at: null, payment_submission_id: null });
  pendingSlip({ payment_type: 'deposit', amount: 250 });
  assert.equal((await review()).error, 'other_payment_deposit_amount');
  assert.equal(tables.payments.length, 1);
  tables.payment_submissions[0].amount = 200;
  assert.equal((await review()).verified, true);
  assert.equal(tables.payments.at(-1).category, 'deposit');
  assert.equal(tables.payments.at(-1).amount, 200);

  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  tables.payment_submissions.push({ id: 'legacy', verification_status: 'verified', tenancy_id: 'ty-1', payment_type: 'deposit', amount: 300, bill_type: 'deposit' });
  pendingSlip({ payment_type: 'deposit', amount: 100 });
  assert.equal((await review()).error, 'other_payment_deposit_review');
  assert.equal(tables.payments.length, 0);
});

test('if the payment cannot be posted the slip goes back to pending', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  pendingSlip();
  globalThis.__paymentInsertError = true;
  assert.equal((await review()).error, 'review');
  assert.equal(tables.payment_submissions[0].verification_status, 'pending_verification');
  assert.equal(tables.payments.length, 0);
});

test('verification fails safely when the tenant has no single active room tenancy', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  pendingSlip({ room_id: 'room-unknown' });
  assert.equal((await review()).error, 'other_payment_tenancy');
  assert.equal(tables.payments.length, 0);
  assert.equal(tables.payment_submissions[0].verification_status, 'pending_verification');
});

test('rejecting needs a reason, posts nothing and keeps rent untouched', async () => {
  beforeEachCase();
  role = 'admin';
  actor = { id: 'staff-1' };
  pendingSlip();
  assert.equal((await review({ decision: 'rejected', notes: '' })).error, 'reason');
  assert.deepEqual(await review({ decision: 'rejected', notes: 'Slip unreadable' }), { error: null, verified: false });
  assert.equal(tables.payment_submissions[0].verification_status, 'rejected');
  assert.equal(tables.payment_submissions[0].rejection_reason, 'Slip unreadable');
  assert.equal(tables.payments.length, 0);
  assert.equal(accessed.has('rent_bills'), false);
  assert.equal(tables.payment_verification_audit_logs.at(-1).action, 'rejected');
});

// ---- wiring --------------------------------------------------------------
test('the rent verification action refuses other-payment slips so they can never be applied to a rent bill', () => {
  const source = read('app/payment-verification/actions.ts');
  assert.match(source, /isOtherPaymentSubmission\(currentSubmission\)/);
  assert.match(source, /error=other_payment_review/);
  assert.match(source, /select\("id, verification_status, bill_type,/);
  const guard = source.indexOf('isOtherPaymentSubmission(currentSubmission)');
  assert.ok(guard > 0 && guard < source.indexOf('let effectiveTenancyId'), 'guard runs before any allocation');
});

test('migration is additive and forbids a rent bill on an other payment', () => {
  const sql = read('supabase/migrations/20261126120000_other_payments.sql');
  assert.match(sql, /add column if not exists submitted_by_staff_id uuid/);
  assert.match(sql, /check \(bill_type <> 'other_payment' or rent_bill_id is null\)/);
  assert.doesNotMatch(sql, /\b(drop|truncate)\b|delete from/i);
  assert.doesNotMatch(sql, /update public\./i);
  assert.doesNotMatch(sql, /insert into/i);
});

test('tenant portal and staff payments page expose the form, the verification page shows the type', () => {
  const portal = read('components/tenant/tenant-portal.tsx');
  assert.match(portal, /<OtherPaymentCard data=\{data\} \/>/);
  assert.match(portal, /submitOtherPayment/);
  assert.match(portal, /id="electricity-top-up"/);
  assert.match(portal, /hasMeterTopUp: hasElectricityTopUpAccess/);
  assert.match(portal, /!isOtherPaymentSubmission\(submission\)/, 'rent pending notice ignores other payments');
  const staffPage = read('app/payments/page.tsx');
  assert.match(staffPage, /submitOtherPaymentForTenant/);
  assert.match(staffPage, /id="other-payment"/);
  const verification = read('app/payment-verification/page.tsx');
  assert.match(verification, /otherPayment: isOtherPaymentSubmission\(submission\)/);
  assert.match(verification, /Other payments only/);
  assert.match(verification, /submitted_by_staff_id/);
  const form = read('components/tenant/other-payment-form.tsx');
  assert.match(form, /prepareSlipForUpload/);
  assert.match(form, /heic/);
  assert.match(read('lib/payments/slip-upload.ts'), /prepareRegistrationUpload/);
  assert.match(read('lib/payments/payment-category.ts'), /key_replacement/);
  assert.match(read('package.json'), /tests\/other-payments\.test\.cjs/);
});

test('verification row labels the type, keeps one row of nine cells and its blue/green colours', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PaymentSlipRow } = require('../app/payment-verification/payment-slip-row.tsx');
  const row = {
    submissionId: 's', status: 'pending_verification', tenantName: 'Fixture Tenant', propertyName: 'SLS', roomName: 'D1', billMonth: '-',
    paymentDate: '2026-11-20', amountSubmitted: 'RM 25.00', amountSubmittedValue: 25, paymentPurpose: 'key_replacement',
    invoiceOutstanding: 0, rentOutstanding: 0, depositOutstanding: 0, referenceNumber: 'REF123456', receiptIsImage: true, receiptUrl: '/x.png',
    otherPayment: { typeLabel: 'Lost key / key replacement', submittedByStaff: 'Staff One' },
  };
  const html = renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null,
    React.createElement(PaymentSlipRow, { row, paymentMethod: 'bank_transfer', paymentNote: 'For: spare key', canCorrectPurpose: true, canReverse: true, returnTo: '/payment-verification', errorMessages: {} }))));
  assert.equal((html.match(/<tr /g) || []).length, 1);
  assert.equal((html.match(/<td /g) || []).length, 9);
  assert.match(html, /OTHER PAYMENT/);
  assert.match(html, /Other payment — Lost key \/ key replacement/);
  assert.match(html, /Submitted by staff: Staff One/);
  assert.match(html, /bg-sky-100\/70 hover:bg-sky-100/);
  assert.match(html, /EXISTING TENANT PAYMENT/);
  assert.match(html, /data-other-payment-review/);
  assert.doesNotMatch(html, /Monthly Rent/);
  assert.doesNotMatch(html, /name="paymentPurposeOverride"/, 'no rent allocation controls on an other payment');
  const verified = renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null,
    React.createElement(PaymentSlipRow, { row: { ...row, status: 'verified', verifiedBy: 'Admin', verifiedAt: '2026-11-21T01:00:00Z' }, paymentMethod: 'bank_transfer', canCorrectPurpose: true, canReverse: true, returnTo: '/payment-verification', errorMessages: {} }))));
  assert.match(verified, /Undo verification/);
  assert.doesNotMatch(verified, /data-other-payment-review/);
});
