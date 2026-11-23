const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    fileName: f,
  }).outputText, f);
}

const { nextPasscodeValidity } = require('../lib/ttlock/passcode-period.ts');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const monthMs = 30 * 24 * 60 * 60 * 1000;

test('a verified payment extends the same code by 30 days from the current expiry', () => {
  const now = new Date('2026-11-17T12:00:00+08:00');
  const currentUntil = '2026-12-31T15:59:59.000Z';
  const result = nextPasscodeValidity({ now, currentUntil, contractEnd: '2028-01-31' });
  assert.equal(result.unchanged, false);
  assert.equal(result.validUntil.toISOString(), new Date(Date.parse(currentUntil) + monthMs).toISOString());
});

test('expiry is capped at the contract end and never shortened', () => {
  const now = new Date('2026-11-17T12:00:00+08:00');
  const capped = nextPasscodeValidity({
    now,
    currentUntil: '2026-12-15T15:59:59.000Z',
    contractEnd: '2026-12-20',
  });
  assert.equal(capped.validUntil.toISOString(), new Date('2026-12-20T23:59:59+08:00').toISOString());

  const alreadyAtCap = nextPasscodeValidity({
    now,
    currentUntil: '2026-12-20T15:59:59.000Z',
    contractEnd: '2026-12-20',
  });
  assert.equal(alreadyAtCap.unchanged, true);
  assert.equal(alreadyAtCap.validUntil.toISOString(), new Date('2026-12-20T15:59:59.000Z').toISOString());
});

test('an ended tenancy cannot extend access', () => {
  assert.throws(
    () => nextPasscodeValidity({
      now: new Date('2027-02-01T00:00:00+08:00'),
      currentUntil: '2027-01-15T15:59:59.000Z',
      contractEnd: '2027-01-15',
    }),
    /already ended/,
  );
});

test('checkout stays unchanged, and a new tenancy still gets a fresh passcode', () => {
  assert.equal(hash(read('lib/tenancy/checkout.ts')), '1147b0a64d04bcdb626f632f9fa39d29a9b3a9601957fd8c16130b6811a6a7b7');
  const access = read('lib/ttlock/access.ts');
  assert.match(access, /async function currentGrant\(deviceId: string, tenancyId: string\)/);
  assert.match(access, /\.eq\("tenancy_id", tenancyId\)/);
  assert.match(access, /function randomPasscode\(\)/);
  assert.match(access, /const passcode = randomPasscode\(\)/);
  assert.match(access, /storedOrFetchedPasscodeVersion/);
  assert.match(read('lib/tenancy/checkout.ts'), /revokeSmartLockAccessForTenancy\(tenancy\.id\)/);
});

test('staff-verified rent payment paths extend door access without blocking verification', () => {
  const sources = [
    'app/payment-verification/actions.ts',
    'app/payment-verification/folder-review-actions.ts',
    'app/rent-due-tracker/actions.ts',
  ].map(read).join('\n');
  assert.match(sources, /extendDoorAccessAfterPayment/);
  assert.doesNotMatch(sources, /extendFingerprintAccessAfterPayment/);
  const hook = read('lib/ttlock/payment-access.ts');
  assert.match(hook, /extendFingerprintAccessAfterPayment/);
  assert.match(hook, /extendPasscodeAccessAfterPayment/);
  assert.match(hook, /never thrown|Failures are\s+collected and never thrown/s);
  const extender = read('lib/ttlock/passcode-payment.ts');
  assert.match(extender, /last_extension_reference === input\.paymentSubmissionId/);
  assert.match(extender, /changeTTLockPasscode/);
  assert.doesNotMatch(extender, /addTTLockPasscode|deleteTTLockPasscode|revokeSmartLock/);
});

test('idempotent payment extension records the submission and does not invent a new code', async () => {
  const updates = [];
  const changes = [];
  const grants = [{
    id: 'grant-1',
    access_scope: 'room_entry',
    provider_keyboard_pwd_id: 44,
    keyboard_password: '246801',
    passcode_name: 'DEKEZ Tenant ROOM',
    credential_state: 'active',
    valid_from: '2026-08-10T07:49:31.227Z',
    valid_until: '2027-06-30T15:59:59.000Z',
    last_extension_reference: 'pay-1',
    last_error: null,
    smart_lock_devices: {
      id: 'device-1',
      provider_lock_id: 99,
      provider_lock_name: 'BDS OFFICE 6',
      has_gateway: true,
      sync_status: 'connected',
    },
  }];
  const admin = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({
          data: table === 'tenancies'
            ? { id: 'tenancy-1', status: 'active', billing_status: 'current', checkout_date: null, tenancy_end_date: '2028-01-31', contract_end: '2028-01-31', end_date: null, tenants: { profile_id: 'p1', full_name: 'Tenant' } }
            : null,
          error: null,
        }),
        then(ok, fail) {
          return Promise.resolve({ data: table === 'smart_lock_access_grants' ? grants : [], error: null }).then(ok, fail);
        },
        update(value) { updates.push(value); return { eq: async () => ({ error: null }) }; },
      };
    },
  };
  const loader = require('./marketplace-component-loader.cjs');
  const module = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/ttlock/client': { changeTTLockPasscode: async (input) => { changes.push(input); } },
  })('lib/ttlock/passcode-payment.ts');

  const first = await module.extendPasscodeAccessAfterPayment({
    tenancyId: 'tenancy-1',
    paymentSubmissionId: 'pay-1',
    performedBy: 'staff',
  });
  assert.equal(first.unchanged, 1);
  assert.equal(first.updated, 0);
  assert.deepEqual(changes, []);

  grants[0].last_extension_reference = null;
  const second = await module.extendPasscodeAccessAfterPayment({
    tenancyId: 'tenancy-1',
    paymentSubmissionId: 'pay-2',
    performedBy: 'staff',
  });
  assert.equal(second.updated, 1);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].passcode, '246801');
  assert.ok(changes[0].validUntil.getTime() > Date.parse(grants[0].valid_until));
});
