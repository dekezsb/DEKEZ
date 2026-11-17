const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const discovery = require('../lib/ttlock/device-discovery.ts');
const properties = [{ id: 'prop-bds', name: 'Bundusan Square', property_code: 'BDS' }];
const rooms = [
  { id: 'room-1', property_id: 'prop-bds', room_number: 'Room 1', name: 'Room 1' },
  { id: 'room-2', property_id: 'prop-bds', room_number: 'Room 2', name: 'Room 2' },
  { id: 'room-3', property_id: 'prop-bds', room_number: 'Room 3', name: 'Room 3' },
  { id: 'room-4', property_id: 'prop-bds', room_number: 'Room 4', name: 'Room 4' },
  { id: 'room-5', property_id: 'prop-bds', room_number: 'Room 5', name: 'Room 5' },
];

test('sync discovers unknown TTLock locks as unassigned and never auto-assigns them', () => {
  const existing = [
    { id: 'lock-2', onboarding_key: 'bds-office-2', provider_lock_id: 22, sync_status: 'connected' },
    { id: 'lock-main', onboarding_key: 'bds-main-office', provider_lock_id: 11, sync_status: 'connected' },
  ];
  const live = [
    { lockId: 22, lockAlias: 'BDS OFFICE 2' },
    { lockId: 11, lockAlias: 'BDS MAIN OFFICE' },
    { lockId: 101, lockAlias: 'Bundusan Office 1' },
    { lockId: 103, lockAlias: 'BDS OFFICE 3' },
    { lockId: 104, lockAlias: 'BUNDUSAN OFFICE 4' },
  ];
  const plan = discovery.planTTLockLockSync({ existing, live });
  assert.equal(plan.updates.length, 2);
  assert.equal(plan.inserts.length, 3);
  assert.deepEqual(plan.inserts.map((item) => item.provider_lock_name).sort(), [
    'BDS OFFICE 3',
    'BUNDUSAN OFFICE 4',
    'Bundusan Office 1',
  ]);
  assert.ok(plan.inserts.every((item) => !('property_id' in item) || item.property_id == null));
});

test('mixed-case Bundusan aliases only suggest a room, they are not applied automatically', () => {
  const one = discovery.suggestAssignmentFromAlias('Bundusan Office 1', properties, rooms, { allowMainDoor: true });
  const three = discovery.suggestAssignmentFromAlias('BDS OFFICE 3', properties, rooms, { allowMainDoor: true });
  const four = discovery.suggestAssignmentFromAlias('BUNDUSAN OFFICE 4', properties, rooms, { allowMainDoor: true });
  const main = discovery.suggestAssignmentFromAlias('BDS MAIN OFFICE', properties, rooms, { allowMainDoor: true });
  assert.equal(one?.roomId, 'room-1');
  assert.equal(three?.roomId, 'room-3');
  assert.equal(four?.roomId, 'room-4');
  assert.equal(main?.accessScope, 'property_entry');
  assert.equal(main?.roomId, null);
  assert.equal(discovery.suggestAssignmentFromAlias('Unknown 9', properties, rooms), null);
});

test('TTLock meters are discovered unassigned and Bds aliases suggest the matching room', () => {
  const plan = discovery.planTTLockMeterSync({
    existing: [{ id: 'm-old', provider: 'cnyiot', provider_meter_id: '18201009497' }],
    live: [
      { electricMeterId: 501, name: 'BDS 2', remainderKwh: '12.5', totalKwh: '80.1', online: 1, onOff: 1, payMode: 1 },
      { electricMeterId: 504, name: 'Bds 4', remainderKwh: '3.2', totalKwh: '40', online: 1, onOff: 1, payMode: 1 },
      { electricMeterId: 505, name: 'Bds 5', remainderKwh: '9.0', totalKwh: '22', online: 1, onOff: 1, payMode: 1 },
    ],
  });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.inserts.length, 3);
  assert.equal(discovery.suggestAssignmentFromAlias('BDS 2', properties, rooms)?.roomId, 'room-2');
  assert.equal(discovery.suggestAssignmentFromAlias('Bds 4', properties, rooms)?.roomId, 'room-4');
  assert.equal(discovery.suggestAssignmentFromAlias('Bds 5', properties, rooms)?.roomId, 'room-5');
});

test('assignment validation requires a Super Admin confirmation payload and rejects a mismatched room', () => {
  const ok = discovery.validateAssignment({
    propertyId: 'prop-bds',
    roomId: 'room-4',
    accessScope: 'room_entry',
    properties,
    rooms,
    requireRoom: true,
  });
  assert.equal(ok.ok, true);
  const bad = discovery.validateAssignment({
    propertyId: 'prop-bds',
    roomId: 'room-other',
    accessScope: 'room_entry',
    properties,
    rooms,
    requireRoom: true,
  });
  assert.equal(bad.ok, false);
});

test('auto-recharge needs a mapped prepaid TTLock meter and a configured RM-per-kWh rate', () => {
  assert.equal(discovery.readRmPerKwh(undefined), null);
  assert.equal(discovery.readRmPerKwh(''), null);
  assert.equal(discovery.readRmPerKwh('0'), null);
  assert.equal(discovery.kwhFromPaidAmount(50, 0.5), 100);
  assert.equal(
    discovery.canAutoRechargeTTLockMeter({
      provider: 'ttlock',
      providerMeterId: '504',
      roomId: 'room-4',
      payMode: 1,
      rmPerKwh: null,
      amount: 50,
    }).ok,
    false,
  );
  assert.equal(
    discovery.canAutoRechargeTTLockMeter({
      provider: 'cnyiot',
      providerMeterId: '18201009497',
      roomId: 'room-4',
      rmPerKwh: 0.57,
      amount: 50,
    }).reason,
    'not_ttlock',
  );
  const ready = discovery.canAutoRechargeTTLockMeter({
    provider: 'ttlock',
    providerMeterId: '504',
    roomId: 'room-4',
    payMode: 1,
    rmPerKwh: 0.5,
    amount: 50,
  });
  assert.deepEqual(ready, { ok: true, kwh: 100 });
});

test('verified top-up auto-recharge is idempotent and does not credit older approved slips automatically', async () => {
  const recharges = [];
  const rpcCalls = [];
  const requests = {
    'new-1': { id: 'new-1', status: 'approved_awaiting_top_up', amount: 50, room_id: 'room-4', meter_id: 'meter-4', provider_reference: null },
    'old-1': { id: 'old-1', status: 'approved_awaiting_top_up', amount: 40, room_id: 'room-4', meter_id: 'meter-4', provider_reference: null },
  };
  const meter = {
    id: 'meter-4',
    provider: 'ttlock',
    provider_meter_id: '504',
    room_id: 'room-4',
    provider_metadata: { payMode: 1 },
  };
  const admin = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async () => ({
          data: table === 'smart_meter_top_up_requests' ? currentRequest : meter,
          error: null,
        }),
        update() { return { eq() { return { eq() { return { is: async () => ({ error: null }) }; } }; } }; },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: { id: args.request_id }, error: null };
    },
  };
  let currentRequest = requests['new-1'];
  const originalRate = process.env.TTLOCK_ELECTRICITY_RM_PER_KWH;
  process.env.TTLOCK_ELECTRICITY_RM_PER_KWH = '0.5';
  const loader = require('./marketplace-component-loader.cjs');
  try {
    const module = loader({
      'server-only': {},
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/ttlock/client': {
        rechargeTTLockElectricMeter: async (input) => { recharges.push(input); },
        syncTTLockElectricMeterState: async () => {},
      },
    })('lib/ttlock/meter-recharge.ts');

    const first = await module.tryAutoRechargeTTLockTopUp({ requestId: 'new-1', performedBy: 'staff' });
    assert.equal(first.credited, true);
    assert.equal(recharges.length, 1);
    assert.equal(recharges[0].rechargeKwh, 100);
    assert.equal(rpcCalls[0].args.external_reference, 'ttlock-recharge:new-1');

    requests['new-1'].provider_reference = 'ttlock-recharge:new-1';
    const again = await module.tryAutoRechargeTTLockTopUp({ requestId: 'new-1', performedBy: 'staff' });
    assert.equal(again.credited, false);
    assert.equal(again.reason, 'already_referenced');
    assert.equal(recharges.length, 1);

    delete process.env.TTLOCK_ELECTRICITY_RM_PER_KWH;
    currentRequest = requests['old-1'];
    const skipped = await module.tryAutoRechargeTTLockTopUp({ requestId: 'old-1', performedBy: 'staff' });
    assert.equal(skipped.attempted, false);
    assert.equal(skipped.reason, 'rate_unset');
    assert.equal(recharges.length, 1);
  } finally {
    if (originalRate === undefined) delete process.env.TTLOCK_ELECTRICITY_RM_PER_KWH;
    else process.env.TTLOCK_ELECTRICITY_RM_PER_KWH = originalRate;
  }

  const review = fs.readFileSync(path.join(root, 'app/verification/actions.ts'), 'utf8');
  assert.match(review, /tryAutoRechargeTTLockTopUp/);
  assert.match(review, /decision === "approved"/);
  assert.doesNotMatch(review, /approved_awaiting_top_up[\s\S]*from\("smart_meter_top_up_requests"\)[\s\S]*tryAutoRechargeTTLockTopUp/);
});

test('Smart Devices sync and assignment stay behind Super Admin confirmation', () => {
  const actions = fs.readFileSync(path.join(root, 'app/smart-devices/actions.ts'), 'utf8');
  assert.match(actions, /planTTLockLockSync/);
  assert.match(actions, /planTTLockMeterSync/);
  assert.match(actions, /listTTLockElectricMeters/);
  assert.match(actions, /property_id: null/);
  assert.match(actions, /assignTTLockDevice/);
  assert.match(actions, /assignTTLockMeter/);
  assert.match(actions, /requireRole\(\["super_admin"\]/);
  const page = fs.readFileSync(path.join(root, 'app/smart-devices/page.tsx'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'components/smart-devices/assign-location-form.tsx'), 'utf8');
  assert.match(page, /AssignLocationForm/);
  assert.match(form, /Confirm assignment/);
  assert.match(form, /Suggested/);
  assert.match(page, /Existing credential expiry still needs separate access-policy review/);
  const client = fs.readFileSync(path.join(root, 'lib/ttlock/client.ts'), 'utf8');
  assert.match(client, /\/v3\/electricMeter\/list/);
  assert.match(client, /\/v3\/electricMeter\/recharge/);
});
