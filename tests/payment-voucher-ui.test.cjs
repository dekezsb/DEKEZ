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
  if (request === '@/app/reports/actions') return { createBankExpenseVoucher: async () => {} };
  if (request === './reconciliation-submit-button') return { ReconciliationSubmitButton: ({children, disabled}) => require('react').createElement('button', {disabled}, children) };
  return originalLoad.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { BankExpenseVoucher } = require('../components/accounting/bank-expense-voucher.tsx');
test('every voucher displays all account groups and future custom accounts', () => {
  for (const lineId of ['first-bank-line', 'another-bank-line']) {
    const html = renderToStaticMarkup(React.createElement(BankExpenseVoucher, {
      lineId, amount: 2649.35, properties: [],
      accounts: ['asset', 'liability', 'equity', 'income', 'expense'].map((accountType, i) => ({id: `account-${i}`, code: `${i}999`, name: `Future ${accountType}`, accountType})),
    }));
    for (const label of ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses']) assert.ok(html.includes(`<optgroup label="${label}">`));
    for (const type of ['asset', 'liability', 'equity', 'income', 'expense']) assert.ok(html.includes(`Future ${type}`));
    assert.match(html, /Add line/);
    assert.match(html, /2649.35/);
    assert.doesNotMatch(html, /Expense category/);
  }
});
