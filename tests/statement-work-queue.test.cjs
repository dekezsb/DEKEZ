const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: f,
}).outputText, f);
const { loadWorkingStatementIds, workingStatements, selectedWorkingStatement, groupStatements, workingStatementGroups, selectedStatementGroup, statementGroupStatus, dedupeStatementLines } = require('../lib/accounting/statement-work-queue.ts');
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
  assert.match(page, /workingStatementGroupList\.map\(\(group\)/);
  assert.doesNotMatch(page, /\{statementImports\.map\(\(statement\)/);
  assert.match(page, /selectedStatementGroup\(tab === "bank" \? workingStatementGroupList : statementGroups, params\.statement\)/);
  assert.match(page, /const unreconciledTotal = workingStatementGroupList\.length/);
  assert.match(page, /for \(const statement of statementImports\)/);
  assert.match(page, /No bank transactions left to reconcile\. Completed records remain in the ledger\./);
  assert.match(page, /if \(statementLinesResult\.error\) throw new Error/);
  const component = fs.readFileSync(path.join(root, 'components/accounting/tenant-payment-reconciliation.tsx'), 'utf8');
  assert.match(component, /if\(result\.ok\) \{[\s\S]*?router\.refresh\(\)/);
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /tests\/statement-work-queue\.test\.cjs/);
});

const stmt = (id, period_start, period_end, extra = {}) => ({ id, bank_account_id: 'pbb', period_start, period_end, status: 'in_progress', created_at: `${period_end}T09:00:00Z`, ...extra });
test('same bank and month show as one group rooted at the full-month statement, via merge links or month fallback', () => {
  const linked = groupStatements([stmt('sept30', '2026-09-01', '2026-09-30'), stmt('sept16', '2026-09-01', '2026-09-16', { merged_into_statement_id: 'sept30' }), stmt('aug31', '2026-08-01', '2026-08-31')]);
  assert.deepEqual(linked.map(g => [g.root.id, g.statements.map(s => s.id).sort()]), [['sept30', ['sept16', 'sept30']], ['aug31', ['aug31']]]);
  const legacy = groupStatements([stmt('sept16', '2026-09-01', '2026-09-16'), stmt('sept30', '2026-09-01', '2026-09-30'), stmt('other-bank', '2026-09-01', '2026-09-30', { bank_account_id: 'maybank' })]);
  assert.equal(legacy.length, 2);
  assert.equal(legacy.find(g => g.statements.length === 2).root.id, 'sept30');
});
test('merge chains walk to the root, tolerate voided parents and loops, and never drop a statement', () => {
  const chain = groupStatements([stmt('a', '2026-09-01', '2026-09-10', { merged_into_statement_id: 'b' }), stmt('b', '2026-09-01', '2026-09-20', { merged_into_statement_id: 'c' }), stmt('c', '2026-09-01', '2026-10-02')]);
  assert.equal(chain.length, 1); assert.equal(chain[0].root.id, 'c'); assert.equal(chain[0].key, 'pbb:2026-10');
  const orphan = groupStatements([stmt('child', '2026-09-01', '2026-09-16', { merged_into_statement_id: 'voided' })]);
  assert.equal(orphan[0].root.id, 'child');
  const loop = groupStatements([stmt('x', '2026-09-01', '2026-09-30', { merged_into_statement_id: 'y' }), stmt('y', '2026-09-01', '2026-09-30', { merged_into_statement_id: 'x' })]);
  assert.equal(loop.flatMap(g => g.statements).length, 2);
});
test('group is in progress while any member has work, and an old partial URL selects its month group', () => {
  const groups = groupStatements([stmt('sept30', '2026-09-01', '2026-09-30', { status: 'reconciled' }), stmt('sept16', '2026-09-01', '2026-09-16', { merged_into_statement_id: 'sept30' }), stmt('aug31', '2026-08-01', '2026-08-31')]);
  const working = workingStatementGroups(groups, new Set(['sept16']));
  assert.deepEqual(working.map(g => g.root.id), ['sept30']);
  assert.equal(statementGroupStatus(working[0], new Set(['sept16'])), 'in_progress');
  assert.equal(statementGroupStatus(working[0], new Set()), 'reconciled');
  assert.equal(selectedStatementGroup(working, 'sept16').root.id, 'sept30');
  assert.equal(selectedStatementGroup(working, 'aug31').root.id, 'sept30');
  assert.equal(selectedStatementGroup([], 'sept16'), null);
});
test('group lines keep each transaction once, preferring its original statement row', () => {
  const rows = [
    { id: 't1', statement_import_id: 'sept30', is_reused: true, status: 'unmatched' },
    { id: 't1', statement_import_id: 'sept16', is_reused: false, status: 'unmatched' },
    { id: 't2', statement_import_id: 'sept30', is_reused: false, status: 'unmatched' },
    { id: 't3', statement_import_id: 'sept30', is_reused: true, import_result: 'ALREADY RECONCILED', status: 'matched' },
  ];
  const lines = dedupeStatementLines(rows);
  assert.deepEqual(lines.map(l => [l.id, l.statement_import_id]), [['t1', 'sept16'], ['t2', 'sept30'], ['t3', 'sept30']]);
  assert.deepEqual(lines.filter(l => !l.is_reused && l.status === 'unmatched').map(l => l.id), ['t1', 't2']);
  assert.equal(lines.filter(l => l.is_reused).length, 1);
});
test('page queries every statement in the group, dedupes, and keeps balances on the root statement', () => {
  const page = fs.readFileSync(path.join(root, 'app/reports/page.tsx'), 'utf8');
  assert.match(page, /\.in\("statement_import_id", selectedGroupIds\)/);
  assert.match(page, /const statementLines = dedupeStatementLines\(statementLinesResult\.data\)/);
  assert.match(page, /const statementMovement = rootStatementLines\.reduce/);
  assert.match(page, /rentalMonthLabel\(statement\.period_end\.slice\(0, 7\)\)/);
  assert.match(page, /selectedGroupIds\.includes\(line\.statementId\)/);
  assert.match(fs.readFileSync(path.join(root, 'app/reports/actions.ts'), 'utf8'), /rpc\("link_contained_bank_statements", \{ p_statement_id: statementImport\.id \}\)/);
});
test('upload links only covered, non-void statements of the same account, audits it, and never loops', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table bank_statement_imports(id uuid primary key,bank_account_id uuid,company_id uuid,period_start date,period_end date,status text default 'in_progress',created_by uuid);
    create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,before_data jsonb,after_data jsonb,reason text,performed_by uuid);`);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261009090000_merge_contained_bank_statements.sql'), 'utf8'));
  const add = (n, start, end, extra = {}) => db.query('insert into bank_statement_imports(id,bank_account_id,company_id,period_start,period_end,status) values($1,$2,$3,$4,$5,$6)',
    [uuid(n), uuid(extra.account ?? 1), uuid(extra.company ?? 9), start, end, extra.status ?? 'in_progress']);
  await add(16, '2026-09-01', '2026-09-16'); await add(17, '2026-09-01', '2026-09-16', { status: 'void' });
  await add(18, '2026-09-01', '2026-09-16', { account: 2 }); await add(19, '2026-09-01', '2026-09-16', { company: 8 });
  await add(20, '2026-08-25', '2026-09-05'); await add(30, '2026-09-01', '2026-09-30');
  const link = async n => (await db.query('select public.link_contained_bank_statements($1) n', [uuid(n)])).rows[0].n;
  assert.equal(await link(30), 1);
  const merged = (await db.query('select id,merged_into_statement_id m from bank_statement_imports order by id')).rows;
  assert.deepEqual(merged.filter(r => r.m).map(r => [r.id, r.m]), [[uuid(16), uuid(30)]]);
  assert.equal((await db.query("select count(*)::int n from accounting_audit_logs where action='merge_into_covering_statement'")).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from bank_statement_imports')).rows[0].n, 6); // nothing deleted
  assert.equal(await link(16), 0); // a merged statement never absorbs its root
  await add(31, '2026-09-01', '2026-09-30'); assert.equal(await link(31), 1); // equal re-upload absorbs the old root
  assert.equal(await link(30), 0);
  await db.close();
});
