// Optional independent-session proof; this creates a new localhost-only PostgreSQL
// cluster containing SYNTHETIC records. It accepts no external connection string.
// node tests/rental-collection-native.cjs --pg-bin <bin> --output-dir <artifacts>
// Private-claim tests prove the atomic ledger, NOT an end-to-end WhatsApp send.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const option = name => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : null; };
const bin = option('--pg-bin'), output = option('--output-dir');
if (!bin || !output) throw Error('Explicit --pg-bin and --output-dir required. External databases are not supported.');
const repo = path.resolve(__dirname, '..'), root = path.resolve(output);
fs.mkdirSync(root, { recursive: true });
const work = fs.mkdtempSync(path.join(root, 'isolated-'));
const data = path.join(work, 'cluster'), passfile = path.join(work, 'ephemeral-init-password');
const pass = crypto.randomBytes(32).toString('hex');
const evidence = {
  startedAt: new Date().toISOString(), providerCalls: 0,
  scope: 'Synthetic localhost PostgreSQL, unmodified migration, independent backend sessions. No production credentials/data/provider calls.',
  limitation: 'Concurrent successful claims exercise service-only private.claim, not the full public 09:00 MYT send window. The public time gate is tested separately without changing its clock.',
  tests: [], waits: [], migrations: [],
};
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const binary = name => path.join(path.resolve(bin), name + (process.platform === 'win32' ? '.exe' : ''));
let port, started = false, control, a, b;
const clients = new Set();
const args = () => ['-h', '127.0.0.1', '-p', String(port), '-U', 'local_review', '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
// Do not load application .env files; inherited libpq options cannot redirect us.
const env = () => {
  const value = { ...process.env };
  for (const key of Object.keys(value)) if (key.startsWith('PG')) delete value[key];
  return { ...value, PGPASSWORD: pass, PGCONNECT_TIMEOUT: '5', PGHOST: '127.0.0.1', PGPORT: String(port), PGDATABASE: 'postgres', PGUSER: 'local_review' };
};
function run(name, argv, options = {}) {
  const r = spawnSync(binary(name), argv, { encoding: 'utf8', windowsHide: true, timeout: 60000, ...options });
  if (r.status !== 0) throw Error(name + ' failed: ' + (r.stderr || r.stdout || r.error || ('exit ' + r.status)));
  return r.stdout;
}
class Session {
  constructor(name) {
    this.name = name; this.out = ''; this.err = ''; this.pending = null;
    this.child = spawn(binary('psql'), args(), { env: env(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    clients.add(this);
    this.child.stdout.on('data', x => { this.out += x.toString(); this.flush(); });
    this.child.stderr.on('data', x => { this.err += x.toString(); });
    this.child.on('close', code => {
      clients.delete(this);
      if (this.pending) { this.pending.reject(Error(this.err || 'Session closed ' + code)); this.pending = null; }
    });
    this.child.on('error', error => { if (this.pending) { this.pending.reject(error); this.pending = null; } });
  }
  flush() {
    const pending = this.pending; if (!pending) return;
    const at = this.out.indexOf(pending.marker); if (at < 0) return;
    const result = this.out.slice(0, at).trim();
    this.out = this.out.slice(at + pending.marker.length).replace(/^\r?\n/, '');
    this.pending = null; pending.resolve(result);
  }
  query(sql) {
    assert.equal(this.pending, null, 'One active query per independent backend');
    const marker = 'END_' + crypto.randomBytes(10).toString('hex');
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, marker };
      this.child.stdin.write(sql + `;\nselect '${marker}';\n`); this.flush();
    });
  }
  async json(sql) { return JSON.parse(await this.query(sql)); }
  close() { if (!this.child.killed) this.child.stdin.end('\\q\n'); }
}
async function fresh(name, role) {
  const s = new Session(name); if (role) await s.query('set role ' + role);
  s.pid = Number(await s.query('select pg_backend_pid()')); return s;
}
async function check(name, fn) {
  const start = Date.now();
  try { const detail = await fn(); evidence.tests.push({ name, status: 'PASS', durationMs: Date.now() - start, ...detail }); console.log('PASS ' + name); }
  catch (error) { evidence.tests.push({ name, status: 'FAIL', error: error.message }); throw error; }
}
async function blocked(waiter, blocker, scenario) {
  for (let i = 0; i < 60; i++) {
    const row = await control.json(`select row_to_json(s) from (select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${waiter.pid}) s`);
    if (row.wait_event_type === 'Lock' && row.blockers.includes(blocker.pid)) {
      evidence.waits.push({ scenario, blockerPid: blocker.pid, ...row }); return row;
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error('Expected independent PostgreSQL lock wait not observed: ' + scenario);
}
const company = id(1), tenant = id(4), secondTenant = id(5), phone = '60191111111', secondPhone = '60192222222';
const sourceTables = ['companies', 'profiles', 'company_users', 'properties', 'rooms', 'tenants', 'tenancies', 'tenant_records', 'rent_bills', 'rental_invoice_line_items', 'payment_submissions', 'payments', 'whatsapp_conversations', 'rent_reminder_logs'];
const privateTables = ['controls', 'contact_controls', 'daily_cases', 'escalations', 'attempts', 'provider_events', 'number_suppressions', 'audit', 'failure_report_controls', 'failure_reports', 'worker_runs'];
const claim = snapshot => `select dekez_collections_private.claim(${q(JSON.stringify(snapshot))}::jsonb,'SYNTHETIC ONLY - no provider send')`;
const contactEvent = (event, kind = 'stop') => `select public.dekez_collection_ingest_contact_event(${q(company)},'FALCON-D9NS9',${q(event)},${q('msg-' + event)},${q(phone)},${q(kind)},clock_timestamp())`;
const receipt = (event, status, recipient = phone, provider = 'SYNTHETIC-receipt-id') => `select public.dekez_collection_ingest_receipt(${q(company)},'FALCON-D9NS9',${q(event)},${q(provider)},${q(recipient)},${q(status)},clock_timestamp())`;
const counts = () => control.json("select json_build_object('total',count(*),'sending',count(*) filter(where state='sending'),'accepted',count(*) filter(where state='accepted'),'uncertain',count(*) filter(where state='uncertain'),'rejected',count(*) filter(where state='rejected')) from dekez_collections_private.attempts");
async function reset() {
  await control.query(`truncate dekez_collections_private.attempts,dekez_collections_private.audit,dekez_collections_private.daily_cases,dekez_collections_private.escalations,dekez_collections_private.provider_events,dekez_collections_private.number_suppressions,dekez_collections_private.failure_report_controls,dekez_collections_private.failure_reports,dekez_collections_private.worker_runs;
    update dekez_collections_private.controls set enabled=true,compliance_approved=true,opt_out_ready=true,legacy_handover_complete=true;
    update dekez_collections_private.contact_controls set consent='opted_in',hold='none',
      approved_recipient=case tenant_id when ${q(tenant)}::uuid then ${q(phone)} else ${q(secondPhone)} end,
      ownership_recipient=case tenant_id when ${q(tenant)}::uuid then ${q(phone)} else ${q(secondPhone)} end,
      ownership_reference='SYNTHETIC OWNERSHIP ONLY',ownership_verified_by=${q(id(3))},ownership_verified_at=clock_timestamp();`);
}
async function snapshot(user = tenant, session = a) {
  return session.json(`select public.dekez_collection_track(${q(company)},${q(user)})`);
}
const workerInsert = () => `insert into dekez_collections_private.worker_runs(company_id,report_date)
 values(${q(company)},(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date)
 on conflict(company_id,report_date) do nothing returning lease_token`;
async function workerFixture(state = 'running') {
  return control.query(`insert into dekez_collections_private.worker_runs(company_id,report_date,state,started_at,expires_at,finished_at)
   values(${q(company)},(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,${q(state)},
    clock_timestamp()-interval '60 seconds',clock_timestamp()+interval '230 seconds',${state === 'running' ? 'null' : 'clock_timestamp()'}) returning lease_token`);
}
const managerReview = (action, actor = id(3), scope = company) => `select public.dekez_collection_review_failure_recipient(${q(scope)},${q(actor)},${q(id(50))},${q(action)},'SYNTHETIC manager evidence','SYNTHETIC manager recipient review')`;
async function managerEvidence() {
  return a.json(`select public.dekez_collection_failure_evidence(${q(company)},null,100)`);
}
const digestSnapshot = e => ({ company_id: company, report_date: e.report_date, recipient: '60188702371', all_history_loaded: true, contains_personal_details: true });
const digestClaim = (e, body = 'SYNTHETIC consolidated report - no provider send', snapshotValue = digestSnapshot(e)) =>
  `select dekez_collections_private.failure_claim(${q(company)},${q(e.fingerprint)},${q(body)},${q(JSON.stringify(snapshotValue))}::jsonb,${q(JSON.stringify(e.recipient_authorization))}::jsonb)`;
async function captureSources() {
  const result = {};
  for (const table of sourceTables) result[table] = await control.json(`select coalesce(json_agg(x order by id),'[]') from public.${table} x`);
  result.user_module_permissions = await control.json("select coalesce(json_agg(x order by profile_id,module_key),'[]') from public.user_module_permissions x");
  return result;
}
async function denied(role, sql) {
  const r = spawnSync(binary('psql'), [...args(), '-c', `set role ${role};${sql}`], { env: env(), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /42501|permission denied|insufficient_privilege/);
  return { role, sqlState: '42501', denied: true };
}
async function main() {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  fs.writeFileSync(passfile, pass, { mode: 0o600 });
  try { run('initdb', ['-D', data, '-U', 'local_review', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--pwfile=' + passfile, '--encoding=UTF8', '--locale=C']); }
  finally { fs.unlinkSync(passfile); }
  // PostgreSQL must not inherit a captured pipe that keeps spawnSync waiting.
  run('pg_ctl', ['-D', data, '-l', path.join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=20 -c log_lock_waits=on -c deadlock_timeout=100ms`, '-w', 'start'], { stdio: 'ignore' });
  started = true; control = await fresh('observer');
  evidence.server = await control.json("select json_build_object('version',version(),'listen_addresses',current_setting('listen_addresses'),'port',current_setting('port'),'observerPid',pg_backend_pid(),'malaysiaNow',clock_timestamp() at time zone 'Asia/Kuala_Lumpur')");
  const fixture = fs.readFileSync(path.join(repo, 'tests/fixtures/rental-collection.cjs'), 'utf8');
  const start = fixture.indexOf(' create table companies('), end = fixture.indexOf('`);', start);
  assert(start > 0 && end > start, 'Synthetic fixture boundary must be identifiable');
  const fixtureSql = Function('id', 'return `' + fixture.slice(start, end) + '`')(id);
  await control.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create role fixture_migrator nologin createrole createdb bypassrls;
    grant usage,create on schema public to fixture_migrator;grant create on database postgres to fixture_migrator;
    set role fixture_migrator;${fixtureSql};reset role;`);
  const name = '20261027051603_rental_collection_review.sql';
  const sql = fs.readFileSync(path.join(repo, 'supabase/migrations', name), 'utf8');
  // Feed unmodified SQL over stdin, avoiding the Windows command-line limit.
  run('psql', args(), { env: env(), input: 'set role fixture_migrator;\n' + sql });
  evidence.migrations.push({ filename: name, sha256: crypto.createHash('sha256').update(sql).digest('hex'), unmodified: true, migrationRole: 'fixture_migrator (non-superuser)' });
  await control.query(`insert into profiles values(${q(secondTenant)},'Synthetic second tenant','0192222222','tenant','approved'),
    (${q(id(6))},'Synthetic view-only admin','0193333333','admin','approved'),
    (${q(id(50))},'Synthetic management recipient','60188702371','admin','approved');
    insert into company_users values(${q(id(8))},${q(company)},${q(id(6))},${q(id(6))},'admin','active');
    insert into company_users values(${q(id(51))},${q(company)},${q(id(50))},${q(id(50))},'admin','active');
    insert into user_module_permissions values(${q(id(6))},'rent_due_tracker','view');
    insert into tenants values(${q(id(22))},${q(secondTenant)},'Synthetic second tenant','0192222222');
    insert into rooms(id,property_id,room_number,name,current_tenancy_id) values(${q(id(12))},${q(id(10))},'A2','Synthetic second room',${q(id(23))});
    insert into tenancies values(${q(id(23))},${q(id(22))},${q(company)},${q(id(10))},${q(id(12))},'active','active',null);
    insert into rent_bills(id,tenancy_id,tenant_id,property_id,room_id,invoice_number,due_date,amount,paid_amount,status,tenant_facing,issued_at,invoice_date,bill_month,deposit_amount)
    values(${q(id(100))},${q(id(21))},${q(tenant)},${q(id(10))},${q(id(11))},'SYNTHETIC-PARTIAL',(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date-14,500,200,'unpaid',true,clock_timestamp()-interval '30 days',current_date-30,current_date-30,999),
    (${q(id(101))},${q(id(23))},${q(secondTenant)},${q(id(10))},${q(id(12))},'SYNTHETIC-SECOND',(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date-14,700,0,'unpaid',true,clock_timestamp()-interval '30 days',current_date-30,current_date-30,999);
    insert into payments values(${q(id(1100))},${q(id(100))},${q(id(21))},${q(company)},${q(id(10))},${q(id(11))},'monthly_rent','confirmed',200,null,null);
    insert into dekez_collections_private.controls(company_id,enabled,compliance_approved,opt_out_ready,legacy_handover_complete,approved_by,approved_at,review_reference)
    values(${q(company)},true,true,true,true,${q(id(3))},clock_timestamp(),'SYNTHETIC POLICY REVIEW ONLY');
    insert into dekez_collections_private.contact_controls(company_id,tenant_id,consent,consent_reference,approved_recipient,reviewed_by,reviewed_at,ownership_recipient,ownership_reference,ownership_verified_by,ownership_verified_at)
    values(${q(company)},${q(tenant)},'opted_in','SYNTHETIC CONSENT ONLY',${q(phone)},${q(id(3))},clock_timestamp(),${q(phone)},'SYNTHETIC OWNERSHIP ONLY',${q(id(3))},clock_timestamp()),
    (${q(company)},${q(secondTenant)},'opted_in','SYNTHETIC CONSENT ONLY',${q(secondPhone)},${q(id(3))},clock_timestamp(),${q(secondPhone)},'SYNTHETIC OWNERSHIP ONLY',${q(id(3))},clock_timestamp());`);
  const original = await captureSources();
  a = await fresh('caller-a', 'service_role'); b = await fresh('caller-b', 'service_role');
  assert.notEqual(a.pid, b.pid); assert.notEqual(a.pid, control.pid);
  evidence.callerPids = { a: a.pid, b: b.pid };

  await check('partial balance preserves original fourteen-day aging and persists both internal reviews', async () => {
    await reset(); const s = await snapshot();
    assert.equal(s.outstanding, 300); assert.equal(s.days_overdue, 14); assert.equal(s.stage, 'day_14_review');
    assert.equal(s.partial_invoices, 1); assert.equal(s.send_eligible, true); assert.equal(s.new_day_7, 1); assert.equal(s.new_day_14, 1);
    return { outstanding: s.outstanding, daysOverdue: s.days_overdue, originalDueDate: s.invoices[0].due_date, newDay7: s.new_day_7, newDay14: s.new_day_14 };
  });
  await check('independent sessions reserve the same tenant and phone at most once', async () => {
    await reset(); const s = await snapshot(); await a.query('begin'); const first = await a.json(claim(s)); assert.equal(first.claimed, true);
    const pending = b.json(claim(s)); await blocked(b, a, 'same phone advisory lock'); await a.query('commit'); const second = await pending;
    assert.deepEqual(second, { claimed: false, state: 'duplicate' }); assert.equal((await counts()).total, 1);
    return { first, second, counts: await counts(), backendPids: [a.pid, b.pid], entrypoint: 'private.claim' };
  });
  await check('a rolled-back claim allows exactly one committed replacement', async () => {
    await reset(); const s = await snapshot(); await a.query('begin'); const first = await a.json(claim(s));
    const pending = b.json(claim(s)); await blocked(b, a, 'rollback releases daily reservation'); await a.query('rollback'); const second = await pending;
    assert.equal(second.claimed, true); assert.notEqual(first.attempt_id, second.attempt_id); assert.equal((await counts()).total, 1);
    return { rolledBack: first.attempt_id, committed: second.attempt_id, counts: await counts() };
  });
  await check('same approved phone across different synthetic tenant snapshots cannot reserve twice', async () => {
    await reset(); const one = await snapshot(), two = await snapshot(secondTenant);
    // Deliberately test the ledger's final defense with two server snapshots.
    // Public source separately rejects shared phone identities before this layer.
    two.phone = phone;
    await control.query(`update dekez_collections_private.contact_controls set approved_recipient=${q(phone)},ownership_recipient=${q(phone)} where tenant_id=${q(secondTenant)}`);
    await a.query('begin'); const first = await a.json(claim(one)); assert.equal(first.claimed, true);
    const pending = b.json(claim(two)); await blocked(b, a, 'global phone daily reservation'); await a.query('commit'); const second = await pending;
    assert.deepEqual(second, { claimed: false, state: 'duplicate' }); assert.equal((await counts()).total, 1);
    return { firstTenant: tenant, secondTenant, result: second, counts: await counts(), syntheticServerSnapshots: true };
  });
  await check('same tenant with competing approved phone snapshots cannot reserve twice', async () => {
    await reset(); const one = await snapshot(); const two = { ...one, phone: '60193333333' };
    await a.query('begin'); const first = await a.json(claim(one)); assert.equal(first.claimed, true);
    await control.query(`update dekez_collections_private.contact_controls set approved_recipient=${q(two.phone)},ownership_recipient=${q(two.phone)} where tenant_id=${q(tenant)}`);
    const pending = b.json(claim(two)); await blocked(b, a, 'tenant/date unique constraint across phones'); await a.query('commit'); const second = await pending;
    assert.deepEqual(second, { claimed: false, state: 'duplicate' }); assert.equal((await counts()).total, 1);
    return { result: second, counts: await counts(), syntheticServerSnapshots: true };
  });
  await check('consent for a different phone, opt-out and unavailable opt-out handling fail closed', async () => {
    await reset(); const s = await snapshot();
    const wrongPhone = await a.json(claim({ ...s, phone: secondPhone })); assert.equal(wrongPhone.state, 'withheld');
    await control.query(`update dekez_collections_private.contact_controls set consent='opted_out' where tenant_id=${q(tenant)}`);
    const optedOut = await a.json(claim(s)); assert.equal(optedOut.state, 'withheld');
    await control.query(`update dekez_collections_private.contact_controls set consent='opted_in' where tenant_id=${q(tenant)};update dekez_collections_private.controls set opt_out_ready=false`);
    const notReady = await a.json(claim(s)); assert.equal(notReady.state, 'withheld'); assert.equal((await counts()).total, 0);
    return { wrongPhone, optedOut, optOutHandlingUnavailable: notReady, counts: await counts() };
  });
  await check('portal login without verified ownership and protected management recipients cannot reserve a tenant reminder', async () => {
    await reset(); const s = await snapshot();
    await control.query(`update dekez_collections_private.contact_controls set ownership_recipient=null,ownership_reference=null,ownership_verified_by=null,ownership_verified_at=null where tenant_id=${q(tenant)}`);
    const unverified = await a.json(claim(s)); assert.deepEqual(unverified, { claimed: false, state: 'withheld' });
    const protectedResults = [];
    for (const recipient of ['60198894911', '60168173911', '60188702371']) {
      const result = await a.json(claim({ ...s, phone: recipient }));
      assert.deepEqual(result, { claimed: false, state: 'protected_recipient' }); protectedResults.push({ recipient, result });
    }
    assert.equal((await counts()).total, 0);
    return { unverified, protectedResults, counts: await counts() };
  });
  await check('a consent withdrawal committed during a lock wait is rechecked before reservation', async () => {
    await reset(); const s = await snapshot(); const gate = await fresh('opt-out-lock-gate');
    await gate.query(`begin;select pg_advisory_xact_lock(hashtextextended('dekez-collection:${phone}',0))`);
    const pending = b.json(claim(s)); await blocked(b, gate, 'consent withdrawn while claim waits');
    await control.query(`update dekez_collections_private.contact_controls set consent='opted_out' where tenant_id=${q(tenant)}`);
    await gate.query('commit'); gate.close(); const result = await pending;
    assert.deepEqual(result, { claimed: false, state: 'withheld' }); assert.equal((await counts()).total, 0);
    return { result, counts: await counts(), waiterPid: b.pid };
  });
  await check('independent STOP transaction blocks a stale eligible claim; duplicate STOP and START cannot restore contact', async () => {
    await reset(); const s = await snapshot(); await a.query('begin');
    assert.deepEqual(await a.json(contactEvent('native-stop')), { state: 'suppressed' });
    const pending = b.json(claim(s)); await blocked(b, a, 'authenticated STOP commits before waiting claim');
    await a.query('commit'); const result = await pending;
    assert.deepEqual(result, { claimed: false, state: 'opted_out' });
    const duplicate = await b.json(contactEvent('native-stop'));
    const start = await b.json(contactEvent('native-start', 'start'));
    assert.deepEqual(duplicate, { state: 'duplicate' }); assert.deepEqual(start, { state: 'start_review_required' });
    assert.equal(await b.query(`select dekez_collections_private.number_suppressed(${q(phone)})`), 't');
    assert.deepEqual(await b.json(claim(s)), { claimed: false, state: 'opted_out' }); assert.equal((await counts()).total, 0);
    return { result, duplicate, start, counts: await counts(), backendPids: [a.pid, b.pid] };
  });
  await check('a claim committed before STOP remains reserved and is never retried automatically', async () => {
    await reset(); const s = await snapshot(); await a.query('begin'); const first = await a.json(claim(s));
    const pending = b.json(contactEvent('stop-after-claim')); await blocked(b, a, 'STOP waits for existing atomic reservation');
    await a.query('commit'); assert.deepEqual(await pending, { state: 'suppressed' });
    assert.deepEqual(await a.json(claim(s)), { claimed: false, state: 'opted_out' }); assert.equal((await counts()).total, 1);
    return { reservation: first.attempt_id, counts: await counts(), limitation: 'STOP cannot recall a provider request already started; this harness makes no provider call.' };
  });
  await check('review RPC checks Admin company and module permission before changing ownership or consent', async () => {
    await reset();
    const review = (actor, action = 'verify_ownership', scope = company) => `select public.dekez_collection_review_contact(${q(scope)},${q(tenant)},${q(phone)},${q(actor)},${q(action)},'SYNTHETIC reviewed evidence','SYNTHETIC reviewed reason')`;
    const denials = [];
    for (const [actor, scope] of [[tenant, company], [id(6), company], [id(3), id(2)]]) {
      denials.push(await denied('service_role', review(actor, 'verify_ownership', scope)));
    }
    for (const role of ['anon', 'authenticated']) denials.push(await denied(role, review(id(3))));
    assert.equal(Number(await control.query("select count(*) from dekez_collections_private.audit where action='contact_reviewed'")), 0);
    await control.query(`update dekez_collections_private.contact_controls set consent='unknown',ownership_recipient=null,ownership_reference=null,ownership_verified_by=null,ownership_verified_at=null where tenant_id=${q(tenant)}`);
    const ownership = await a.json(review(id(3)));
    assert.equal(ownership.ownership_verified, true); assert.equal(ownership.consent, 'unknown');
    const consent = await a.json(review(id(3), 'record_opt_in')); assert.equal(consent.consent, 'opted_in');
    assert.equal(Number(await control.query("select count(*) from dekez_collections_private.audit where action='contact_reviewed'")), 2);
    return { deniedCalls: denials.length, ownershipThenConsentSeparate: true, auditRecords: 2 };
  });
  await check('independent receipt requests deduplicate and do not confuse provider acceptance with delivery', async () => {
    await reset(); const s = await snapshot(); const first = await a.json(claim(s));
    await a.query(`select public.dekez_collection_finish(${q(first.attempt_id)},'accepted','SYNTHETIC-receipt-id',200,null)`);
    assert.equal(await control.query(`select delivery_state from dekez_collections_private.attempts where id=${q(first.attempt_id)}`), 'unconfirmed');
    await a.query('begin'); const delivered = await a.json(receipt('native-receipt', 'delivered'));
    const pending = b.json(receipt('native-receipt', 'delivered'));
    await blocked(b, a, 'same provider receipt serialized and deduplicated'); await a.query('commit');
    const duplicate = await pending; assert.deepEqual(duplicate, { state: 'duplicate' });
    assert.equal(delivered.delivery_state, 'delivered');
    const unrelated = await b.json(receipt('wrong-recipient-receipt', 'failed', secondPhone)); assert.equal(unrelated.state, 'unmatched');
    assert.equal(await control.query(`select delivery_state from dekez_collections_private.attempts where id=${q(first.attempt_id)}`), 'delivered');
    const conflicting = await b.json(receipt('native-failed-receipt', 'failed')); assert.equal(conflicting.delivery_state, 'conflict');
    assert.deepEqual(await a.json(claim(s)), { claimed: false, state: 'duplicate' });
    assert.equal(Number(await control.query("select count(*) from dekez_collections_private.provider_events where event_id='native-receipt'")), 1);
    return { acceptedInitially: 'unconfirmed', delivered, duplicate, unrelated, conflicting, counts: await counts() };
  });
  await check('an authenticated receipt arriving before finalization is reconciled without another provider call', async () => {
    await reset(); const s = await snapshot(); const first = await a.json(claim(s));
    const early = await b.json(receipt('early-native-receipt', 'read')); assert.equal(early.state, 'unmatched');
    await a.query(`select public.dekez_collection_finish(${q(first.attempt_id)},'accepted','SYNTHETIC-receipt-id',200,null)`);
    assert.equal(await control.query(`select delivery_state from dekez_collections_private.attempts where id=${q(first.attempt_id)}`), 'read');
    assert.equal((await counts()).total, 1);
    return { early, afterFinalization: 'read', providerCalls: 0 };
  });
  await check('pending payment cannot be disguised as an eligible demand; held cases still receive internal review', async () => {
    await reset(); const s = await snapshot(); const result = await a.json(claim({ ...s, pending_verification: true, send_eligible: true }));
    assert.deepEqual(result, { claimed: false, state: 'pending_review' }); assert.equal((await counts()).total, 0);
    await control.query(`truncate dekez_collections_private.escalations;update dekez_collections_private.contact_controls set hold='dispute' where tenant_id=${q(tenant)}`);
    const held = await snapshot(); assert.equal(held.send_eligible, false); assert.equal(held.new_day_7, 1); assert.equal(held.new_day_14, 1);
    return { result, heldCase: { sendEligible: held.send_eligible, newDay7: held.new_day_7, newDay14: held.new_day_14 } };
  });
  await check('accepted, rejected and uncertain results retain the daily reservation without retry', async () => {
    const results = [];
    for (const state of ['accepted', 'rejected', 'uncertain']) {
      await reset(); const s = await snapshot(); const first = await a.json(claim(s));
      const provider = state === 'accepted' ? "'SYNTHETIC-provider-id'" : 'null';
      const http = state === 'accepted' ? '200' : state === 'rejected' ? '400' : 'null';
      const error = state === 'accepted' ? 'null' : state === 'rejected' ? "'provider_rejected'" : "'delivery_uncertain'";
      await a.query(`select public.dekez_collection_finish(${q(first.attempt_id)},${q(state)},${provider},${http},${error})`);
      const replay = await b.json(claim(s)); assert.deepEqual(replay, { claimed: false, state: 'duplicate' }); assert.equal((await counts())[state], 1);
      results.push({ state, replay });
    }
    return { results, note: 'accepted means provider accepted, not delivered; no provider was called' };
  });
  await check('five-second lock timeout fails closed with no second reservation', async () => {
    await reset(); const s = await snapshot(); await a.query('begin'); await a.json(claim(s));
    const start = Date.now(); const pending = b.query(claim(s)).then(value => ({ value }), error => ({ error: error.message }));
    await blocked(b, a, 'bounded claim lock timeout'); const result = await pending; const elapsed = Date.now() - start;
    assert.match(result.error, /55P03[\s\S]*lock timeout/); assert(elapsed >= 4500 && elapsed < 9000);
    await a.query('commit'); b = await fresh('caller-b-after-timeout', 'service_role'); assert.equal((await counts()).total, 1);
    return { elapsedMs: elapsed, sqlState: '55P03', counts: await counts() };
  });
  await check('public RPC enforces its real Malaysia clock without a test clock override', async () => {
    await reset(); const s = await snapshot();
    const absentWorker = await a.json(`select public.dekez_collection_claim(${q(company)},${q(tenant)},'deliberately-invalid-fingerprint','SYNTHETIC ONLY')`);
    assert.deepEqual(absentWorker, { claimed: false, state: 'worker_not_active' });
    // Synthetic local fixture only. This does not bypass or change the clock
    // in the deployed worker-start or message-claim functions.
    await workerFixture();
    const before = Number(await control.query("select extract(hour from clock_timestamp() at time zone 'Asia/Kuala_Lumpur')"));
    const result = await a.json(`select public.dekez_collection_claim(${q(company)},${q(tenant)},'deliberately-invalid-fingerprint','SYNTHETIC ONLY')`);
    const after = Number(await control.query("select extract(hour from clock_timestamp() at time zone 'Asia/Kuala_Lumpur')"));
    assert.equal(before, after, 'Clock crossed a gate boundary; rerun rather than claim a result');
    assert.deepEqual(result, { claimed: false, state: before === 9 ? 'source_changed' : 'outside_window' });
    assert.equal((await counts()).total, 0);
    return { malaysiaHour: before, absentWorker, result, syntheticWorkerFixture: true, fullPublicSuccessfulSendTested: false, sourceFingerprintGenerated: Boolean(s.fingerprint) };
  });
  await check('independent sessions reserve only one daily worker and expired leases never authorize a replacement', async () => {
    await reset(); const one = await fresh('synthetic-worker-a'), two = await fresh('synthetic-worker-b');
    await one.query('begin'); const token = await one.query(workerInsert()); assert.match(token, /^[a-f0-9-]{36}$/);
    const pending = two.query(workerInsert()); await blocked(two, one, 'company/date worker unique reservation');
    await one.query('commit'); const duplicate = await pending; assert.equal(duplicate, '');
    assert.equal(await a.query(`select dekez_collections_private.worker_active(${q(company)})`), 't');
    await control.query("update dekez_collections_private.worker_runs set started_at=clock_timestamp()-interval '301 seconds',expires_at=clock_timestamp()-interval '1 second'");
    assert.equal(await a.query(`select dekez_collections_private.worker_active(${q(company)})`), 'f');
    assert.equal(await two.query(workerInsert()), '');
    assert.deepEqual(await a.json(`select public.dekez_collection_claim(${q(company)},${q(tenant)},'bad','SYNTHETIC')`), { claimed: false, state: 'worker_not_active' });
    await a.query(`select public.dekez_collection_finish_run(${q(token)},'incomplete')`);
    await b.query(`select public.dekez_collection_finish_run(${q(token)},'incomplete')`);
    const hour = Number(await control.query("select extract(hour from clock_timestamp() at time zone 'Asia/Kuala_Lumpur')"));
    const startedAgain = await a.json(`select public.dekez_collection_begin_run(${q(company)})`);
    const after = Number(await control.query("select extract(hour from clock_timestamp() at time zone 'Asia/Kuala_Lumpur')"));
    assert.equal(hour, after, 'Clock crossed a gate boundary; rerun');
    assert.deepEqual(startedAgain, { claimed: false, state: hour === 9 ? 'already_started' : 'outside_window' });
    assert.equal(Number(await control.query('select count(*) from dekez_collections_private.worker_runs')), 1);
    one.close(); two.close();
    return { backendPids: [one.pid, two.pid], duplicateInsert: 'no row', expiredReplacement: 'no row', publicStartResult: startedAgain,
      limitation: 'Independent inserts test the real unique constraint; successful public begin_run is not claimed outside its actual 09:00 MYT window.' };
  });
  await check('management summary requires separate number ownership and consent with scoped Admin review', async () => {
    await reset(); await snapshot(); await workerFixture('complete');
    const initial = await managerEvidence(); assert.equal(initial.recipient_authorization.verified, true);
    assert.equal(initial.recipient_authorization.whatsapp_ownership_verified, false);
    assert.deepEqual(await a.json(digestClaim(initial)), { claimed: false, state: 'withheld' });
    const denials = [];
    for (const actor of [tenant, id(6)]) denials.push(await denied('service_role', managerReview('verify_ownership', actor)));
    denials.push(await denied('service_role', managerReview('verify_ownership', id(3), id(2))));
    for (const role of ['anon', 'authenticated']) denials.push(await denied(role, managerReview('verify_ownership')));
    await a.query(managerReview('verify_ownership'));
    const ownershipOnly = await managerEvidence(); assert.equal(ownershipOnly.recipient_authorization.whatsapp_ownership_verified, true);
    assert.notEqual(ownershipOnly.recipient_authorization.whatsapp_consent, 'opted_in');
    assert.deepEqual(await a.json(digestClaim(ownershipOnly)), { claimed: false, state: 'withheld' });
    await a.query(managerReview('record_opt_in'));
    const approved = await managerEvidence(); assert.equal(approved.recipient_authorization.whatsapp_consent, 'opted_in');
    assert.equal(Number(await control.query("select count(*) from dekez_collections_private.audit where action='failure_recipient_reviewed'")), 2);
    return { deniedCalls: denials.length, separateOwnershipAndConsent: true, recipient: approved.recipient_authorization.recipient,
      dailyReportsCreated: Number(await control.query('select count(*) from dekez_collections_private.failure_reports')) };
  });
  await check('independent management-summary claims reserve once and uncertain completion cannot cause a resend', async () => {
    await reset(); await snapshot(); await workerFixture('complete');
    await a.query(managerReview('verify_ownership')); await a.query(managerReview('record_opt_in'));
    const e = await managerEvidence(); await a.query('begin'); const first = await a.json(digestClaim(e)); assert.equal(first.claimed, true);
    const pending = b.json(digestClaim(e)); await blocked(b, a, 'company/date management summary reservation');
    await a.query('commit'); const duplicate = await pending;
    assert.deepEqual(duplicate, { claimed: false, state: 'already_reserved' });
    await a.query(`select public.dekez_collection_failure_finish(${q(first.attempt_id)},'uncertain',null,null,'delivery_uncertain')`);
    const replay = await b.json(digestClaim(e, 'SYNTHETIC later draft only', { ...digestSnapshot(e), laterDraft: true }));
    assert.deepEqual(replay, { claimed: false, state: 'already_reserved' });
    const row = await control.json('select row_to_json(r) from (select state,message_body,snapshot,latest_snapshot from dekez_collections_private.failure_reports) r');
    assert.equal(row.state, 'uncertain'); assert.equal(row.message_body, first.body);
    assert.equal(row.snapshot.laterDraft, undefined); assert.equal(row.latest_snapshot.laterDraft, true);
    assert.equal(Number(await control.query('select count(*) from dekez_collections_private.failure_reports')), 1);
    return { backendPids: [a.pid, b.pid], duplicate, replay, state: row.state, immutableSentBody: true, providerCalls: 0 };
  });
  await check('management STOP committed while a summary waits suppresses the stale authorization', async () => {
    await reset(); await snapshot(); await workerFixture('complete');
    await a.query(managerReview('verify_ownership')); await a.query(managerReview('record_opt_in')); const e = await managerEvidence();
    await a.query('begin');
    await a.query(`select public.dekez_collection_ingest_contact_event(${q(company)},'FALCON-D9NS9','management-stop','msg-management-stop','60188702371','stop',clock_timestamp())`);
    const pending = b.json(digestClaim(e)); await blocked(b, a, 'management STOP checked after exact phone lock');
    await a.query('commit'); const result = await pending;
    assert.deepEqual(result, { claimed: false, state: 'withheld' });
    assert.equal(Number(await control.query('select count(*) from dekez_collections_private.failure_reports')), 0);
    return { result, staleAuthorizationRejected: true, backendPids: [a.pid, b.pid] };
  });
  await check('public management claim rechecks the fingerprint and company authorization after an independent lock wait', async () => {
    await reset(); await snapshot(); await workerFixture('complete');
    await a.query(managerReview('verify_ownership')); await a.query(managerReview('record_opt_in')); const e = await managerEvidence();
    const publicClaim = fingerprint => `select public.dekez_collection_failure_claim(${q(company)},${q(fingerprint)},'SYNTHETIC summary',${q(JSON.stringify(digestSnapshot(e)))}::jsonb)`;
    const hour = Number(await control.query("select extract(hour from clock_timestamp() at time zone 'Asia/Kuala_Lumpur')"));
    const stale = await a.json(publicClaim('00000000000000000000000000000000'));
    assert.deepEqual(stale, { claimed: false, state: hour < 9 ? 'before_daily_review' : 'source_changed' });
    if (hour < 9) return { stale, concurrentPublicScopeTested: false, limitation: 'Actual local time is before the public management-report window; no clock override used.' };
    const gate = await fresh('management-authorization-lock-gate');
    await gate.query("begin;select pg_advisory_xact_lock(hashtextextended('dekez-collection:60188702371',0))");
    const pending = b.json(publicClaim(e.fingerprint)); await blocked(b, gate, 'fresh company authorization after waiting phone lock');
    await control.query(`update company_users set status='suspended' where id=${q(id(51))}`);
    await gate.query('commit'); gate.close(); const revoked = await pending;
    await control.query(`update company_users set status='active' where id=${q(id(51))}`);
    assert.deepEqual(revoked, { claimed: false, state: 'source_changed' });
    assert.equal(Number(await control.query('select count(*) from dekez_collections_private.failure_reports')), 0);
    return { stale, revoked, concurrentPublicScopeTested: true, providerCalls: 0 };
  });
  await check('independent documented follow-up resolutions serialize without rewriting provider facts or releasing a send', async () => {
    await reset(); const s = await snapshot(); const first = await a.json(claim(s));
    await a.query(`select public.dekez_collection_finish(${q(first.attempt_id)},'accepted','SYNTHETIC-receipt-id',200,null)`);
    await a.json(receipt('followup-native-failed', 'failed'));
    const resolve = actor => `select public.dekez_collection_resolve_followup(${q(company)},${q(actor)},${q(first.attempt_id)},'SYNTHETIC follow-up evidence','SYNTHETIC completed management action')`;
    await denied('service_role', resolve(tenant)); await denied('authenticated', resolve(id(3)));
    await a.query('begin'); const firstResolution = await a.json(resolve(id(3))); assert.equal(firstResolution.state, 'resolved');
    const pending = b.json(resolve(id(3))); await blocked(b, a, 'same follow-up immutable audit decision');
    await a.query('commit'); const replay = await pending; assert.equal(replay.state, 'already_resolved');
    const facts = await control.json(`select row_to_json(r) from (select state,delivery_state,followup_resolved_at is not null as resolved from dekez_collections_private.attempts where id=${q(first.attempt_id)}) r`);
    assert.deepEqual(facts, { state: 'accepted', delivery_state: 'failed', resolved: true });
    assert.equal(Number(await control.query("select count(*) from dekez_collections_private.audit where action='followup_resolved'")), 1);
    assert.equal((await managerEvidence()).items.filter(x => x.kind === 'attempt').length, 0);
    assert.deepEqual(await b.json(claim(s)), { claimed: false, state: 'duplicate' });
    await b.json(receipt('followup-native-conflicting', 'delivered'));
    const changed = (await managerEvidence()).items.find(x => x.kind === 'attempt');
    assert.equal(changed.data.state, 'unknown'); assert.equal(changed.data.confirmed_failure, false);
    return { firstResolution: firstResolution.state, replay: replay.state, facts, changedProviderEvidenceResurfaces: true, audits: 1, providerCalls: 0 };
  });
  await check('private tables, function ownership and execution privileges deny ordinary callers', async () => {
    const deniedCalls = [];
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const table of privateTables) deniedCalls.push(await denied(role, `select * from dekez_collections_private.${table} limit 1`));
    }
    for (const role of ['anon', 'authenticated']) {
      deniedCalls.push(await denied(role, `select public.dekez_collection_preview(${q(company)},clock_timestamp(),null,50)`));
      deniedCalls.push(await denied(role, `select dekez_collections_private.claim('{}','SYNTHETIC')`));
    }
    const catalog = await control.json("select json_agg(json_build_object('function',p.proname,'owner',r.rolname,'securityDefiner',p.prosecdef,'config',p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='dekez_collections_private'");
    for (const fn of catalog) { assert.equal(fn.owner, 'dekez_collection_executor'); assert.equal(fn.securityDefiner, true); assert(fn.config.includes('search_path=""')); assert(fn.config.includes('row_security=on')); }
    for (const table of privateTables) {
      assert.equal(await control.query(`select relrowsecurity and relforcerowsecurity from pg_class where oid=${q('dekez_collections_private.' + table)}::regclass`), 't');
    }
    return { deniedCalls: deniedCalls.length, allTablesForceRls: true, catalog };
  });
  await check('business records remain unchanged and executor has no business read/write rights', async () => {
    assert.deepEqual(await captureSources(), original);
    for (const table of [...sourceTables, 'user_module_permissions']) for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await control.query(`select has_table_privilege('dekez_collection_executor',${q('public.' + table)},${q(privilege)})`), 'f');
    }
    const deadlocks = Number(await control.query('select deadlocks from pg_stat_database where datname=current_database()')); assert.equal(deadlocks, 0);
    return { unchangedTables: [...sourceTables, 'user_module_permissions'], executorBusinessPrivileges: 'none', providerCalls: 0, deadlocks };
  });
  evidence.status = 'PASS';
}
main().catch(error => { evidence.status = 'FAIL'; evidence.error = error.stack; console.error(error.stack); process.exitCode = 1; }).finally(() => {
  for (const s of clients) s.close();
  if (started || fs.existsSync(path.join(data, 'postmaster.pid'))) {
    try { evidence.shutdown = run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']).trim(); }
    catch (error) { evidence.shutdownError = error.message; process.exitCode = 1; }
  }
  evidence.finishedAt = new Date().toISOString();
  const resultPath = path.join(root, 'native-results.json'); fs.writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log('Evidence: ' + resultPath);
});
