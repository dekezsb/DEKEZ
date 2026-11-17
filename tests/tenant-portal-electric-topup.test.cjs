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
  DEFAULT_ELECTRICITY_RM_PER_KWH,
  electricityTopUpStatusLabel,
  hasElectricityTopUpAccess,
  isTTLockElectricityMeter,
  isValidElectricityTopUpAmount,
  formatKwhEstimate,
  kwhEstimateForTopUp,
} = require('../lib/smart-meter/top-up-access.ts');

const portalSource = fs.readFileSync(path.join(root, 'components/tenant/tenant-portal.tsx'), 'utf8');
const actionsSource = fs.readFileSync(path.join(root, 'app/smart-meter-top-up/actions.ts'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'lib/data/electricity-top-up-admin.ts'), 'utf8');
const verifySource = fs.readFileSync(path.join(root, 'app/verification/page.tsx'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'components/smart-meter/electricity-top-up-pilot.tsx'), 'utf8');

test('top-up box is only for a linked TTLock meter, including future auto-linked rooms', () => {
  assert.equal(isTTLockElectricityMeter('ttlock'), true);
  assert.equal(isTTLockElectricityMeter('CNYIOT'), false);
  assert.equal(hasElectricityTopUpAccess({ hasElectricityMeter: true, provider: 'ttlock' }), true);
  assert.equal(hasElectricityTopUpAccess({ hasElectricityMeter: true, provider: 'cnyiot' }), false);
  assert.equal(hasElectricityTopUpAccess({ hasElectricityMeter: false, provider: null }), false);
  assert.equal(hasElectricityTopUpAccess({ hasElectricityMeter: true, provider: null }), false);
  assert.match(portalSource, /hasElectricityTopUpAccess\(\{\s*provider: tenancy\.electricityMeter\?\.provider/);
  assert.match(actionsSource, /\.eq\("provider", "ttlock"\)/);
  assert.match(adminSource, /\.eq\("provider", "ttlock"\)/);
});

test('Hilltop or Beverly Hill without a TTLock meter do not get the new portal box', () => {
  assert.equal(hasElectricityTopUpAccess({
    hasElectricityMeter: false,
    provider: null,
  }), false);
  assert.doesNotMatch(portalSource, /hasTenantElectricityTopUpAccess\(/);
});

test('amount must be a whole Ringgit between the minimum and maximum', () => {
  assert.equal(isValidElectricityTopUpAmount(10), true);
  assert.equal(isValidElectricityTopUpAmount(500), true);
  assert.equal(isValidElectricityTopUpAmount(9), false);
  assert.equal(isValidElectricityTopUpAmount(501), false);
  assert.equal(isValidElectricityTopUpAmount(50.5), false);
  assert.match(actionsSource, /isValidElectricityTopUpAmount\(amount\)/);
});

test('kWh estimate uses RM0.57 unless a meter rate is supplied', () => {
  assert.equal(DEFAULT_ELECTRICITY_RM_PER_KWH, 0.57);
  assert.equal(kwhEstimateForTopUp(57, 0.57), 100);
  assert.equal(kwhEstimateForTopUp(50, 0.57), 87.719);
  assert.equal(formatKwhEstimate(kwhEstimateForTopUp(50, 0.57)), '87.72');
  assert.match(uiSource, /Estimated credit/);
  assert.match(uiSource, /formatKwhEstimate\(estimatedKwh\)/);
});

test('tenant portal top-up box does not show the per-kWh rate', () => {
  assert.doesNotMatch(uiSource, /money\.format\(rmPerKwh\)/);
  assert.doesNotMatch(uiSource, /per kWh/);
  assert.doesNotMatch(uiSource, /\/kWh/);
  assert.doesNotMatch(uiSource, /0\.57/);
  assert.match(portalSource, /rmPerKwh=\{resolveElectricityRmPerKwh/);
});

test('history statuses are shown as pending, verified, or rejected', () => {
  assert.equal(electricityTopUpStatusLabel('pending_verification'), 'Pending');
  assert.equal(electricityTopUpStatusLabel('approved_awaiting_top_up'), 'Verified');
  assert.equal(electricityTopUpStatusLabel('credited'), 'Verified');
  assert.equal(electricityTopUpStatusLabel('rejected'), 'Rejected');
  assert.match(uiSource, /Top-up history/);
});

test('submissions reuse the existing slip bucket and land on the admin verification page', () => {
  assert.match(actionsSource, /\.from\("smart-meter-top-up-slips"\)/);
  assert.match(actionsSource, /status: "pending_verification"/);
  assert.match(actionsSource, /revalidatePath\("\/verification"\)/);
  assert.match(verifySource, /\.from\("smart_meter_top_up_requests"\)/);
  assert.doesNotMatch(
    verifySource.slice(
      verifySource.indexOf('.from("smart_meter_top_up_requests")'),
      verifySource.indexOf('.from("smart_meter_top_up_requests")') + 800,
    ),
    /\.eq\("property/,
  );
});

test('portal card does not describe a CNYIOT manual top-up path', () => {
  assert.doesNotMatch(uiSource, /cnyiot/i);
  assert.doesNotMatch(uiSource, /manual top-up/i);
  assert.match(uiSource, /TTLock meter is topped up automatically/);
  assert.match(uiSource, /monthly bill/);
});
