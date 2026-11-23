const test = require('node:test');
const assert = require('node:assert/strict');
const { read, fakeAdmin, loader } = require('./ttlock-test-helpers.cjs');

const rules = require('../lib/ttlock/ekey-rules.ts');

test('TTLock usernames are normalised for phone, email and plain accounts', () => {
  assert.equal(rules.normalizeTTLockUsername(' +60 12-345 6789 '), '+60123456789');
  assert.equal(rules.normalizeTTLockUsername('60\u20111234\u20115678'), '6012345678');
  assert.equal(rules.normalizeTTLockUsername('Tenant@Mail.COM'), 'tenant@mail.com');
  assert.equal(rules.normalizeTTLockUsername('dekez_room4'), 'dekez_room4');
  assert.equal(rules.normalizeTTLockUsername(''), null);
  assert.equal(rules.normalizeTTLockUsername('not an @ email'), null);
  assert.equal(rules.normalizeTTLockUsername('12'), null);
});

test('eKey names are short and say which door', () => {
  assert.equal(rules.ekeyName('Ali', 'room_entry'), 'DEKEZ Ali ROOM APP');
  assert.equal(rules.ekeyName('Ali', 'property_entry'), 'DEKEZ Ali MAIN APP');
  assert.ok(rules.ekeyName('x'.repeat(80), 'room_entry').length <= 50);
});

test('reconcile plan sends, extends, re-sends or leaves eKeys alone', () => {
  const from = new Date('2026-11-01T00:00:00+08:00');
  const until = new Date('2027-10-31T23:59:59+08:00');
  const base = {
    credential_state: 'active',
    provider_key_id: 77,
    receiver_username: '60123456789',
    valid_from: from.toISOString(),
    valid_until: until.toISOString(),
  };
  assert.deepEqual(rules.planEKeyReconcile({ existing: null, receiverUsername: '60123456789', validFrom: from, validUntil: until }), { action: 'send' });
  assert.deepEqual(rules.planEKeyReconcile({ existing: base, receiverUsername: '60123456789', validFrom: new Date(), validUntil: until }), { action: 'unchanged' });
  assert.deepEqual(
    rules.planEKeyReconcile({ existing: base, receiverUsername: '60123456789', validFrom: from, validUntil: new Date('2028-01-01T00:00:00Z') }),
    { action: 'extend', keyId: 77 },
  );
  assert.deepEqual(
    rules.planEKeyReconcile({ existing: base, receiverUsername: 'new@mail.com', validFrom: from, validUntil: until }),
    { action: 'resend', keyId: 77 },
  );
  assert.equal(
    rules.planEKeyReconcile({ existing: { ...base, credential_state: 'revoke_pending' }, receiverUsername: '60123456789', validFrom: from, validUntil: until }).action,
    'blocked',
  );
  assert.equal(
    rules.planEKeyReconcile({ existing: { ...base, provider_key_id: null }, receiverUsername: '60123456789', validFrom: from, validUntil: until }).action,
    'blocked',
  );
});

test('eKey access window matches passcodes: check-in to contract end 11:59:59pm MYT', () => {
  const now = new Date('2026-11-23T06:00:00Z');
  const window = rules.tenancyAccessWindow({
    check_in_date: '2026-11-01', tenancy_start_date: null, contract_start: null, start_date: null,
    tenancy_end_date: '2027-10-31', contract_end: null, end_date: null, rental_model: 'tenancy',
  }, now);
  assert.equal(window.ok, true);
  assert.equal(window.validUntil.toISOString(), '2027-10-31T15:59:59.000Z');
  assert.equal(window.validFrom.getTime(), now.getTime() - 5 * 60_000);
  assert.deepEqual(
    rules.tenancyAccessWindow({ check_in_date: null, tenancy_start_date: null, contract_start: null, start_date: null, tenancy_end_date: null, contract_end: null, end_date: null, rental_model: 'tenancy' }, now),
    { ok: false, reason: 'missing_dates' },
  );
  const monthly = rules.tenancyAccessWindow({
    check_in_date: '2026-11-20', tenancy_start_date: null, contract_start: null, start_date: null,
    tenancy_end_date: null, contract_end: null, end_date: null, rental_model: 'monthly_stay',
  }, now);
  assert.equal(monthly.ok, true);
  assert.equal(monthly.validUntil.getTime(), now.getTime() + 30 * 24 * 3600 * 1000);
});

test('TTLock eKey error codes become staff-readable messages', () => {
  const err = Object.assign(new Error('raw'), { errcode: -4064 });
  assert.match(rules.ekeyErrorMessage(err), /not registered yet/);
  assert.equal(rules.ekeyErrorMessage(new Error('gateway busy')), 'gateway busy');
  assert.equal(rules.providerKeyStatusLabel('110405'), 'Frozen');
  assert.equal(rules.isMissingSchemaError({ code: '42P01', message: 'relation "public.smart_lock_ekey_grants" does not exist' }), true);
  assert.equal(rules.isMissingSchemaError({ code: '23505', message: 'duplicate' }), false);
});

function loadClient(fetchImpl) {
  const calls = [];
  const previous = { ...process.env };
  Object.assign(process.env, {
    TTLOCK_CLIENT_ID: 'test-client', TTLOCK_CLIENT_SECRET: 'test-secret',
    TTLOCK_USERNAME: 'test-user', TTLOCK_PASSWORD: 'test-password', TTLOCK_API_BASE_URL: 'https://ttlock.test',
  });
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
    calls.push({ url: String(url), method: init.method, body });
    if (String(url).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }));
    return fetchImpl(String(url), init, body);
  };
  const client = loader({ 'server-only': {} })('lib/ttlock/client.ts');
  return {
    client,
    calls,
    restore() { global.fetch = originalFetch; process.env = previous; },
  };
}

test('client sends eKeys as a normal (non-admin) key without auto-creating accounts', async () => {
  const t = loadClient(async () => new Response(JSON.stringify({ keyId: 5512 })));
  try {
    const keyId = await t.client.sendTTLockEKey({
      lockId: 99, receiverUsername: '60123456789', keyName: 'DEKEZ Ali ROOM APP',
      validFrom: new Date(1000), validUntil: new Date(2000), remarks: 'DEKEZ tenant access',
    });
    assert.equal(keyId, 5512);
    const call = t.calls.find((c) => c.url.endsWith('/v3/key/send'));
    assert.equal(call.method, 'POST');
    assert.equal(call.body.lockId, '99');
    assert.equal(call.body.receiverUsername, '60123456789');
    assert.equal(call.body.startDate, '1000');
    assert.equal(call.body.endDate, '2000');
    assert.equal(call.body.keyRight, '0');
    assert.equal(call.body.createUser, '2');
    assert.equal(call.body.clientId, 'test-client');
  } finally { t.restore(); }
});

test('client covers delete, freeze, unfreeze, changePeriod and paged GET listKey', async () => {
  const t = loadClient(async (url) => {
    if (url.includes('/v3/lock/listKey')) {
      const page = Number(new URL(url).searchParams.get('pageNo'));
      return new Response(JSON.stringify({ list: [{ keyId: page, lockId: 99 }], pages: 2 }));
    }
    return new Response(JSON.stringify({ errcode: 0 }));
  });
  try {
    await t.client.deleteTTLockEKey(1);
    await t.client.freezeTTLockEKey(2);
    await t.client.unfreezeTTLockEKey(3);
    await t.client.changeTTLockEKeyPeriod({ keyId: 4, validFrom: new Date(10), validUntil: new Date(20) });
    const keys = await t.client.listTTLockLockEKeys(99);
    assert.deepEqual(keys.map((k) => k.keyId), [1, 2]);
    const paths = t.calls.filter((c) => !c.url.endsWith('/oauth2/token')).map((c) => `${c.method} ${new URL(c.url).pathname}`);
    assert.deepEqual(paths, [
      'POST /v3/key/delete', 'POST /v3/key/freeze', 'POST /v3/key/unfreeze', 'POST /v3/key/changePeriod',
      'GET /v3/lock/listKey', 'GET /v3/lock/listKey',
    ]);
    const change = t.calls.find((c) => c.url.endsWith('/v3/key/changePeriod'));
    assert.deepEqual([change.body.keyId, change.body.startDate, change.body.endDate], ['4', '10', '20']);
  } finally { t.restore(); }
});

test('TTLock errors keep their errcode for friendly messages', async () => {
  const t = loadClient(async () => new Response(JSON.stringify({ errcode: -4064, errmsg: 'only registered' })));
  try {
    await assert.rejects(
      () => t.client.sendTTLockEKey({ lockId: 1, receiverUsername: 'x@y.com', keyName: 'k', validFrom: new Date(1), validUntil: new Date(2) }),
      (error) => error.errcode === -4064,
    );
  } finally { t.restore(); }
});

function loadEKey({ tables, client }) {
  const admin = fakeAdmin(tables);
  const module = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => admin.client },
    '@/lib/ttlock/client': client,
  })('lib/ttlock/ekey.ts');
  return { module, writes: admin.writes };
}

const activeTenancy = {
  id: 'tenancy-1', company_id: 'co', property_id: 'prop', room_id: 'room',
  check_in_date: '2026-11-01', tenancy_start_date: null, contract_start: null, start_date: null,
  tenancy_end_date: '2027-10-31', contract_end: null, end_date: null, checkout_date: null,
  status: 'active', billing_status: 'active', rental_model: 'tenancy',
  tenants: { profile_id: 'profile-1', full_name: 'Ali', ttlock_username: '+60123456789' },
};

test('move-in sends one eKey per main-door and room lock', async () => {
  const sent = [];
  const { module, writes } = loadEKey({
    tables: {
      tenancies: [activeTenancy],
      smart_lock_devices: (ops) => ({
        data: ops.filters.some((f) => f[1] === 'access_scope' && f[2] === 'property_entry')
          ? [{ id: 'main', provider_lock_id: 10, provider_lock_name: 'MAIN DOOR', access_scope: 'property_entry' }]
          : [{ id: 'roomlock', provider_lock_id: 11, provider_lock_name: 'ROOM 4', access_scope: 'room_entry' }],
        error: null,
      }),
      smart_lock_ekey_grants: [],
    },
    client: {
      sendTTLockEKey: async (input) => { sent.push(input); return 900 + sent.length; },
      deleteTTLockEKey: async () => { throw new Error('should not delete'); },
      changeTTLockEKeyPeriod: async () => { throw new Error('should not change'); },
    },
  });
  const result = await module.reconcileEKeyAccessForTenancy('tenancy-1');
  assert.deepEqual(result.errors, []);
  assert.equal(result.created, 2);
  assert.deepEqual(sent.map((s) => [s.lockId, s.receiverUsername, s.keyName]), [
    [10, '+60123456789', 'DEKEZ Ali MAIN APP'],
    [11, '+60123456789', 'DEKEZ Ali ROOM APP'],
  ]);
  assert.equal(sent[1].validUntil.toISOString(), '2027-10-31T15:59:59.000Z');
  const inserts = writes.filter((w) => w.kind === 'insert');
  assert.equal(inserts.length, 2);
  assert.equal(inserts[1].value.room_id, 'room');
  assert.equal(inserts[0].value.room_id, null);
  const activated = writes.filter((w) => w.kind === 'update' && w.value.credential_state === 'active');
  assert.deepEqual(activated.map((w) => w.value.provider_key_id), [901, 902]);
});

test('tenants without a TTLock account are skipped without any TTLock call', async () => {
  const { module } = loadEKey({
    tables: { tenancies: [{ ...activeTenancy, tenants: { ...activeTenancy.tenants, ttlock_username: null } }] },
    client: new Proxy({}, { get: () => async () => { throw new Error('no TTLock call expected'); } }),
  });
  const result = await module.reconcileEKeyAccessForTenancy('tenancy-1');
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.errors, []);
});

test('a failed send is recorded as error with a friendly reason', async () => {
  const { module, writes } = loadEKey({
    tables: {
      tenancies: [activeTenancy],
      smart_lock_devices: (ops) => ({
        data: ops.filters.some((f) => f[2] === 'room_entry')
          ? [{ id: 'roomlock', provider_lock_id: 11, provider_lock_name: 'ROOM 4', access_scope: 'room_entry' }]
          : [],
        error: null,
      }),
      smart_lock_ekey_grants: [],
    },
    client: {
      sendTTLockEKey: async () => { throw Object.assign(new Error('x'), { errcode: -4064 }); },
      deleteTTLockEKey: async () => {},
    },
  });
  const result = await module.reconcileEKeyAccessForTenancy('tenancy-1');
  assert.equal(result.created, 0);
  assert.match(result.errors[0], /ROOM 4: .*not registered yet/);
  const failed = writes.find((w) => w.kind === 'update' && w.value.credential_state === 'error');
  assert.match(failed.value.last_error, /not registered yet/);
});

test('verified payment extends active and frozen eKeys by 30 days capped at contract end, once per slip', async () => {
  const changed = [];
  const now = Date.now();
  const grant = (id, state, untilMs, ref = null) => ({
    id, device_id: 'd', tenancy_id: 'tenancy-1', access_scope: 'room_entry', provider_key_id: 70,
    receiver_username: '+60123456789', key_name: 'k', credential_state: state,
    valid_from: new Date(now - 86400000).toISOString(), valid_until: new Date(untilMs).toISOString(),
    last_extension_reference: ref, smart_lock_devices: { provider_lock_name: 'ROOM 4' },
  });
  const { module, writes } = loadEKey({
    tables: {
      tenancies: [{ ...activeTenancy, tenancy_end_date: null, rental_model: 'monthly_stay' }],
      smart_lock_ekey_grants: [
        grant('g1', 'active', now + 5 * 86400000),
        grant('g2', 'frozen', now + 5 * 86400000),
        grant('g3', 'active', now + 5 * 86400000, 'slip-1'),
      ],
    },
    client: { changeTTLockEKeyPeriod: async (input) => { changed.push(input); } },
  });
  const result = await module.extendEKeyAccessAfterPayment({ tenancyId: 'tenancy-1', paymentSubmissionId: 'slip-1' });
  assert.equal(result.updated, 2);
  assert.equal(result.unchanged, 1);
  assert.equal(changed.length, 2);
  const expected = now + 35 * 86400000;
  assert.ok(Math.abs(changed[0].validUntil.getTime() - expected) < 5000);
  assert.ok(writes.every((w) => w.value.last_extension_reference === undefined || w.value.last_extension_reference === 'slip-1'));
});

test('checkout revoke deletes eKeys and throws (blocking checkout) when TTLock fails', async () => {
  const deleted = [];
  const grants = [
    { id: 'g1', device_id: 'd1', tenancy_id: 't', access_scope: 'room_entry', provider_key_id: 41, receiver_username: 'u', credential_state: 'active', valid_from: '2026-01-01', valid_until: '2027-01-01', smart_lock_devices: { provider_lock_name: 'ROOM 4' } },
    { id: 'g2', device_id: 'd2', tenancy_id: 't', access_scope: 'property_entry', provider_key_id: 42, receiver_username: 'u', credential_state: 'frozen', valid_from: '2026-01-01', valid_until: '2027-01-01', smart_lock_devices: { provider_lock_name: 'MAIN' } },
  ];
  const ok = loadEKey({ tables: { smart_lock_ekey_grants: grants }, client: { deleteTTLockEKey: async (id) => { deleted.push(id); } } });
  await ok.module.revokeEKeyAccessForTenancy('t', { reason: 'checkout' });
  assert.deepEqual(deleted, [41, 42]);
  assert.equal(ok.writes.filter((w) => w.value.credential_state === 'revoked').length, 2);

  const gone = loadEKey({ tables: { smart_lock_ekey_grants: [grants[0]] }, client: { deleteTTLockEKey: async () => { throw Object.assign(new Error('missing'), { errcode: -1008 }); } } });
  await gone.module.revokeEKeyAccessForTenancy('t');
  assert.equal(gone.writes.some((w) => w.value.credential_state === 'revoked'), true);

  const down = loadEKey({ tables: { smart_lock_ekey_grants: [grants[0]] }, client: { deleteTTLockEKey: async () => { throw new Error('server busy'); } } });
  await assert.rejects(() => down.module.revokeEKeyAccessForTenancy('t'), /ROOM 4 eKey: server busy/);
  assert.equal(down.writes.some((w) => w.value.credential_state === 'revoked'), false);
  assert.equal(down.writes.some((w) => w.value.credential_state === 'revoke_pending'), true);
});

test('checkout and crons keep working before the eKey migration is applied', async () => {
  const { module } = loadEKey({
    tables: { smart_lock_ekey_grants: () => ({ data: null, error: { code: '42P01', message: 'relation "public.smart_lock_ekey_grants" does not exist' } }) },
    client: {},
  });
  await module.revokeEKeyAccessForTenancy('t');
});

test('staff freeze and unfreeze only move between active and frozen', async () => {
  const calls = [];
  const grant = { id: 'g1', device_id: 'd', tenancy_id: 't', access_scope: 'room_entry', provider_key_id: 41, receiver_username: 'u', credential_state: 'active', valid_from: '2026-01-01', valid_until: '2027-01-01' };
  const { module, writes } = loadEKey({
    tables: { smart_lock_ekey_grants: [grant] },
    client: { freezeTTLockEKey: async (id) => calls.push(['freeze', id]), unfreezeTTLockEKey: async (id) => calls.push(['unfreeze', id]) },
  });
  await module.setEKeyFrozen({ grantId: 'g1', frozen: true, performedBy: 'staff' });
  assert.deepEqual(calls, [['freeze', 41]]);
  assert.equal(writes.at(-1).value.credential_state, 'frozen');
  await assert.rejects(() => module.setEKeyFrozen({ grantId: 'g1', frozen: false, performedBy: 'staff' }), /Only a frozen eKey/);
});

test('eKeys are wired into move-in, renewal, payment, checkout and contract end', () => {
  assert.match(read('lib/tenancy/convert-application.ts'), /reconcileEKeyAndMeterForTenancy\(tenancy\.id\)/);
  assert.match(read('app/properties/[id]/actions.ts'), /reconcileEKeyAndMeterForTenancy\(tenancyId\)/);
  assert.match(read('app/properties/[id]/actions.ts'), /reconcileEKeyAndMeterForTenancy\(tenancy\.id\)/);
  assert.match(read('app/e-tenancy/actions.ts'), /reconcileEKeyAndMeterForTenancy\(agreement\.tenancy_id\)/);
  assert.match(read('app/smart-devices/actions.ts'), /reconcileEKeyAndMeterForTenancy\(tenancy\.id\)/);
  assert.match(read('lib/ttlock/payment-access.ts'), /extendEKeyAccessAfterPayment\(input\)/);
  const checkout = read('lib/tenancy/checkout.ts');
  const revokeBlock = checkout.slice(checkout.indexOf('await Promise.all(['), checkout.indexOf('return { ok: false, reason: "lock" }'));
  assert.match(revokeBlock, /revokeEKeyAccessForTenancy\(tenancy\.id/);
  assert.match(read('lib/ttlock/contract-end-cleanup.ts'), /revokeEKeyAccessForTenancy\(tenancyId, \{ reason: "contract_ended" \}\)/);
});

test('migration adds eKey grants with tenant-only RLS and is not applied by code', () => {
  const sql = read('supabase/migrations/20261123150000_ttlock_ekeys_and_meter_power.sql');
  assert.match(sql, /create table if not exists public\.smart_lock_ekey_grants/);
  assert.match(sql, /add column if not exists ttlock_username text/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /tenant_profile_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /revoke all on public\.smart_lock_ekey_grants from public, anon, authenticated/);
  assert.match(sql, /smart_lock_ekey_one_open_grant_idx/);
});
