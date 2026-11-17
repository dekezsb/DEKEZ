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

const {
  compareRoomLocks,
  locksForRoom,
  summarizeActiveCodes,
  topUpSource,
} = require('../lib/data/room-smart-devices-view.ts');

const pageSource = fs.readFileSync(path.join(root, 'app/properties/[id]/rooms/[roomId]/page.tsx'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'lib/data/room-smart-devices.ts'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'app/properties/[id]/rooms/[roomId]/room-smart-devices.tsx'), 'utf8');

test('room page loads Smart Devices after staff role check, including vacant rooms', () => {
  assert.match(pageSource, /requireRole\(\["super_admin", "owner", "admin"\]\)/);
  assert.match(pageSource, /getRoomSmartDevices\(id, roomId\)/);
  assert.match(pageSource, /<RoomSmartDevicesCard devices=\{smartDevices\} \/>/);
  assert.doesNotMatch(pageSource, /Tenant Smart Meter Usage/);
});

test('loader reads the same smart_meters.room_id links used by TTLock and CNYIOT, without a provider filter', () => {
  assert.match(loaderSource, /\.from\("smart_meters"\)/);
  assert.match(loaderSource, /\.eq\("room_id", roomId\)/);
  const metersBlock = loaderSource.slice(
    loaderSource.indexOf('.from("smart_meters")'),
    loaderSource.indexOf('.from("smart_lock_devices")'),
  );
  assert.doesNotMatch(metersBlock, /\.eq\("provider"/);
  assert.match(metersBlock, /id,provider,meter_number/);
  assert.match(loaderSource, /metersResult\.error/);
});

test('loader never selects passcodes or keyboard passwords', () => {
  for (const source of [loaderSource, uiSource, pageSource]) {
    assert.doesNotMatch(source, /keyboard_password/);
    assert.doesNotMatch(source, /keyboardPwd/);
    assert.doesNotMatch(source, /passcode/);
  }
  assert.match(loaderSource, /select\("id,device_id,credential_state,valid_until"\)|GRANT_COLUMNS = "id,device_id,credential_state,valid_until"/);
});

test('locksForRoom keeps the main entrance and the matching room lock, even when vacant', () => {
  const room1 = 'room-1';
  const room2 = 'room-2';
  const devices = [
    { id: 'main', access_scope: 'property_entry', room_id: null, name: 'MAIN' },
    { id: 'r1', access_scope: 'room_entry', room_id: room1, name: 'OFFICE 1' },
    { id: 'r2', access_scope: 'room_entry', room_id: room2, name: 'OFFICE 2' },
  ];
  const vacant = locksForRoom(devices, room1);
  assert.deepEqual(vacant.map((device) => device.id).sort(), ['main', 'r1']);
  assert.equal(locksForRoom(devices, 'vacant-without-lock').map((device) => device.id).join(), 'main');
});

test('active code summary counts only active grants and uses the latest valid-until', () => {
  const grants = [
    { device_id: 'lock-a', credential_state: 'active', valid_until: '2026-06-30T15:59:59.000Z' },
    { device_id: 'lock-a', credential_state: 'active', valid_until: '2026-12-14T15:59:59.000Z' },
    { device_id: 'lock-a', credential_state: 'revoked', valid_until: '2027-01-01T15:59:59.000Z' },
    { device_id: 'lock-b', credential_state: 'active', valid_until: '2026-12-31T15:59:59.000Z' },
  ];
  assert.deepEqual(summarizeActiveCodes(grants, 'lock-a'), {
    activeCodeCount: 2,
    validUntil: '2026-12-14T15:59:59.000Z',
  });
  assert.deepEqual(summarizeActiveCodes(grants, 'empty'), {
    activeCodeCount: 0,
    validUntil: null,
  });
});

test('credited TTLock recharges are labelled separately from verified slips', () => {
  assert.equal(topUpSource({ provider_reference: 'recharge-1', credited_at: '2026-11-17T10:00:00.000Z' }), 'ttlock_recharge');
  assert.equal(topUpSource({ provider_reference: null, credited_at: '2026-11-17T10:00:00.000Z' }), 'verified_slip');
  assert.equal(topUpSource({ provider_reference: 'pending', credited_at: null }), 'verified_slip');
});

test('main entrance lock is listed before the room lock', () => {
  const ordered = [
    { accessScope: 'room_entry', name: 'BDS OFFICE 2' },
    { accessScope: 'property_entry', name: 'BDS MAIN OFFICE' },
  ].sort(compareRoomLocks);
  assert.equal(ordered[0].accessScope, 'property_entry');
});

test('room Smart Devices card shows meter reading, remaining, status, top-ups, and lock fields', () => {
  assert.match(uiSource, /Latest reading/);
  assert.match(uiSource, /Remaining balance/);
  assert.match(uiSource, /Last sync/);
  assert.match(uiSource, /Top-up history/);
  assert.match(uiSource, /TTLock recharge/);
  assert.match(uiSource, /Verified slip/);
  assert.match(uiSource, /Property main entrance/);
  assert.match(uiSource, /Room lock/);
  assert.match(uiSource, /Battery/);
  assert.match(uiSource, /Gateway/);
  assert.match(uiSource, /Active codes/);
  assert.match(uiSource, /Shown even when the room is vacant/);
  assert.match(uiSource, /No smart meter is assigned to this room/);
});
