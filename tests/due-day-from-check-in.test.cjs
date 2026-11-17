const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const {
  dueDayFromStartDate,
  dueDayForNewTenancy,
  resolveTenancyStartDate,
} = require('../lib/tenancy/due-day.ts');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

test('new tenancy due day follows the check-in or start date, including the 1st', () => {
  assert.equal(dueDayForNewTenancy('2025-12-15'), 15);
  assert.equal(dueDayForNewTenancy('2026-02-01'), 1);
  assert.equal(dueDayFromStartDate('2026-08-29'), 29);
  assert.equal(dueDayFromStartDate('2026-09-30T00:00:00+08:00'), 30);
  assert.equal(dueDayFromStartDate(null), null);
  assert.equal(dueDayFromStartDate('15/12/2025'), null);
  assert.throws(() => dueDayForNewTenancy(''), /missing or invalid/);
  assert.equal(
    resolveTenancyStartDate({
      check_in_date: '2025-12-15',
      contract_start: '2026-09-01',
      start_date: '2026-09-01',
    }),
    '2025-12-15',
  );
});

test('new tenancy create paths use the helper and do not trust a stored default of 1', () => {
  const convert = read('lib/tenancy/convert-application.ts');
  assert.match(convert, /dueDayForNewTenancy\(application\.proposed_start_date\)/);
  assert.doesNotMatch(convert, /proposed_start_date\.slice\(8, 10\)/);

  const properties = read('app/properties/[id]/actions.ts');
  assert.match(properties, /dueDayForNewTenancy\(startDate\)/);
  assert.match(properties, /dueDayForNewTenancy\(checkInDate\)/);
  assert.doesNotMatch(properties, /record\.due_day \?\? Number\(startDate\.slice/);
  assert.doesNotMatch(properties, /Number\(checkInDate\.slice\(8, 10\)\)/);

  const activate = read('lib/auth/activate-all-tenants.ts');
  assert.match(activate, /dueDayForNewTenancy\(startDate\)/);
  assert.doesNotMatch(activate, /function validDueDay/);
  assert.doesNotMatch(activate, /if \(value && value >= 1 && value <= 31\) return value/);

  const agreement = read('lib/tenancy/agreement.ts');
  assert.match(agreement, /rent_due_day: context\.rent_due_day \?\? dueDayFromStartDate\(startDate\)/);
  assert.doesNotMatch(agreement, /getUTCDate\(\)/);

  const form = read('app/properties/[id]/register-tenant/registration-form.tsx');
  assert.match(form, /dueDayFromStartDate\(checkInDate\)/);
});
