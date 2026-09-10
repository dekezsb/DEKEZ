const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function(request, ...args) { return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args); };
Module._load = function(request, ...args) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  if (request === './actions' && args[0]?.filename.endsWith('monthly-payment-folder.tsx')) return { getMonthlyPaymentFolder: async () => {}, submitPaymentFolderSlip: async () => {} };
  return originalLoad.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { MonthlyPaymentFolder } = require('../app/rent-due-tracker/monthly-payment-folder.tsx');
test('payment folder renders two tabs, three slip boxes each, history and separate balances', () => {
  const html = renderToStaticMarkup(React.createElement(MonthlyPaymentFolder, { billId: 'bill', tenantName: 'Test tenant', roomName: 'B4', propertyName: 'SLS', paymentDateDefault: '2026-09-10', onClose() {}, initial: {
    month: '2026-09-01', eligible: true, mixedPending: false,
    rental: { required: 380, verified: 100, pending: 150, outstanding: 280, toSubmit: 130, excess: 0 },
    deposit: { required: 200, verified: 100, pending: 0, outstanding: 100, toSubmit: 100, excess: 0 },
    slips: [{ id: 'slip', billId: 'bill', amount: 100, purpose: 'monthly_rent', status: 'verified', date: '2026-09-02', reference: 'ABC', note: 'First instalment', url: null }],
  } }));
  assert.match(html, /Rental — this month/);
  assert.match(html, /Deposit — total balance/);
  assert.equal((html.match(/type="file"/g) || []).length, 6);
  assert.match(html, /First instalment/);
  assert.match(html, /Verified — already counted/);
  assert.match(html, /RM 280.00/);
  assert.match(html, /RM 130.00/);
});
