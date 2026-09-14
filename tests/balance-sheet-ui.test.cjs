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
  if (request === './csv-download-button') return { CsvDownloadButton: ({label}) => require('react').createElement('button', null, label) };
  if (request === './reconciliation-submit-button') return { ReconciliationSubmitButton: ({children, disabled}) => require('react').createElement('button', {disabled}, children) };
  return originalLoad.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { BalanceSheetComparison } = require('../components/accounting/balance-sheet-comparison.tsx');
test('Balance Sheet renders expandable account breakdowns, comparisons and transparent limitations', () => {
 const detail={id:'detail',date:'2026-07-01',reference:'PV-001',description:'Equipment purchase',propertyId:'a',propertyName:'SLS',amount:100,source:'Bank voucher'};
 const row={key:'asset',code:'1500',label:'Equipment',section:'Assets',amount:100,details:[detail]};
 const html=renderToStaticMarkup(React.createElement(BalanceSheetComparison,{current:{date:'2026-07-31',rows:[row]},prior:{date:'2026-06-30',rows:[{...row,amount:0,details:[]}]},scope:'All outlets'}));
 for(const text of ['<details','Equipment purchase','PV-001','SLS','31 Jul 2026','30 Jun 2026','Show zero-balance accounts','Historical limitation','Supporting total','Download supporting records','Liabilities','Equity']) assert.ok(html.includes(text),text);
});
