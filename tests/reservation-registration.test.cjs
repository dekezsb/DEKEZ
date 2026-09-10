const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
}
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { RegistrationForm } = require('../app/register-tenant/registration-form.tsx');
test('public Register exposes reservation and actual payment details, not just the staff form', () => {
  const { RegistrationForm: PublicRegistrationForm } = require('../app/register/registration-form.tsx');
  const html = renderToStaticMarkup(React.createElement(PublicRegistrationForm, { properties: [], rooms: [] }));
  assert.match(html, /Reserve room first/);
  assert.match(html, /name="paymentAmount"/);
  assert.match(html, /name="paymentDate"/);
  assert.match(html, /name="paymentNote"/);
  assert.match(html, /name="paymentPurpose"/);
});
function render(code, rentalModel = 'tenancy') {
  return renderToStaticMarkup(React.createElement(RegistrationForm, {
    action: async () => {}, initialPropertyId: 'property',
    properties: [{ id: 'property', label: code, code, rentalModel, isCommercial: ['BDS', 'PTT'].includes(code) }],
    rooms: [{ id: 'room', propertyId: 'property', roomNumber: 'B4', monthlyRent: 380 }],
  }));
}
test('SLS monthly-stay registration offers reservation and one editable instalment amount', () => {
  const html = render('SLS', 'monthly_stay');
  assert.match(html, /value="reservation"/);
  assert.equal((html.match(/name="paymentAmount"/g) || []).length, 1);
  assert.match(html, /name="paymentAmount"[^>]*type="number"|type="number"[^>]*name="paymentAmount"/);
  assert.equal((html.match(/name="paymentSlip"/g) || []).length, 1);
});
test('all eligible properties expose reservation, BDS and PTT retain standard registration', () => {
  for (const code of ['BVH', 'DGG', 'HLT', 'INS', 'KLB', 'MGT', 'SLY']) assert.match(render(code), /value="reservation"/);
  for (const code of ['BDS', 'PTT']) assert.doesNotMatch(render(code), /value="reservation"/);
});

test('approved reservation with verified money cannot activate tenancy or billing', async () => {
  const originalLoad = Module._load;
  let sideEffects = 0;
  Module._load = function (request, ...args) {
    if (['@/lib/billing/rent-billing', '@/lib/tenancy/agreement', '@/lib/ttlock/access'].includes(request)) {
      return new Proxy({}, { get: () => () => { sideEffects++; throw new Error('Reservation activated'); } });
    }
    return originalLoad.call(this, request, ...args);
  };
  const { convertTenantApplication } = require('../lib/tenancy/convert-application.ts');
  Module._load = originalLoad;
  let queriedTables = [];
  const db = { from(table) {
    queriedTables.push(table);
    const query = { select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: { registration_mode: 'reservation', verification_status: 'verified', payment_status: 'verified' } }; } };
    return query;
  } };
  assert.deepEqual(await convertTenantApplication(db, { actorId: 'actor', applicationId: 'booking' }), { ok: false, reason: 'application_not_ready' });
  assert.deepEqual(queriedTables, ['tenant_applications']);
  assert.equal(sideEffects, 0);
});
