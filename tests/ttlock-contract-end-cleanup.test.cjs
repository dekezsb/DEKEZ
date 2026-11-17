const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const crypto = require('node:crypto');

const ts = require('typescript');
const Module = require('node:module');
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
const loader = require('./marketplace-component-loader.cjs');
const { hasContractEnded, resolveContractEndDate, malaysiaEnd } = require('../lib/ttlock/contract-end.ts');

const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

const endedNow = new Date('2026-12-15T00:10:00+08:00');
const stillCurrent = new Date('2026-12-14T23:59:59+08:00');

test('contract end is resolved like provision and ends only after 11:59:59pm MYT', () => {
  assert.equal(
    resolveContractEndDate({ tenancy_end_date: '2026-12-14', contract_end: '2026-11-01', end_date: '2026-10-01' }),
    '2026-12-14',
  );
  assert.equal(
    resolveContractEndDate({ tenancy_end_date: null, contract_end: '2026-12-14', end_date: '2026-10-01' }),
    '2026-12-14',
  );
  assert.equal(
    resolveContractEndDate({ tenancy_end_date: null, contract_end: null, end_date: '2026-12-14' }),
    '2026-12-14',
  );
  assert.equal(resolveContractEndDate({}), null);

  assert.equal(malaysiaEnd('2026-12-14').toISOString(), '2026-12-14T15:59:59.000Z');
  assert.equal(hasContractEnded('2026-12-14', stillCurrent), false);
  assert.equal(hasContractEnded('2026-12-14', endedNow), true);
  assert.equal(hasContractEnded('2027-06-30', endedNow), false);
  assert.equal(hasContractEnded(null, endedNow), false);
  assert.equal(hasContractEnded('not-a-date', endedNow), false);
});

function grantRow(overrides = {}) {
  return {
    id: 'grant-room',
    tenancy_id: 'tenancy-1',
    credential_state: 'active',
    tenancies: {
      tenancy_end_date: '2026-12-14',
      contract_end: '2026-12-14',
      end_date: '2026-12-14',
    },
    ...overrides,
  };
}

function thenableData(data) {
  return {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    update() { return this; },
    then(ok, fail) {
      return Promise.resolve({ data, error: null }).then(ok, fail);
    },
  };
}

function loadCleanup({ grants, revoke, revokeFingerprint, revokeError }) {
  const revoked = [];
  const fingerprints = [];
  return {
    revoked,
    fingerprints,
    module: loader({
      'server-only': {},
      '@/lib/supabase/admin': {
        createAdminClient: () => ({
          from() { return thenableData(grants); },
        }),
      },
      '@/lib/ttlock/access': {
        revokeSmartLockAccessForTenancy: async (tenancyId, options) => {
          if (revokeError) throw new Error(revokeError);
          revoked.push({ tenancyId, options });
          if (revoke) await revoke(tenancyId, options);
        },
      },
      '@/lib/ttlock/fingerprint': {
        revokeFingerprintAccessForTenancy: async (tenancyId) => {
          fingerprints.push(tenancyId);
        },
      },
    })('lib/ttlock/contract-end-cleanup.ts'),
  };
}

test('expired contracts revoke MAIN and ROOM once; current and renewed tenancies are skipped', async () => {
  const loaded = loadCleanup({
    grants: [
      grantRow({ id: 'main', credential_state: 'active' }),
      grantRow({ id: 'room', credential_state: 'active' }),
      grantRow({
        id: 'current',
        tenancy_id: 'tenancy-current',
        tenancies: { tenancy_end_date: '2027-06-30', contract_end: '2027-06-30', end_date: '2027-06-30' },
      }),
      grantRow({
        id: 'monthly',
        tenancy_id: 'tenancy-monthly',
        tenancies: { tenancy_end_date: null, contract_end: null, end_date: null },
      }),
    ],
  });
  const result = await loaded.module.revokeAccessAfterContractEnd({ now: endedNow });
  assert.equal(result.tenancies, 1);
  assert.equal(result.retried, 0);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(loaded.revoked, [{ tenancyId: 'tenancy-1', options: { reason: 'contract_ended' } }]);
  assert.deepEqual(loaded.fingerprints, ['tenancy-1']);
});

test('revoke_pending grants are retried and a second run is idempotent', async () => {
  const first = loadCleanup({
    grants: [grantRow({ credential_state: 'revoke_pending' })],
  });
  const retry = await first.module.revokeAccessAfterContractEnd({ now: endedNow });
  assert.equal(retry.tenancies, 1);
  assert.equal(retry.retried, 1);
  assert.equal(first.revoked.length, 1);

  const second = loadCleanup({ grants: [] });
  const again = await second.module.revokeAccessAfterContractEnd({ now: endedNow });
  assert.equal(again.tenancies, 0);
  assert.equal(again.retried, 0);
  assert.deepEqual(second.revoked, []);
});

test('a failed revoke stays open for the next run', async () => {
  const loaded = loadCleanup({
    grants: [grantRow()],
    revokeError: 'gateway timeout',
  });
  const result = await loaded.module.revokeAccessAfterContractEnd({ now: endedNow });
  assert.equal(result.tenancies, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /gateway timeout/);
});

test('existing revoke path deletes the lock passcode and records reason contract_ended', async () => {
  const updates = [];
  const deleted = [];
  const grants = [{
    id: 'grant-1',
    device_id: 'device-1',
    provider_keyboard_pwd_id: 44,
    credential_state: 'active',
    smart_lock_devices: { provider_lock_id: 99, provider_lock_name: 'BUNDUSAN OFFICE 4' },
  }];
  const admin = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        then(ok, fail) {
          return Promise.resolve({ data: grants, error: null }).then(ok, fail);
        },
        update(value) {
          updates.push(value);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  const module = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/ttlock/client': {
      addTTLockPasscode: async () => { throw new Error('write should not add'); },
      changeTTLockPasscode: async () => { throw new Error('write should not change'); },
      deleteTTLockPasscode: async (input) => { deleted.push(input); },
      getTTLockLockDetail: async () => { throw new Error('detail should not run'); },
    },
  })('lib/ttlock/access.ts');

  await module.revokeSmartLockAccessForTenancy('tenancy-1', { reason: 'contract_ended' });
  assert.deepEqual(deleted, [{ lockId: 99, keyboardPwdId: 44 }]);
  assert.equal(updates[0].credential_state, 'revoke_pending');
  assert.equal(updates[0].provider_status.reason, 'contract_ended');
  assert.equal(updates[1].credential_state, 'revoked');
  assert.equal(updates[1].provider_status.reason, 'contract_ended');
  assert.equal(updates[1].provider_status.operation, 'deleted_via_gateway');
  assert.equal(updates[1].keyboard_password, null);
});

test('failed lock delete leaves the grant revoke_pending for retry', async () => {
  const updates = [];
  const grants = [{
    id: 'grant-1',
    device_id: 'device-1',
    provider_keyboard_pwd_id: 44,
    credential_state: 'revoke_pending',
    smart_lock_devices: { provider_lock_id: 99, provider_lock_name: 'BDS MAIN OFFICE' },
  }];
  const admin = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        then(ok, fail) {
          return Promise.resolve({ data: grants, error: null }).then(ok, fail);
        },
        update(value) {
          updates.push(value);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  const module = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/ttlock/client': {
      deleteTTLockPasscode: async () => { throw new Error('gateway down'); },
    },
  })('lib/ttlock/access.ts');

  await assert.rejects(
    () => module.revokeSmartLockAccessForTenancy('tenancy-1', { reason: 'contract_ended' }),
    /gateway down/,
  );
  assert.equal(updates[0].credential_state, 'revoke_pending');
  assert.equal(updates[1].credential_state, undefined);
  assert.equal(updates[1].last_error, 'gateway down');
  assert.equal(updates.some((row) => row.credential_state === 'revoked'), false);
});

test('daily cron is protected by CRON_SECRET and registered for 12:10am MYT', async () => {
  const keys = ['CRON_SECRET'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  delete process.env.CRON_SECRET;

  const called = [];
  const api = loader({
    '@/lib/ttlock/contract-end-cleanup': {
      revokeAccessAfterContractEnd: async () => {
        called.push('ran');
        return { tenancies: 0, retried: 0, skipped: 0, errors: [] };
      },
    },
  })('app/api/ttlock-contract-end/route.ts');

  const request = (authorization) => new Request('https://example.invalid/api/ttlock-contract-end', {
    headers: authorization ? { authorization } : {},
  });

  assert.equal((await api.GET(request())).status, 401);
  assert.equal((await api.GET(request('Bearer missing'))).status, 401);
  process.env.CRON_SECRET = 'fixture-contract-end-cron';
  assert.equal((await api.GET(request('Bearer wrong'))).status, 401);
  assert.equal(called.length, 0);
  const ok = await api.GET(request('Bearer fixture-contract-end-cron'));
  assert.equal(ok.status, 200);
  assert.deepEqual(called, ['ran']);

  const crons = JSON.parse(read('vercel.json')).crons;
  assert.deepEqual(
    crons.filter((row) => row.path === '/api/ttlock-contract-end'),
    [{ path: '/api/ttlock-contract-end', schedule: '10 16 * * *' }],
  );
  assert.equal(crons.length, 9);

  for (const key of keys) {
    if (previous[key] == null) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

test('checkout, payment cap, renewal extend, and overdue no-op stay in place', () => {
  assert.equal(hash(read('lib/tenancy/checkout.ts')), 'efa6d3228271f0a0cc3c5056557a06cad8db9dfdba15a3f459f15f7cf172db6d');
  assert.match(read('lib/tenancy/checkout.ts'), /revokeSmartLockAccessForTenancy\(tenancy\.id\)/);
  const payment = read('lib/ttlock/passcode-period.ts');
  assert.match(payment, /contractUntil && contractUntil < requestedUntil/);
  assert.match(read('app/e-tenancy/actions.ts'), /reconcileSmartLockAccessForTenancy\(agreement\.tenancy_id\)/);
  const overdue = read('lib/ttlock/fingerprint.ts');
  const suspend = overdue.split('export async function suspendOverdueFingerprintAccess')[1].split('export async function')[0];
  assert.match(suspend, /never authorization to shorten door access/);
  assert.doesNotMatch(suspend, /deleteTTLockFingerprint|changeTTLockFingerprintPeriod|createAdminClient|from\(/);
});
