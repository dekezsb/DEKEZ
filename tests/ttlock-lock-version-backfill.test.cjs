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
  needsLockDetail,
  readKeyboardPwdVersion,
  pickSafeLockDetail,
  applyLockDetailToLive,
  applyLockDetailToProviderData,
  fillMissingLockVersions,
} = require('../lib/ttlock/lock-version.ts');
const discovery = require('../lib/ttlock/device-discovery.ts');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

test('missing or invalid keyboardPwdVersion needs a lock-detail fetch', () => {
  assert.equal(needsLockDetail(null), true);
  assert.equal(needsLockDetail(undefined), true);
  assert.equal(needsLockDetail(''), true);
  assert.equal(needsLockDetail(0), true);
  assert.equal(needsLockDetail(4), false);
  assert.equal(readKeyboardPwdVersion({ keyboardPwdVersion: 4 }), 4);
  assert.equal(readKeyboardPwdVersion({ keyboardPasswordVersion: 4 }), 4);
  assert.equal(readKeyboardPwdVersion({ keyboardPwdVersion: null }), null);
});

test('lock detail keeps only safe fields and drops admin secrets', () => {
  const safe = pickSafeLockDetail({
    lockId: 34583721,
    lockAlias: 'BUNDUSAN OFFICE 4',
    keyboardPwdVersion: 4,
    specialValue: 1967976951,
    hasGateway: 1,
    electricQuantity: 100,
    noKeyPwd: '7780189',
    adminPwd: 'secret-admin',
    lockKey: 'secret-key',
    aesKeyStr: 'secret-aes',
    deletePwd: '1234',
  });
  assert.equal(safe.lockId, 34583721);
  assert.equal(safe.keyboardPwdVersion, 4);
  assert.equal(safe.hasGateway, 1);
  assert.equal(safe.specialValue, 1967976951);
  assert.equal('noKeyPwd' in safe, false);
  assert.equal('adminPwd' in safe, false);
  assert.equal('lockKey' in safe, false);
  assert.equal('aesKeyStr' in safe, false);
  assert.equal('deletePwd' in safe, false);
});

test('fillMissingLockVersions fetches detail only when the list omits the version', async () => {
  const fetched = [];
  const locks = await fillMissingLockVersions(
    [
      { lockId: 1, keyboardPwdVersion: 4, specialValue: 9 },
      { lockId: 2, keyboardPwdVersion: null },
      { lockId: 3 },
    ],
    async (lockId) => {
      fetched.push(lockId);
      if (lockId === 3) throw new Error('temporary detail failure');
      return {
        lockId,
        keyboardPwdVersion: 4,
        specialValue: 11,
        hasGateway: 1,
        electricQuantity: 80,
      };
    },
  );
  assert.deepEqual(fetched, [2, 3]);
  assert.equal(locks[0].keyboardPwdVersion, 4);
  assert.equal(locks[0].specialValue, 9);
  assert.equal(locks[1].keyboardPwdVersion, 4);
  assert.equal(locks[1].specialValue, 11);
  assert.equal(locks[1].hasGateway, 1);
  assert.equal(locks[2].keyboardPwdVersion, undefined);
});

test('provider data stores the fetched version without wiping earlier fields', () => {
  const merged = applyLockDetailToProviderData(
    { source: 'ttlock_account_inventory', liveData: true },
    { lockId: 22, keyboardPwdVersion: 4, specialValue: 7 },
  );
  assert.equal(merged.keyboardPasswordVersion, 4);
  assert.equal(merged.specialValue, 7);
  assert.equal(merged.source, 'ttlock_account_inventory');
  const kept = applyLockDetailToLive(
    { lockId: 22, keyboardPwdVersion: 4, specialValue: 3 },
    { lockId: 22, keyboardPwdVersion: 3, specialValue: 9 },
  );
  assert.equal(kept.keyboardPwdVersion, 4);
  assert.equal(kept.specialValue, 3);
});

test('new lock inventory keeps the version so Sync can store it on first import', () => {
  const plan = discovery.planTTLockLockSync({
    existing: [],
    live: [{ lockId: 104, lockAlias: 'BUNDUSAN OFFICE 4', keyboardPwdVersion: 4, specialValue: 88, hasGateway: 1 }],
  });
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].keyboardPwdVersion, 4);
  assert.equal(plan.inserts[0].specialValue, 88);
});

test('Sync and provision fetch /v3/lock/detail when the stored version is missing, and never write to TTLock during Sync', () => {
  const client = read('lib/ttlock/client.ts');
  assert.match(client, /export async function getTTLockLockDetail/);
  assert.match(client, /\/v3\/lock\/detail/);
  assert.match(client, /pickSafeLockDetail/);

  const actions = read('app/smart-devices/actions.ts');
  assert.match(actions, /existingProviderData\?\.keyboardPasswordVersion/);
  const syncFn = actions.slice(
    actions.indexOf('export async function syncTTLockDevices()'),
    actions.indexOf('async function loadAssignmentOptions()'),
  );
  assert.match(syncFn, /fillMissingLockVersions/);
  assert.match(syncFn, /getTTLockLockDetail/);
  assert.match(syncFn, /keyboardPwdVersion: insert\.keyboardPwdVersion/);
  assert.doesNotMatch(syncFn, /addTTLock|deleteTTLock|changeTTLock|rechargeTTLock/);

  const access = read('lib/ttlock/access.ts');
  assert.match(access, /storedOrFetchedPasscodeVersion/);
  assert.match(access, /getTTLockLockDetail/);
  assert.match(access, /applyLockDetailToProviderData/);
  const helper = access.slice(
    access.indexOf('async function storedOrFetchedPasscodeVersion'),
    access.indexOf('async function provisionDevice'),
  );
  assert.match(helper, /if \(stored != null\) return stored/);
  assert.match(helper, /from\("smart_lock_devices"\)/);
  assert.doesNotMatch(helper, /addTTLockPasscode|changeTTLockPasscode|deleteTTLockPasscode/);
});
