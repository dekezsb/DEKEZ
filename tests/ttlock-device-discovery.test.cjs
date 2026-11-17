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

test('sync still discovers unknown TTLock locks as inventory inserts without baking in a room', () => {
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

test('mixed-case Bundusan aliases resolve to the matching room or main door', () => {
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

test('TTLock meters are discovered as inventory inserts and Bds aliases resolve to the matching room', () => {
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

test('Smart Devices auto-link unambiguous names and leave unclear ones for Super Admin confirmation', () => {
  const actions = fs.readFileSync(path.join(root, 'app/smart-devices/actions.ts'), 'utf8');
  assert.match(actions, /planTTLockLockSync/);
  assert.match(actions, /planTTLockMeterSync/);
  assert.match(actions, /planDiscoveredLockAutoLinks/);
  assert.match(actions, /planDiscoveredMeterAutoLinks/);
  assert.match(actions, /listTTLockElectricMeters/);
  assert.match(actions, /property_id: null/);
  assert.match(actions, /assignment_source: AUTO_ALIAS_SOURCE/);
  assert.match(actions, /is\("property_id", null\)/);
  assert.match(actions, /assignTTLockDevice/);
  assert.match(actions, /assignTTLockMeter/);
  assert.match(actions, /unassignTTLockDevice/);
  assert.match(actions, /unassignTTLockMeter/);
  assert.match(actions, /requireRole\(\["super_admin"\]/);
  const syncFn = actions.slice(actions.indexOf('export async function syncTTLockDevices()'), actions.indexOf('async function loadAssignmentOptions()'));
  assert.doesNotMatch(syncFn, /reconcileSmartLockAccessForTenancy\(/);
  assert.doesNotMatch(syncFn, /addTTLock|deleteTTLock|changeTTLock|rechargeTTLock/);
  const page = fs.readFileSync(path.join(root, 'app/smart-devices/page.tsx'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'components/smart-devices/assign-location-form.tsx'), 'utf8');
  assert.match(page, /AssignLocationForm/);
  assert.match(page, /Auto-linked/);
  assert.match(page, /UnassignLocationForm/);
  assert.match(form, /Confirm assignment/);
  assert.match(form, /Suggested/);
  assert.match(form, /Unassign/);
  assert.match(page, /Existing credential expiry still needs separate access-policy review/);
  const client = fs.readFileSync(path.join(root, 'lib/ttlock/client.ts'), 'utf8');
  assert.match(client, /\/v3\/electricMeter\/list/);
  assert.match(client, /\/v3\/electricMeter\/recharge/);
});


const moreProperties = [
  ...properties,
  { id: 'prop-hlt', name: 'Hilltop Residence', property_code: 'HLT' },
  { id: 'prop-sls', name: 'Sulaman', property_code: 'SLS' },
  { id: 'prop-bvh', name: 'Beverly Hill', property_code: 'BVH' },
];
const moreRooms = [
  ...rooms,
  { id: 'hlt-10', property_id: 'prop-hlt', room_number: 'Room 10', name: 'Room 10' },
  { id: 'hlt-1', property_id: 'prop-hlt', room_number: 'Room 1', name: 'Room 1' },
  { id: 'sls-2', property_id: 'prop-sls', room_number: 'Room 2', name: 'Room 2' },
];

test('unambiguous property codes and name words are auto-linked, including main doors', () => {
  const plan = discovery.planDiscoveredLockAutoLinks({
    devices: [
      { key: 'new-1', alias: 'Bundusan Office 1' },
      { key: 'new-3', alias: 'BDS OFFICE 3' },
      { key: 'new-4', alias: 'BUNDUSAN OFFICE 4' },
      { key: 'new-main', alias: 'BDS MAIN OFFICE' },
      { key: 'new-door', alias: 'BDS MAIN DOOR' },
      { key: 'hlt-10', alias: 'HLT 10' },
      { key: 'already', alias: 'Bundusan Office 1', property_id: 'prop-bds', room_id: 'room-5', access_scope: 'room_entry' },
    ],
    properties: moreProperties,
    rooms: moreRooms,
  });
  const byKey = Object.fromEntries(plan.linked.map((item) => [item.device.key, item.decision]));
  assert.equal(byKey['new-1'].roomId, 'room-1');
  assert.equal(byKey['new-3'].roomId, 'room-3');
  assert.equal(byKey['new-4'].roomId, 'room-4');
  assert.equal(byKey['new-main'].accessScope, 'property_entry');
  assert.equal(byKey['new-main'].roomId, null);
  assert.equal(byKey['new-door'].accessScope, 'property_entry');
  assert.equal(byKey['hlt-10'].roomId, 'hlt-10');
  assert.equal(byKey['hlt-10'].propertyId, 'prop-hlt');
  assert.equal(byKey.already, undefined);
  assert.equal(plan.linked.length, 6);
});

test('ambiguous or incomplete names stay unassigned', () => {
  const plan = discovery.planDiscoveredLockAutoLinks({
    devices: [
      { key: 'unknown', alias: 'Unknown 9' },
      { key: 'main-and-room', alias: 'BDS MAIN OFFICE 2' },
      { key: 'two-numbers', alias: 'BDS 2 4' },
      { key: 'empty', alias: '   ' },
      { key: 'code-only', alias: 'BDS OFFICE' },
      { key: 'room-only', alias: 'Room 2' },
    ],
    properties: moreProperties,
    rooms: moreRooms,
  });
  const reasons = Object.fromEntries(plan.skipped.map((item) => [item.device.key, item.reason]));
  assert.equal(plan.linked.length, 0);
  assert.equal(reasons.unknown, 'no_match');
  assert.equal(reasons['main-and-room'], 'ambiguous_main_and_room');
  assert.equal(reasons['two-numbers'], 'ambiguous_room');
  assert.equal(reasons.empty, 'no_match');
  assert.equal(reasons['code-only'], 'no_room');
  assert.equal(reasons['room-only'], 'no_match');
});

test('room 10 is not confused with room 1, and name matching is case-insensitive', () => {
  assert.equal(discovery.resolveAutoLinkFromAlias('hlt room 10', moreProperties, moreRooms).roomId, 'hlt-10');
  assert.equal(discovery.resolveAutoLinkFromAlias('Hlt Room 1', moreProperties, moreRooms).roomId, 'hlt-1');
  assert.equal(discovery.resolveAutoLinkFromAlias('bds office 2', moreProperties, moreRooms).roomId, 'room-2');
  assert.equal(discovery.resolveAutoLinkFromAlias('BEVERLY  missing', moreProperties, moreRooms).ok, false);
});

test('two properties sharing a name word stay unassigned', () => {
  const properties = [
    { id: 'a', name: 'Sunrise Court', property_code: 'AAA' },
    { id: 'b', name: 'Sunrise Villa', property_code: 'BBB' },
  ];
  const rooms = [
    { id: 'a-1', property_id: 'a', room_number: 'Room 1', name: 'Room 1' },
    { id: 'b-1', property_id: 'b', room_number: 'Room 1', name: 'Room 1' },
  ];
  const decision = discovery.resolveAutoLinkFromAlias('Sunrise 1', properties, rooms);
  assert.deepEqual(decision, { ok: false, reason: 'ambiguous_property' });
  assert.equal(discovery.resolveAutoLinkFromAlias('AAA 1', properties, rooms).roomId, 'a-1');
});

test('meters auto-link by name but never overwrite an assignment or share a room', () => {
  const plan = discovery.planDiscoveredMeterAutoLinks({
    meters: [
      { key: 'm2', alias: 'BDS 2' },
      { key: 'm4', alias: 'Bds 4' },
      { key: 'm5', alias: 'Bds 5' },
      { key: 'kept', alias: 'BDS 2', property_id: 'prop-bds', room_id: 'room-2' },
      { key: 'dup-a', alias: 'SLS 2' },
      { key: 'dup-b', alias: 'Sulaman 2' },
      { key: 'taken', alias: 'HLT 1' },
    ],
    properties: moreProperties,
    rooms: moreRooms,
    occupiedRoomIds: ['hlt-1'],
  });
  const linked = Object.fromEntries(plan.linked.map((item) => [item.device.key, item.decision.roomId]));
  const skipped = Object.fromEntries(plan.skipped.map((item) => [item.device.key, item.reason]));
  assert.equal(linked.m2, 'room-2');
  assert.equal(linked.m4, 'room-4');
  assert.equal(linked.m5, 'room-5');
  assert.equal(linked.kept, undefined);
  assert.equal(skipped['dup-a'], 'meter_room_conflict');
  assert.equal(skipped['dup-b'], 'meter_room_conflict');
  assert.equal(skipped.taken, 'meter_room_occupied');
});

test('lock inventory updates never carry a new property or room, so existing assignments stay put', () => {
  const plan = discovery.planTTLockLockSync({
    existing: [
      { id: 'lock-2', onboarding_key: 'bds-office-2', provider_lock_id: 22, sync_status: 'connected' },
    ],
    live: [{ lockId: 22, lockAlias: 'BDS OFFICE 2' }],
  });
  assert.equal(plan.updates.length, 1);
  assert.ok(!('property_id' in plan.updates[0]));
  const actions = fs.readFileSync(path.join(root, 'app/smart-devices/actions.ts'), 'utf8');
  const updateBlock = actions.slice(actions.indexOf('for (const update of lockPlan.updates)'), actions.indexOf('for (const missing of lockPlan.missing)'));
  assert.match(updateBlock, /lockPayload/);
  assert.doesNotMatch(updateBlock, /property_id:/);
  assert.doesNotMatch(updateBlock, /room_id:/);
  assert.doesNotMatch(updateBlock, /assignment_source/);
});
