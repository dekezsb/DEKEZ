const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: f,
}).outputText, f);
const { loadWorkingStatementIds, workingStatements, selectedWorkingStatement } = require('../lib/accounting/statement-work-queue.ts');
function fixtureDb(rows, failAt = -1) {
  const reads = [];
  const db = { reads, from(table) {
    assert.equal(table, 'bank_statement_lines');
    const filters = [];
    return {
      select(columns) { assert.match(columns, /bank_statement_imports!inner\(company_id,status\)/); return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      neq(key, value) { filters.push(row => row[key] !== value); return this; },
      not(key, operator, values) { assert.equal(key, 'status'); assert.equal(operator, 'in'); assert.equal(values, '(matched,adjusted,ignored)'); filters.push(row => !['matched', 'adjusted', 'ignored'].includes(row.status)); return this; },
      order() { return this; },
      async range(from, to) { reads.push(from); return from === failAt ? { data: [], error: Error('Fixture read failed') } : { data: rows.filter(row => filters.every(f => f(row))).slice(from, to + 1), error: null }; },
      update() { assert.fail('Visibility must not write'); }, insert() { assert.fail('Visibility must not write'); }, delete() { assert.fail('Visibility must not delete'); },
    };
  } };
  return db;
}
const line = (statement_import_id, amount, status = 'unmatched', extra = {}) => ({ id: `${statement_import_id}-${amount}`, statement_import_id, amount, status, 'bank_statement_imports.company_id': 'company', 'bank_statement_imports.status': 'in_progress', ...extra });
test('finished money-in and money-out hide the statement even if in progress and balance difference is nonzero', async () => {
  const statements = [{ id: 'sept17', status: 'in_progress', difference: 13675.24 }, { id: 'sept16', status: 'in_progress' }];
  const rows = [line('sept17', 1080, 'matched'), line('sept17', -100, 'adjusted'), line('sept17', -20, 'ignored'), line('sept16', 350)];
  const before = JSON.stringify({ statements, rows });
  const queue = workingStatements(statements, await loadWorkingStatementIds(fixtureDb(rows), 'company'));
  assert.deepEqual(queue.map(x => x.id), ['sept16']); assert.equal(JSON.stringify({ statements, rows }), before);
});
test('either unfinished side keeps its statement; completed rows and zero money do not keep it alive', async () => {
  const rows = [line('credit', 100), line('debit', -100), line('both', 100), line('both', -100), line('zero', 0), line('ignored', 10, 'ignored')];
  assert.deepEqual([...await loadWorkingStatementIds(fixtureDb(rows), 'company')], ['credit', 'debit', 'both']);
});
test('old completed URL selects next working statement or clears all detail panels when nothing remains', () => {
  const queue = [{ id: 'sept16' }, { id: 'august' }];
  assert.equal(selectedWorkingStatement(queue, 'sept17').id, 'sept16');
  assert.equal(selectedWorkingStatement(queue, 'august').id, 'august');
  assert.equal(selectedWorkingStatement([], 'sept17'), null);
});
test('authorized unmatch brings the same statement back without recreating it', async () => {
  const statements = [{ id: 's', status: 'in_progress' }], rows = [line('s', 100, 'matched')];
  assert.deepEqual(workingStatements(statements, await loadWorkingStatementIds(fixtureDb(rows), 'company')), []);
  rows[0].status = 'unmatched'; // Simulate the existing authorized Unmatch, not a live write.
  assert.strictEqual(workingStatements(statements, await loadWorkingStatementIds(fixtureDb(rows), 'company'))[0], statements[0]);
});
test('work query is company-scoped, excludes void imports, pages all work and fails rather than hides on read errors', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => line(`statement-${i}`, 100));
  rows.push(line('foreign', 100, 'unmatched', { 'bank_statement_imports.company_id': 'other' }), line('void', 100, 'unmatched', { 'bank_statement_imports.status': 'void' }));
  const db = fixtureDb(rows), ids = await loadWorkingStatementIds(db, 'company');
  assert.equal(ids.size, 501); assert.ok(ids.has('statement-500')); assert.ok(!ids.has('foreign') && !ids.has('void')); assert.deepEqual(db.reads, [0, 500]);
  await assert.rejects(loadWorkingStatementIds(fixtureDb(rows, 500), 'company'), /Unable to check remaining/);
});
test('page buttons, selected statement and pending count use working queue; full accounting statement records stay intact', () => {
  const page = fs.readFileSync(path.join(root, 'app/reports/page.tsx'), 'utf8');
  assert.match(page, /workingStatementImports\.map\(\(statement\)/);
  assert.doesNotMatch(page, /\{statementImports\.map\(\(statement\)/);
  assert.match(page, /selectedWorkingStatement\(tab === "bank" \? workingStatementImports : statementImports, params\.statement\)/);
  assert.match(page, /const unreconciledTotal = workingStatementImports\.length/);
  assert.match(page, /for \(const statement of statementImports\)/);
  assert.match(page, /No bank transactions left to reconcile\. Completed records remain in the ledger\./);
  assert.match(page, /if \(statementLinesResult\.error\) throw new Error/);
  const component = fs.readFileSync(path.join(root, 'components/accounting/tenant-payment-reconciliation.tsx'), 'utf8');
  assert.match(component, /if\(result\.ok\) router\.refresh\(\)/);
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /tests\/statement-work-queue\.test\.cjs/);
});
