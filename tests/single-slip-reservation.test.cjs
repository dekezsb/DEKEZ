const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const originalLoad = Module._load;
let states = [], stateIndex = 0, db, sessionId = 'actor';
Module._load = function(request, ...args) {
  if (request === 'react') return { ...React, useState(initial) {
    const index = stateIndex++;
    return React.useState(index < states.length ? states[index] : initial);
  }};
  if (request === '@/lib/supabase/admin') return { createAdminClient: () => db };
  if (request === '@/lib/auth/session') return { requireRole: async () => {} };
  if (request === '@/lib/data/organization') return { getCurrentUser: async () => ({ id: 'actor' }), getProperties: async () => [{ id: 'property', property_code: 'KLB', rental_model: 'tenancy' }] };
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: url => { throw new Error(`REDIRECT:${url}`); } };
  if (request === '@supabase/ssr') return { createServerClient: () => ({ auth: {
    getUser: async () => ({ data: { user: sessionId ? { id: sessionId } : null } }),
    signInWithPassword: async () => ({ error: null }),
  } }) };
  if (request === '@/lib/auth/registration') return { derivePinPassword: () => 'test-only', phoneAuthAlias: () => 'test@example.invalid' };
  if (request === '@/lib/referrals/registration') return { validateReferralRegistration: async () => null };
  if (request === '@/lib/supabase/server') return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) } }) };
  return originalLoad.call(this, request, ...args);
};
const { RegistrationForm: PublicForm } = require('../app/register/registration-form.tsx');
const { RegistrationForm: StaffForm } = require('../app/register-tenant/registration-form.tsx');
const { POST } = require('../app/api/register/complete/route.ts');
const { POST: START } = require('../app/api/register/start/route.ts');
const { submitAdminTenantApplication } = require('../app/register-tenant/actions.ts');
const { reservationAmount, validReservationPaymentDate, reservationPaymentError } = require('../lib/tenancy/reservation-payment.ts');
function render(Form, mode, code = 'KLB', identity = 'ic') {
  stateIndex = 0;
  states = Form === PublicForm ? ['tenant', identity, 'property', 'room', mode, {}, '600', '', '50', null, false]
    : ['property', 'room', '600', '600', '', '', mode, identity, 'sole_proprietor'];
  return renderToStaticMarkup(React.createElement(Form, { action: async () => {}, properties: [{ id: 'property', label: code, code, propertyCode: code, rentalModel: 'tenancy', isCommercial: ['BDS','PTT'].includes(code), contractDurations: [6,12] }], rooms: [{ id: 'room', propertyId: 'property', roomNumber: '9', monthlyRent: 600 }] }));
}
test('public reservation has one deposit slip plus optional IC front/back uploads', () => {
  const html = render(PublicForm, 'reservation');
  assert.match(html, /name="reservationDeposit"/);
  assert.match(html, /Reservation deposit slip/);
  assert.doesNotMatch(html.replace(/<label hidden="">[\s\S]*?<\/label>/g, ''), /name="rentPaid"|name="depositPaid"|Emergency contact name/);
  assert.match(html, /IC photo - FRONT/);
  assert.match(html, /IC photo - BACK/);
  // Camera and gallery are two ways to choose the SAME single attachment.
  assert.equal((html.match(/type="file"/g) || []).length, 6);
  assert.equal((html.match(/Choose file/g) || []).length, 3);
});
test('staff reservation has optional identity files and one payment slip/amount', () => {
  const html = render(StaffForm, 'reservation');
  assert.equal((html.match(/type="file"/g) || []).length, 3);
  assert.equal((html.match(/name="reservationDeposit"/g) || []).length, 1);
  assert.match(html, /name="paymentSlip"/);
  assert.doesNotMatch(html.replace(/<label hidden="">[\s\S]*?<\/label>/g, ''), /name="rentPaid"|name="depositPaid"|Emergency contact name/);
  for (const name of ['icFront', 'icBack']) {
    const input = html.match(new RegExp('<input[^>]*name="' + name + '"[^>]*>'))[0];
    assert.doesNotMatch(input, /required/);
  }
});
test('both reservation forms offer passport upload without requiring it', () => {
  for (const Form of [PublicForm, StaffForm]) {
    const html = render(Form, 'reservation', 'KLB', 'passport');
    assert.match(html, /Passport photo page/);
    assert.doesNotMatch(html, /IC photo - FRONT|name="icFront"/);
    assert.equal((html.match(/type="file"/g) || []).length, Form === PublicForm ? 4 : 2);
    const fieldset = html.match(/<fieldset[^>]*>(?:(?!<\/fieldset>)[\s\S])*?Identity (?:photos|documents)[\s\S]*?<\/fieldset>/)[0];
    assert.doesNotMatch(fieldset, /required=""/);
  }
});
test('normal check-in retains rent/deposit split and identity photos', () => {
  for (const Form of [PublicForm, StaffForm]) {
    const html = render(Form, 'check_in');
    assert.match(html, /name="rentPaid"/);
    assert.match(html, /name="depositPaid"/);
    assert.doesNotMatch(html, /name="reservationDeposit"/);
    assert.ok((html.match(/type="file"/g) || []).length >= 3);
  }
});
test('public BDS/PTT cannot force reservation mode', () => {
  for (const code of ['BDS','PTT']) assert.doesNotMatch(render(PublicForm, 'reservation', code), /name="reservationDeposit"/);
});
test('booking deposit validation accepts RM50 independently of later rent/security terms', () => {
  assert.equal(reservationAmount('50'), 50);
  assert.equal(reservationPaymentError('50', '2026-09-12', true), null);
  for (const value of ['', ' ', '-1', '0', 'NaN', 'Infinity', '5.555', 1000001, null]) assert.equal(reservationAmount(value), null);
  assert.equal(validReservationPaymentDate('2026-02-31'), false);
  assert.equal(validReservationPaymentDate('2026-09-12'), true);
  assert.match(reservationPaymentError('50','2026-09-12',false), /one reservation deposit slip/);
});
function mockDb({ slipExists = true, applicationMode = 'reservation', rpcError = null, missingIdentity = false, documentError = null, existingDocument = false } = {}) {
  const calls = [];
  const application = { id: 'booking', tenant_id: 'actor', status: 'draft', registration_mode: applicationMode, monthly_rent: 600, deposit: 100, utility_deposit: 0 };
  db = {
    calls,
    from(table) {
      const query = { select() { return query; }, eq() { return query; },
        update(value) { calls.push({ table, update: value }); return query; },
        insert(value) { calls.push({ table, insert: value }); return query; },
        then(resolve) { return Promise.resolve({ error: table === 'tenant_documents' ? documentError : null }).then(resolve); },
        async maybeSingle() { return { data: table === 'profiles' ? { requested_role: 'tenant' } : table === 'tenant_documents' ? (existingDocument ? { id: 'saved-document' } : null) : application }; },
      }; return query;
    },
    storage: { from(bucket) { return { async list(folder, { search }) { return { data: (bucket === 'tenant-documents' ? !missingIdentity : slipExists) ? [{ name: search }] : [], error: null }; } }; } },
    async rpc(name, args) { calls.push({ name, args }); return { error: rpcError, data: 'master-payment' }; },
  };
  return calls;
}
function body(overrides = {}) {
  return { accountType: 'tenant', applicationId: 'booking', reservationDeposit: '50', paymentDate: '2026-09-12', rentPaid: '600', depositPaid: '', uploads: [{ key: 'paymentSlip', bucket: 'payment-receipts', path: 'actor/self-registration/booking/slip.png', fileName: 'slip.png', contentType: 'image/png' }], ...overrides };
}
const submit = (data) => POST(new Request('https://dekez.test/api/register/complete', { method: 'POST', body: JSON.stringify(data) }));
function withIdentity(keys = ['icFront', 'icBack']) {
  const data = body();
  data.uploads.push(...keys.map(key => ({ key, bucket: 'tenant-documents', path: `actor/self-registration/booking/${key}.png`, fileName: `${key}.png`, contentType: 'image/png' })));
  return data;
}
test('reservation saves IC or passport on its existing application before one deposit submission', async () => {
  for (const keys of [['icFront', 'icBack'], ['passportPhoto']]) {
    const calls = mockDb();
    assert.equal((await submit(withIdentity(keys))).status, 200);
    const docs = calls.filter(c => c.table === 'tenant_documents');
    assert.equal(docs.length, keys.length);
    for (const doc of docs) {
      assert.equal(doc.insert.tenant_application_id, 'booking');
      assert.equal(doc.insert.tenant_id, 'actor');
      assert.equal(doc.insert.uploaded_by, 'actor');
      assert.equal(doc.insert.verification_status, undefined);
      assert.ok(calls.indexOf(doc) < calls.findIndex(c => c.name));
    }
    assert.equal(calls.filter(c => c.name).length, 1);
    assert.equal(calls.some(c => ['payments', 'payment_submissions', 'rent_bills'].includes(c.table)), false);
  }
});
test('identity upload/save failures stop booking; completion retry reuses saved identity', async () => {
  for (const [options, status] of [[{ missingIdentity: true }, 400], [{ documentError: { message: 'failure' } }, 500]]) {
    const calls = mockDb(options);
    assert.equal((await submit(withIdentity())).status, status);
    assert.equal(calls.some(c => c.name || c.table === 'profiles'), false);
  }
  const calls = mockDb({ existingDocument: true });
  assert.equal((await submit(withIdentity())).status, 200);
  assert.equal(calls.some(c => c.table === 'tenant_documents'), false);
});
test('identity attachments reject other bookings/users, unknown keys and duplicate keys', async () => {
  for (const change of [
    data => data.uploads[1].path = 'actor/self-registration/other/ic.png',
    data => data.uploads[1].path = 'other/self-registration/booking/ic.png',
    data => data.uploads[1].key = 'companyDocument',
    data => data.uploads[1].path = null,
    data => data.uploads.push(data.uploads[1]),
  ]) {
    const calls = mockDb(), data = withIdentity(); change(data);
    assert.equal((await submit(data)).status, 400);
    assert.equal(calls.length, 0);
  }
});
test('reservation completion ignores old split fields and calls atomic submission, not receipt/invoice inserts', async () => {
  const calls = mockDb();
  const response = await submit(body());
  assert.equal(response.status, 200);
  assert.deepEqual(calls.filter(c => c.name).map(c => [c.name,c.args.p_application,c.args.p_amount]), [['submit_reservation_deposit','booking',50]]);
  assert.deepEqual(calls.filter(c => c.table).map(c => c.table), ['profiles']);
});
test('missing slip, wrong booking path and wrong identity bucket cannot submit a reservation', async () => {
  let calls = mockDb({ slipExists: false });
  assert.equal((await submit(body())).status, 400);
  assert.equal(calls.length, 0);
  calls = mockDb();
  const data = body(); data.uploads[0].path = 'actor/self-registration/other-booking/slip.png';
  assert.equal((await submit(data)).status, 400);
  assert.equal(calls.length, 0);
  calls = mockDb();
  const extra = body(); extra.uploads.push({ ...extra.uploads[0], key: 'icFront' });
  assert.equal((await submit(extra)).status, 400);
  assert.equal(calls.length, 0);
});
test('atomic conflict is not reported as successful registration', async () => {
  const calls = mockDb({ rpcError: { message: 'Room no longer available' } });
  assert.equal((await submit(body())).status, 409);
  assert.equal(calls.some(c => c.table === 'profiles'), false);
});
test('normal check-in payment validation remains unchanged', async () => {
  const calls = mockDb({ applicationMode: 'check_in' });
  assert.equal((await submit(body())).status, 400);
  assert.equal(calls.length, 0);
});
function mockStart({ existing = true, status = 'draft', mode = 'reservation', completed = false, money = false, uploadFails = false } = {}) {
  const calls = [];
  db = {
    auth: { admin: {
      async createUser() { calls.push('create-user'); return { data: { user: { id: 'actor' } }, error: null }; },
      async deleteUser() { calls.push('delete-user'); return {}; },
    } },
    storage: { from() { return { async createSignedUploadUrl() { return uploadFails ? { error: new Error('Test failure') } : { data: { token: 'test-token' } }; } }; } },
    from(table) {
      let mutation = null;
      const query = {
        select() { return query; }, in() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; },
        insert(value) { mutation = 'insert'; calls.push({ table, mutation, value }); return query; },
        update(value) { mutation = 'update'; calls.push({ table, mutation, value }); return query; },
        async maybeSingle() {
          return { data: table === 'profiles' ? (existing ? { id: 'actor', requested_role: 'tenant', registration_completed_at: completed ? '2026-09-12' : null } : null)
            : table === 'properties' ? { id: 'property', property_code: 'KLB', is_commercial: false, rental_model: 'tenancy', contract_duration_options: [6,12] }
            : table === 'rooms' ? { id: 'room', property_id: 'property', status: 'vacant', monthly_rent: 600 }
            : { id: 'booking', status, registration_mode: mode } };
        },
        async single() { return { data: { id: 'booking' }, error: null }; },
        then(resolve) { return Promise.resolve({ data: table === 'payment_submissions' && money ? [{ id: 'paid' }] : [], error: null }).then(resolve); },
      }; return query;
    },
  };
  return calls;
}
function startData(extra = {}) {
  return { accountType: 'tenant', registrationMode: 'reservation', identityType: 'ic', fullName: 'Test Booking', phone: '0123456789', propertyId: 'property', roomId: 'room', agreedMonthlyRent: '600', agreedDeposit: '100', preferredMoveInDate: '2026-09-15', reservationDeposit: '50', paymentDate: '2026-09-12', uploads: [{ key: 'paymentSlip', name: 'slip.png', type: 'image/png', size: 128 }], ...extra };
}
async function start(data) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
  return START({ json: async () => data, cookies: { getAll: () => [], set: () => {} } });
}
test('own authenticated failed reservation resumes the draft without creating another user/application', async () => {
  sessionId = 'actor';
  const calls = mockStart();
  const response = await start(startData());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).applicationId, 'booking');
  assert.equal(calls.includes('create-user'), false);
  assert.equal(calls.some(c => c.table === 'tenant_applications' && c.mutation === 'insert'), false);
  assert.equal(calls.some(c => c.table === 'tenant_applications' && c.mutation === 'update'), true);
});
test('phone knowledge cannot resume another account or an already-paid draft', async () => {
  for (sessionId of [null, 'someone-else']) {
    const calls = mockStart(); assert.equal((await start(startData())).status, 409); assert.equal(calls.length, 0);
  }
  sessionId = 'actor';
  const calls = mockStart({ money: true });
  assert.equal((await start(startData())).status, 409); assert.equal(calls.length, 0);
});
test('already submitted own reservation returns its existing status without resubmission', async () => {
  sessionId = 'actor'; const calls = mockStart({ status: 'submitted', completed: true });
  const response = await start(startData()); assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, true); assert.equal(calls.length, 0);
});
test('failure during resume never deletes the pre-existing user', async () => {
  sessionId = 'actor'; const calls = mockStart({ uploadFails: true });
  assert.equal((await start(startData())).status, 500);
  assert.equal(calls.includes('delete-user'), false);
});
test('reservation amount/slip is validated before creating a new account', async () => {
  sessionId = null; const calls = mockStart({ existing: false });
  assert.equal((await start(startData({ reservationDeposit: '' }))).status, 400);
  assert.equal(calls.length, 0);
});
test('start signs identity uploads separately from the single payment receipt', async () => {
  sessionId = 'actor'; mockStart();
  const data = startData();
  data.uploads.push(...['icFront', 'icBack', 'passportPhoto'].map(key => ({ key, name: `${key}.png`, type: 'image/png', size: 128 })));
  const response = await start(data);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.uploads.length, 4);
  for (const upload of result.uploads) {
    assert.equal(upload.bucket, upload.key === 'paymentSlip' ? 'payment-receipts' : 'tenant-documents');
    assert.ok(upload.path.startsWith('actor/self-registration/booking/'));
  }
});
test('start rejects unrelated reservation attachments before creating an account', async () => {
  sessionId = null; const calls = mockStart({ existing: false });
  const data = startData(); data.uploads.push({ key: 'companyDocument', name: 'company.pdf', type: 'application/pdf', size: 128 });
  assert.equal((await start(data)).status, 400);
  assert.equal(calls.length, 0);
});
function mockStaff({ documentError = false, uploadError = false, rpcError = false, submitted = false } = {}) {
  const calls = [];
  db = {
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; },
        insert(value) { calls.push({ table, insert: value }); return query; },
        delete() { calls.push({ table, delete: true }); return query; },
        async single() { return { data: { id: 'booking' } }; },
        async maybeSingle() { return { data: table === 'rooms' ? { id: 'room', unit_id: 'unit', status: 'vacant' } : { status: submitted ? 'submitted' : 'draft' } }; },
        then(resolve) { return Promise.resolve({ error: table === 'tenant_documents' && documentError ? new Error('save failure') : null }).then(resolve); },
      }; return query;
    },
    storage: { from(bucket) { return {
      async upload(path) { calls.push({ bucket, upload: path }); return { error: bucket === 'tenant-documents' && uploadError ? new Error('upload failure') : null }; },
      async remove(paths) { calls.push({ bucket, remove: paths }); return {}; },
    }; } },
    async rpc(name, args) { calls.push({ name, args }); return { error: rpcError ? new Error('rpc failure') : null }; },
  };
  return calls;
}
function staffData(keys = ['icFront', 'icBack']) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ registrationMode: 'reservation', propertyId: 'property', roomId: 'room', fullName: 'Test Only', identityType: keys.includes('passportPhoto') ? 'passport' : 'ic', identificationNumber: 'TEST', phone: '0123456789', monthlyRent: '600', deposit: '100', contractStart: '2026-09-30', reservationDeposit: '50', paymentDate: '2026-09-28' })) form.set(key, value);
  for (const key of [...keys, 'paymentSlip']) form.set(key, new File(['test'], `${key}.png`, { type: 'image/png' }));
  return form;
}
test('staff reservation saves optional IC/passport on same booking before payment submission', async () => {
  for (const keys of [['icFront', 'icBack'], ['passportPhoto'], []]) {
    const calls = mockStaff();
    await assert.rejects(submitAdminTenantApplication(staffData(keys)), /REDIRECT:\/register-tenant\?reserved=1/);
    const documents = calls.find(c => c.table === 'tenant_documents' && c.insert);
    assert.equal(documents?.insert.length ?? 0, keys.length);
    for (const document of documents?.insert ?? []) {
      assert.equal(document.tenant_application_id, 'booking');
      assert.equal(document.tenant_id, null);
      assert.equal(document.verification_status, undefined);
    }
    if (documents) assert.ok(calls.indexOf(documents) < calls.findIndex(c => c.name));
    assert.equal(calls.filter(c => c.name === 'submit_reservation_deposit').length, 1);
  }
});
test('staff identity failure cannot submit money and cleans only its new draft files', async () => {
  for (const options of [{ uploadError: true }, { documentError: true }]) {
    const calls = mockStaff(options);
    await assert.rejects(submitAdminTenantApplication(staffData()), /error=upload/);
    assert.equal(calls.some(c => c.name), false);
    assert.ok(calls.some(c => c.table === 'tenant_applications' && c.delete));
    assert.ok(calls.some(c => c.bucket === 'payment-receipts' && c.remove));
  }
});
test('staff lost submission response preserves documents of successfully submitted booking', async () => {
  const calls = mockStaff({ rpcError: true, submitted: true });
  await assert.rejects(submitAdminTenantApplication(staffData()), /reserved=1/);
  assert.equal(calls.some(c => c.delete || c.remove), false);
});
