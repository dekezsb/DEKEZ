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
  compareSmartLockDevices,
  compareSmartMeters,
  failedGrantsToShow,
  roomSortNumber,
} = require('../lib/ttlock/device-list-sort.ts');

const bds = { name: 'BDS - BUNDUSAN', property_code: 'BDS' };
const hlt = { name: 'Hilltop Residence', property_code: 'HLT' };
const room = (n) => ({ name: `Room ${n}`, room_number: `Room ${n}` });

test('room numbers sort naturally, so room 10 comes after room 2', () => {
  assert.equal(roomSortNumber(room(10)), 10);
  assert.equal(roomSortNumber({ name: 'Office 4', room_number: null }), 4);
});

test('locks sort by property, then main entrance, then room number, then name', () => {
  const locks = [
    { id: '4', provider_lock_name: 'BUNDUSAN OFFICE 4', access_scope: 'room_entry', property_id: 'bds', room_id: 'r4', properties: bds, rooms: room(4) },
    { id: '6', provider_lock_name: 'BDS OFFICE 6', access_scope: 'room_entry', property_id: 'bds', room_id: 'r6', properties: bds, rooms: room(6) },
    { id: '1', provider_lock_name: 'Bundusan Office 1', access_scope: 'room_entry', property_id: 'bds', room_id: 'r1', properties: bds, rooms: room(1) },
    { id: '10', provider_lock_name: 'HLT 10', access_scope: 'room_entry', property_id: 'hlt', room_id: 'h10', properties: hlt, rooms: room(10) },
    { id: 'main', provider_lock_name: 'BDS MAIN OFFICE', access_scope: 'property_entry', property_id: 'bds', room_id: null, properties: bds, rooms: null },
    { id: 'unassigned', provider_lock_name: 'New Lock', access_scope: 'room_entry', property_id: null, room_id: null, properties: null, rooms: null },
    { id: '2', provider_lock_name: 'BDS OFFICE 2', access_scope: 'room_entry', property_id: 'bds', room_id: 'r2', properties: bds, rooms: room(2) },
  ].sort(compareSmartLockDevices);
  assert.deepEqual(locks.map((lock) => lock.id), ['unassigned', 'main', '1', '2', '4', '6', '10']);
});

test('meters sort by property, then room number, then name', () => {
  const meters = [
    { id: '5', meter_number: 'Bds 5', property_id: 'bds', room_id: 'r5', properties: bds, rooms: room(5) },
    { id: '2', meter_number: 'BDS 2', property_id: 'bds', room_id: 'r2', properties: bds, rooms: room(2) },
    { id: 'open', meter_number: 'New meter', property_id: null, room_id: null, properties: null, rooms: null },
    { id: 'h1', meter_number: 'HLT 1', property_id: 'hlt', room_id: 'h1', properties: hlt, rooms: room(1) },
  ].sort(compareSmartMeters);
  assert.deepEqual(meters.map((meter) => meter.id), ['open', '2', '5', 'h1']);
});

test('a failed grant is hidden once the same tenancy has an active code on that lock', () => {
  const shown = failedGrantsToShow([
    { tenancy_id: 't6', credential_state: 'error' },
    { tenancy_id: 't6', credential_state: 'active' },
    { tenancy_id: 't4', credential_state: 'error' },
  ]);
  assert.deepEqual(shown.map((grant) => grant.tenancy_id), ['t4']);
});

test('Smart Devices uses the sorted lists and shows failed provision errors on the lock card', () => {
  const page = fs.readFileSync(path.join(root, 'app/smart-devices/page.tsx'), 'utf8');
  assert.match(page, /compareSmartLockDevices/);
  assert.match(page, /compareSmartMeters/);
  assert.match(page, /failedGrantsToShow/);
  assert.match(page, /Failed passcode attempt/);
  assert.match(page, /credential_state", \["active", "pending_generation", "revoke_pending", "error"\]/);
  const access = fs.readFileSync(path.join(root, 'lib/ttlock/access.ts'), 'utf8');
  assert.match(access, /async function recordFailedProvision/);
  assert.match(access, /credential_state: "error"/);
  assert.match(access, /does not support V4 passcodes/);
});
