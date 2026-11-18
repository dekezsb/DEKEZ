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
};

const {
  fingerprintValidityPeriod,
} = require('../lib/ttlock/fingerprint-period.ts');
const {
  hasFingerprintEnrollmentAccess,
  lockSupportsFingerprint,
  fingerprintStatusLabel,
} = require('../lib/ttlock/fingerprint-support.ts');

const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

test('BDS-style specialValue bit 2 means the lock has a fingerprint reader', () => {
  assert.equal(lockSupportsFingerprint(634188279), true);
  assert.equal(lockSupportsFingerprint(1967976951), true);
  assert.equal(lockSupportsFingerprint(0), false);
  assert.equal(lockSupportsFingerprint(null), false);
  assert.equal(hasFingerprintEnrollmentAccess([
    { access_scope: 'room_entry', sync_status: 'connected', provider: 'ttlock', specialValue: 634188279 },
  ]), true);
  assert.equal(hasFingerprintEnrollmentAccess([
    { access_scope: 'property_entry', sync_status: 'connected', provider: 'ttlock', specialValue: 1967976951 },
  ]), false);
  assert.equal(hasFingerprintEnrollmentAccess([
    { access_scope: 'room_entry', sync_status: 'connected', provider: 'ttlock', specialValue: 1 },
  ]), false);
});

test('fingerprint status labels are Requested, Active and Revoked', () => {
  assert.equal(fingerprintStatusLabel('pending_enrollment'), 'Requested');
  assert.equal(fingerprintStatusLabel('active'), 'Active');
  assert.equal(fingerprintStatusLabel('revoked'), 'Revoked');
});

test('a timed fingerprint runs to 23:59:59 MYT on the contract end date', () => {
  const now = new Date('2026-11-18T10:00:00+08:00');
  const untilContract = fingerprintValidityPeriod({
    now,
    tenancy: { contract_end: '2026-12-14' },
  });
  assert.equal(untilContract.validUntil.toISOString(), new Date('2026-12-14T23:59:59+08:00').toISOString());
  assert.equal(untilContract.unchanged, false);

  const fromTenancyEnd = fingerprintValidityPeriod({
    now,
    currentUntil: '2026-12-18T15:59:59.000Z',
    tenancy: { tenancy_end_date: '2027-06-30', contract_end: '2026-12-14' },
  });
  assert.equal(fromTenancyEnd.validUntil.toISOString(), new Date('2027-06-30T23:59:59+08:00').toISOString());

  const alreadySet = fingerprintValidityPeriod({
    now,
    currentUntil: '2026-12-14T15:59:59.000Z',
    tenancy: { end_date: '2026-12-14' },
  });
  assert.equal(alreadySet.unchanged, true);

  assert.throws(
    () => fingerprintValidityPeriod({
      now: new Date('2026-12-15T00:00:00+08:00'),
      tenancy: { contract_end: '2026-12-14' },
    }),
    /already ended/,
  );
});

test('the portal can request a fingerprint and never shows a passcode in that box', () => {
  const portal = read('components/tenant/tenant-portal.tsx');
  const box = read('components/tenant/fingerprint-access.tsx');
  const actions = read('app/tenant/fingerprint-actions.ts');
  const data = read('lib/data/tenant-portal.ts');
  assert.match(portal, /TenantFingerprintAccess/);
  assert.match(portal, /tenancy\.canRequestFingerprint/);
  assert.match(box, /Request fingerprint/);
  assert.match(box, /requestTenantFingerprint/);
  assert.doesNotMatch(box, /keyboard_password|passcode|Passcode/);
  assert.match(actions, /prepareFingerprintEnrollment/);
  assert.match(actions, /ignoreNotificationError: true/);
  assert.match(data, /hasFingerprintEnrollmentAccess/);
  assert.match(data, /smart_lock_fingerprint_grants/);
});

test('staff see pending requests and enrol at the lock over Bluetooth', () => {
  const page = read('app/smart-devices/page.tsx');
  assert.match(page, /Pending fingerprint requests/);
  assert.match(page, /over Bluetooth/);
  assert.match(page, /gateway cannot add a fingerprint/i);
  assert.match(page, /Valid until contract end/);
  assert.doesNotMatch(page, /another 30-day cycle/);
});

test('hourly match, checkout and contract-end cleanup stay in place, and renewal extends fingerprints', () => {
  assert.match(read('app/api/rent-reminders/route.ts'), /syncFingerprintEnrollments/);
  assert.match(read('lib/tenancy/checkout.ts'), /revokeFingerprintAccessForTenancy\(tenancy\.id/);
  assert.match(read('lib/ttlock/contract-end-cleanup.ts'), /revokeFingerprintAccessForTenancy/);
  assert.match(read('app/e-tenancy/actions.ts'), /reconcileFingerprintAccessForTenancy\(agreement\.tenancy_id\)/);
  assert.match(read('app/properties/[id]/actions.ts'), /reconcileFingerprintAccessForTenancy\(tenancyId\)/);
  const sync = read('lib/ttlock/fingerprint.ts');
  assert.match(sync, /listTTLockFingerprints/);
  assert.match(sync, /changeTTLockFingerprintPeriod/);
  assert.match(read('lib/ttlock/client.ts'), /changeType: "2"/);
});
