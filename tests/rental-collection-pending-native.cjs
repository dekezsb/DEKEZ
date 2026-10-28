// Optional synthetic localhost PostgreSQL evidence. No external DB URL, .env,
// production credentials, provider requests or live tenant data are accepted.
// node tests/rental-collection-pending-native.cjs --pg-bin <bin> --output-dir <artifacts>
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const net = require('node:net'), assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const option = name => {const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1];};
const pg = option('--pg-bin'), output = option('--output-dir');
if (!pg || !output) throw Error('Explicit localhost binary and artifact paths required');
const repo = path.resolve(__dirname, '..'), root = path.resolve(output);
fs.mkdirSync(root, {recursive: true});
const work = fs.mkdtempSync(path.join(root, 'isolated-')), data = path.join(work, 'cluster');
const passfile = path.join(work, 'ephemeral-init-password'), password = crypto.randomBytes(32).toString('hex');
const evidence = {startedAt: new Date().toISOString(), providerCalls: 0,
  scope: 'Synthetic localhost only, unmodified migrations, independent PostgreSQL sessions; no production access.',
  migrations: [], tests: [], waits: []};
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const binary = name => path.join(path.resolve(pg), name + (process.platform === 'win32' ? '.exe' : ''));
let port, started = false, observer, a, b;
const clients = new Set();
const args = () => ['-h', '127.0.0.1', '-p', String(port), '-U', 'local_review', '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
function env() {
  const result = {...process.env};
  for (const key of Object.keys(result)) if (key.startsWith('PG')) delete result[key];
  return {...result, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5', PGHOST: '127.0.0.1', PGPORT: String(port), PGDATABASE: 'postgres', PGUSER: 'local_review'};
}
function run(name, argv, options = {}) {
  const r = spawnSync(binary(name), argv, {encoding: 'utf8', windowsHide: true, timeout: 60000, ...options});
  if (r.status !== 0) throw Error(name + ' failed: ' + (r.stderr || r.stdout || r.error));
  return r.stdout;
}
class Session {
  constructor(name) {
    this.name = name; this.out = ''; this.err = ''; this.pending = null;
    this.child = spawn(binary('psql'), args(), {env: env(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    clients.add(this);
    this.child.stdout.on('data', x => {this.out += x.toString(); this.flush();});
    this.child.stderr.on('data', x => {this.err += x.toString();});
    this.child.on('close', () => {clients.delete(this); if (this.pending) {this.pending.reject(Error(this.err || 'Session closed')); this.pending = null;}});
    this.child.on('error', error => {if (this.pending) {this.pending.reject(error); this.pending = null;}});
  }
  flush() {
    const p = this.pending; if (!p) return;
    const at = this.out.indexOf(p.marker); if (at < 0) return;
    const result = this.out.slice(0, at).trim();
    this.out = this.out.slice(at + p.marker.length).replace(/^\r?\n/, '');
    this.pending = null; p.resolve(result);
  }
  query(sql) {
    assert.equal(this.pending, null);
    const marker = 'END_' + crypto.randomBytes(10).toString('hex');
    return new Promise((resolve, reject) => {
      this.pending = {marker, resolve, reject};
      this.child.stdin.write(sql + `;\nselect '${marker}';\n`); this.flush();
    });
  }
  async json(sql) {return JSON.parse(await this.query(sql));}
  close() {if (!this.child.killed) this.child.stdin.end('\\q\n');}
}
async function session(name, role = 'service_role') {
  const s = new Session(name); if (role) await s.query('set role ' + role);
  s.pid = Number(await s.query('select pg_backend_pid()')); return s;
}
async function test(name, callback) {
  const t = Date.now();
  try {const details = await callback(); evidence.tests.push({name, status: 'PASS', durationMs: Date.now() - t, ...details}); console.log('PASS ' + name);}
  catch (e) {evidence.tests.push({name, status: 'FAIL', error: e.message}); throw e;}
}
async function blocked(waiter, holder, scenario) {
  for (let i = 0; i < 60; i++) {
    const x = await observer.json(`select row_to_json(x) from (select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${waiter.pid}) x`);
    if (x.wait_event_type === 'Lock' && x.blockers.includes(holder.pid)) {evidence.waits.push({scenario, blockerPid: holder.pid, ...x}); return;}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error('Independent-session wait not observed: ' + scenario);
}
const scope = id(1), tenant = id(4), admin = id(3), manager = id(50);
const submit = (request, actor = admin, notes = 'Synthetic tenant evidence, never actual consent', company = scope) =>
  `select public.dekez_collection_submit_evidence(${q(company)},${q(actor)},${q(tenant)},${q(id(request))},'consent_evidence','2026-10-27','in_person','Synthetic evidence reference',${q(notes)},null)`;
const review = (request, decision = 'reviewed', actor = admin) =>
  `select public.dekez_collection_review_evidence(${q(scope)},${q(actor)},${q(id(request))},${q(decision)},'Synthetic disposition only')`;
const count = (request, action) => observer.json(`select count(*)::int from dekez_collections_private.audit where company_id=${q(scope)} and record_id=${q(id(request))} and action=${q(action)}`);
const lock = request => `select pg_advisory_xact_lock(hashtextextended('collection-evidence:'||${q(scope)}::text||':'||${q(id(request))}::text,0))`;
async function reject(sql, pattern = /42501|permission|Super Admin|immutable|already used|changed/i, role = 'service_role') {
  const s = await session('negative', role);
  try {await assert.rejects(s.query(sql), pattern); return {pid: s.pid, rejected: true};} finally {s.close();}
}
async function sources() {
  const tables = ['companies','profiles','company_users','properties','rooms','tenants','tenancies','tenant_records','rent_bills','rental_invoice_line_items','payments','payment_submissions','whatsapp_conversations','rent_reminder_logs'];
  const result = {};
  for (const table of tables) result[table] = await observer.json(`select coalesce(json_agg(t order by id),'[]') from public.${table} t`);
  result.user_module_permissions = await observer.json("select coalesce(json_agg(t order by profile_id,module_key),'[]') from public.user_module_permissions t");
  return result;
}
async function main() {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  fs.writeFileSync(passfile, password, {mode: 0o600});
  try {run('initdb', ['-D', data, '-U', 'local_review', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--pwfile=' + passfile, '--encoding=UTF8', '--locale=C']);}
  finally {fs.unlinkSync(passfile);}
  run('pg_ctl', ['-D', data, '-l', path.join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=20 -c log_lock_waits=on -c deadlock_timeout=100ms`, '-w', 'start'], {stdio: 'ignore'});
  started = true; observer = await session('observer', null);
  evidence.server = await observer.json("select json_build_object('version',version(),'listen_addresses',current_setting('listen_addresses'),'port',current_setting('port'),'pid',pg_backend_pid())");
  const fixture = fs.readFileSync(path.join(repo, 'tests/fixtures/rental-collection.cjs'), 'utf8');
  const from = fixture.indexOf(' create table companies('), to = fixture.indexOf('`);', from);
  assert(from > 0 && to > from);
  const fixtureSql = Function('id', 'return `' + fixture.slice(from, to) + '`')(id);
  await observer.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create role fixture_migrator nologin createrole createdb bypassrls;
    grant usage,create on schema public to fixture_migrator;grant create on database postgres to fixture_migrator;
    set role fixture_migrator;${fixtureSql};reset role`);
  for (const filename of ['20261028025857_rental_collection_review.sql','20261028091044_rental_collection_pending_evidence.sql']) {
    const sql = fs.readFileSync(path.join(repo, 'supabase/migrations', filename));
    run('psql', args(), {env: env(), input: Buffer.concat([Buffer.from('set role fixture_migrator;\n'), sql])});
    evidence.migrations.push({filename, sha256: crypto.createHash('sha256').update(sql).digest('hex'), unmodified: true, migrationRole: 'fixture_migrator (non-superuser)'});
  }
  await observer.query(`insert into profiles values(${q(manager)},'Synthetic management collector','60188702371','admin','approved');
    insert into company_users values(${q(id(51))},${q(scope)},${q(manager)},${q(manager)},'admin','active');
    insert into user_module_permissions values(${q(manager)},'rent_due_tracker','manage'),(${q(manager)},'admin_setup','none')`);
  const original = await sources();
  a = await session('caller-a'); b = await session('caller-b');
  evidence.callerPids = [a.pid, b.pid]; assert.notEqual(a.pid, b.pid);
  await test('ordinary roles and direct service table access remain denied', async () => {
    const rls = await observer.json("select json_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity) from pg_class where oid='dekez_collections_private.audit'::regclass");
    assert.deepEqual(rls, {enabled: true, forced: true});
    for (const role of ['anon','authenticated','service_role']) await reject('select * from dekez_collections_private.audit', /42501|permission denied/, role);
    for (const role of ['anon','authenticated']) await reject(submit(100), /42501|permission denied/, role);
    const f = await observer.json("select json_agg(json_build_object('name',p.proname,'private',n.nspname='dekez_collections_private','definer',p.prosecdef,'config',p.proconfig,'owner',pg_get_userbyid(p.proowner),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('submit_evidence','get_evidence','list_evidence','review_evidence','dekez_collection_evidence_tenant','dekez_collection_submit_evidence','dekez_collection_list_evidence','dekez_collection_review_evidence')");
    assert.equal(f.length, 8);
    for (const x of f) {assert.equal(x.anon, false); assert.equal(x.authenticated, false); assert(x.config.includes('search_path=""')); assert.equal(x.definer,x.private); if (x.private) {assert.equal(x.owner,'dekez_collection_executor'); assert(x.config.includes('row_security=on'));}}
    return {functions: f.length, rls};
  });
  await test('management can submit evidence but cannot self-approve or grant consent', async () => {
    assert.equal((await a.json(submit(101, manager))).state,'pending');
    await reject(review(101, 'reviewed', manager));
    await reject(submit(102, tenant)); await reject(submit(102, admin, 'Synthetic evidence only', id(2)));
    assert.equal(await count(101,'contact_evidence_reviewed'), 0);
  });
  await test('independent identical submissions append exactly one event', async () => {
    await a.query('begin'); const first = await a.json(submit(110));
    const pending = b.json(submit(110)); await blocked(b,a,'identical submit'); await a.query('commit');
    const second = await pending; assert.equal(first.state,'pending'); assert.equal(second.state,'already_submitted');
    assert.equal(await count(110,'contact_evidence_submitted'),1); return {first,second};
  });
  await test('simultaneous changed request reuse cannot rewrite the first evidence', async () => {
    const second = await session('changed-replay');
    await a.query('begin'); await a.json(submit(111));
    const rejected = assert.rejects(second.query(submit(111,admin,'Different synthetic response should fail')),/already used/);
    await blocked(second,a,'changed submit replay'); await a.query('commit'); await rejected; second.close();
    assert.equal(await count(111,'contact_evidence_submitted'),1);
  });
  await test('rolled-back submission releases reservation for one committed event', async () => {
    await a.query('begin'); await a.json(submit(112)); const pending = b.json(submit(112));
    await blocked(b,a,'submit rollback'); await a.query('rollback'); assert.equal((await pending).state,'pending');
    assert.equal(await count(112,'contact_evidence_submitted'),1);
  });
  await test('independent identical reviews append one immutable disposition', async () => {
    await a.json(submit(120)); await a.query('begin'); const first = await a.json(review(120));
    const pending = b.json(review(120)); await blocked(b,a,'identical review'); await a.query('commit');
    const second = await pending; assert.equal(first.state,'reviewed'); assert.equal(second.state,'already_reviewed');
    assert.equal(await count(120,'contact_evidence_reviewed'),1); return {first,second};
  });
  await test('conflicting concurrent review cannot replace an accepted disposition', async () => {
    await a.json(submit(121)); await a.query('begin'); await a.json(review(121));
    const second = await session('conflicting-review'); const rejected = assert.rejects(second.query(review(121,'rejected')),/immutable/);
    await blocked(second,a,'conflicting review'); await a.query('commit'); await rejected; second.close();
    assert.equal(await count(121,'contact_evidence_reviewed'),1);
  });
  await test('company access revoked during submission lock wait is rechecked', async () => {
    await a.query('begin;' + lock(130)); const second = await session('revoked-submit');
    const rejected = assert.rejects(second.query(submit(130,manager)),/42501|Authorized/);
    await blocked(second,a,'company revoked while waiting');
    await observer.query(`update company_users set status='inactive' where profile_id=${q(manager)}`);
    await a.query('commit'); await rejected; second.close();
    await observer.query(`update company_users set status='active' where profile_id=${q(manager)}`);
    assert.equal(await count(130,'contact_evidence_submitted'),0);
  });
  await test('Super Admin demoted during review wait cannot approve', async () => {
    await a.json(submit(131)); await a.query('begin;' + lock(131)); const second = await session('demoted-review');
    const rejected = assert.rejects(second.query(review(131)),/42501|Super Admin/);
    await blocked(second,a,'Super Admin demoted while waiting');
    await observer.query(`update profiles set role='admin' where id=${q(admin)}`);
    await a.query('commit'); await rejected; second.close();
    await observer.query(`update profiles set role='super_admin' where id=${q(admin)}`);
    assert.equal(await count(131,'contact_evidence_reviewed'),0);
  });
  await test('phone changed during review wait requires fresh evidence', async () => {
    await a.json(submit(132)); await a.query('begin;' + lock(132)); const second = await session('changed-phone');
    const rejected = assert.rejects(second.query(review(132)),/Login number changed/);
    await blocked(second,a,'phone changed while waiting');
    await observer.query(`update profiles set phone='0193333333' where id=${q(tenant)}`);
    await a.query('commit'); await rejected; second.close();
    await observer.query(`update profiles set phone='0191111111' where id=${q(tenant)}`);
    assert.equal(await count(132,'contact_evidence_reviewed'),0);
  });
  await test('five-second lock timeout stops without creating evidence', async () => {
    await a.query('begin;' + lock(140)); const second = await session('timeout');
    const rejected = assert.rejects(second.query(submit(140)),/55P03|lock timeout/);
    await blocked(second,a,'bounded lock timeout'); await rejected; await a.query('rollback'); second.close();
    assert.equal(await count(140,'contact_evidence_submitted'),0);
  });
  await test('all business, authentication identities, consent and outbound records remain unchanged', async () => {
    assert.deepEqual(await sources(),original);
    for (const table of ['controls','contact_controls','number_suppressions','attempts','failure_reports','worker_runs'])
      assert.equal(await observer.json(`select count(*)::int from dekez_collections_private.${table}`),0,table);
    const grants = await observer.json("select json_build_object('create_schema',has_schema_privilege('dekez_collection_executor','dekez_collections_private','CREATE'),'superuser',rolsuper,'bypass',rolbypassrls,'login',rolcanlogin) from pg_roles where rolname='dekez_collection_executor'");
    assert.deepEqual(grants,{create_schema:false,superuser:false,bypass:false,login:false});
    return {unchangedSourceTables:Object.keys(original).length,providerCalls:0};
  });
  evidence.status='PASS';
}
main().catch(error=>{evidence.status='FAIL';evidence.error=error.message;process.exitCode=1;console.error(error.message);}).finally(async()=>{
  for (const client of clients) client.close();
  if (started) {try {evidence.shutdown=run('pg_ctl',['-D',data,'-m','fast','-w','stop']);} catch(error) {evidence.shutdownError=error.message;process.exitCode=1;}}
  evidence.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(root,'native-results.json'),JSON.stringify(evidence,null,2)+'\n');
});
