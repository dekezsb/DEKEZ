const { PGlite } = require('@electric-sql/pglite');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const migration = 'supabase/migrations/20261023174901_dekez_in_app_chat_foundation.sql';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db, conversation, caseId, message;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
async function asUser(n, work) {
  await db.exec(`set role authenticated; set test.uid='${id(n)}'`);
  try { return await work(); } finally { await db.exec('reset role; reset test.uid'); }
}
const open = (user, grant) => asUser(user, () => query('select dekez_chat_open($1) id', [id(grant)]));
const send = (user, conv, text, key) => asUser(user, () => query('select (dekez_chat_send($1,$2,$3)).*', [conv, text, id(key)]));
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key,role text,registration_status text default 'approved',full_name text default 'Test participant');
    create table properties(id uuid primary key,name text default 'Test property');
    create table rooms(id uuid primary key);
    create table tenancies(id uuid primary key);
    create table maintenance_tickets(id uuid primary key,property_id uuid,room_id uuid,status text,ticket_number text default 'TEST-JOB');
    create table maintenance_ticket_assignments(ticket_id uuid,assigned_to uuid,status text);
    insert into profiles(id,role) values
      ('${id(1)}','client_owner'),('${id(2)}','tenant'),('${id(3)}','admin'),
      ('${id(4)}','contractor_preview'),('${id(5)}','super_admin'),('${id(6)}','admin'),
      ('${id(7)}','client_owner'),('${id(8)}','contractor_preview'),('${id(9)}','tenant');
    insert into properties(id) values('${id(20)}'),('${id(21)}');
    insert into maintenance_tickets(id,property_id,room_id,status) values('${id(30)}','${id(20)}',null,'in_progress'),('${id(31)}','${id(21)}',null,'assigned');
    insert into maintenance_ticket_assignments values('${id(30)}','${id(4)}','accepted'),('${id(31)}','${id(8)}','assigned');`);
  await db.exec(fs.readFileSync(migration, 'utf8'));
  // Trusted synthetic authorizations only: never seeded into production.
  await db.exec(`insert into dekez_chat_private.members(user_id,profile_role,chat_role,enabled,support_enabled,approved_by)
    select id,role,case role when 'client_owner' then 'owner' when 'tenant' then 'tenant' when 'admin' then 'management'
      when 'super_admin' then 'admin' else 'contractor' end,true,id='${id(6)}','${id(5)}' from profiles;
    insert into dekez_chat_private.scopes(id,kind,property_id,maintenance_ticket_id) values
      ('${id(40)}','property','${id(20)}',null),('${id(41)}','maintenance','${id(20)}','${id(30)}'),
      ('${id(42)}','maintenance','${id(21)}','${id(31)}');
    insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason) values
      ('${id(50)}','${id(40)}','${id(1)}','${id(2)}','${id(5)}','Forbidden pair fixture'),
      ('${id(51)}','${id(40)}','${id(1)}','${id(3)}','${id(5)}','Property management contact'),
      ('${id(52)}','${id(40)}','${id(2)}','${id(3)}','${id(5)}','Property management contact'),
      ('${id(53)}','${id(41)}','${id(2)}','${id(4)}','${id(5)}','Explicit active job tenant contact'),
      ('${id(54)}','${id(42)}','${id(7)}','${id(8)}','${id(5)}','Separate authorized job'),
      ('${id(55)}','${id(40)}','${id(1)}','${id(4)}','${id(5)}','Contractor cannot use permanent property scope');`);
});
test.after(async () => db?.close());

test('Owner–Tenant creation is blocked in both directions, even with a forged relationship', async () => {
  for (const n of [1,2]) await assert.rejects(open(n,50), /not authorized/);
});
test('authorized Tenant–Management and Owner–Management work', async () => {
  assert.ok((await open(1,51))[0].id);
  assert.ok((await open(2,52))[0].id);
});
test('active assigned contractor can chat, reply, and retry idempotently', async () => {
  conversation = (await open(2,53))[0].id;
  assert.equal((await open(4,53))[0].id, conversation);
  message = (await send(2,conversation,'Please inspect the leak',100))[0];
  assert.equal((await send(2,conversation,'Please inspect the leak',100))[0].id,message.id);
  await assert.rejects(send(2,conversation,'Changed retry',100), /retry/);
  assert.equal((await send(4,conversation,'I will inspect it',101))[0].seq,2);
});
test('unrelated owner, contractor, tenant and ordinary Admin cannot read or send', async () => {
  for (const n of [1,5,7,8,9]) {
    assert.equal((await asUser(n,()=>query('select * from dekez_messages where conversation_id=$1',[conversation]))).length,0);
    await assert.rejects(send(n,conversation,'Unauthorized',102), /unavailable/);
  }
  await assert.rejects(open(4,54),/not authorized/);
  await assert.rejects(open(4,55),/not authorized/);
});

test('conversation detail and contact labels expose only an authorized participant scope', async () => {
  const detail=await asUser(4,()=>query('select * from dekez_chat_detail($1)',[conversation]));
  assert.equal(detail[0].contact_name,'Test participant');
  assert.equal(detail[0].property_name,'Test property');
  assert.equal(detail[0].ticket_number,'TEST-JOB');
  assert.equal(detail[0].status,'active');
  for(const n of [1,5,7,8,9]) await assert.rejects(asUser(n,()=>query('select * from dekez_chat_detail($1)',[conversation])),/unavailable/);
});
test('no global contact directory and no raw writes or self-granted access', async () => {
  const contacts=await asUser(4,()=>query('select * from dekez_chat_contacts()'));
  assert.deepEqual(contacts.map(c=>c.relationship_id),[id(53)]);
  for(const table of ['dekez_chat_private.members','dekez_chat_private.relationships','dekez_chat_private.audit'])
    await assert.rejects(asUser(4,()=>query(`select * from ${table}`)),/permission denied/);
  await assert.rejects(asUser(4,()=>query('update dekez_conversation_participants set unread_count=0')),/permission denied/);
  await assert.rejects(asUser(4,()=>query('delete from dekez_messages')),/permission denied/);
});
test('read receipts are monotonic, bounded and only change the caller', async () => {
  let inbox=await asUser(2,()=>query('select * from dekez_chat_inbox()'));
  assert.equal(inbox.find(c=>c.conversation_id===conversation).unread_count,1);
  await asUser(2,()=>query('select dekez_chat_read($1,2)',[conversation]));
  await asUser(2,()=>query('select dekez_chat_read($1,1)',[conversation]));
  await assert.rejects(asUser(2,()=>query('select dekez_chat_read($1,999)',[conversation])),/Invalid read/);
  const rows=await query('select user_id,last_read_seq,unread_count from dekez_conversation_participants where conversation_id=$1',[conversation]);
  assert.equal(rows.find(r=>r.user_id===id(2)).last_read_seq,2);
  assert.equal(rows.find(r=>r.user_id===id(4)).unread_count,1);
});
test('support report validates evidence; only assigned staff can read selected messages and every view is audited', async () => {
  const other=(await open(7,54))[0].id;
  const unrelated=(await send(7,other,'Private elsewhere',103))[0];
  await assert.rejects(asUser(2,()=>query("select dekez_chat_report($1,'other','Please help',$2,'{}')",[conversation,[unrelated.id]])),/Evidence/);
  caseId=(await asUser(2,()=>query("select dekez_chat_report($1,'other','Please review this message',$2,'{}') id",[conversation,[message.id]])))[0].id;
  await assert.rejects(asUser(6,()=>query('select dekez_chat_evidence($1,$2,$3)',[caseId,message.id,'Investigate report'])),/not authorized/);
  await query("update dekez_support_cases set assigned_to=$1,access_until=now()+interval '1 hour',status='under_review' where id=$2",[id(6),caseId]);
  await asUser(6,()=>query('select dekez_chat_evidence($1,$2,$3)',[caseId,message.id,'Investigate report']));
  await asUser(6,()=>query('select dekez_chat_evidence($1,$2,$3)',[caseId,message.id,'Review again']));
  assert.equal((await query("select * from dekez_chat_private.audit where action='support_message_view'")).length,2);
  assert.equal((await asUser(6,()=>query('select * from dekez_messages'))).length,0);
  await assert.rejects(asUser(6,()=>query('select dekez_chat_evidence($1,$2,$3)',[caseId,unrelated.id,'Investigate report'])),/not authorized/);
});
test('resolved/closed support cases immediately revoke evidence access', async () => {
  for(const status of ['resolved','closed']) {
    await query('update dekez_support_cases set status=$1 where id=$2',[status,caseId]);
    await assert.rejects(asUser(6,()=>query('select dekez_chat_evidence($1,$2,$3)',[caseId,message.id,'Investigate report'])),/not authorized/);
  }
});

test('support dispatcher sees metadata only; assignment, views and closure are auditable and scoped', async () => {
  const reported=(await asUser(2,()=>query("select dekez_chat_report($1,'other','Private reporter explanation',$2,'{}') id",[conversation,[message.id]])))[0].id;
  await assert.rejects(asUser(5,()=>query('select * from dekez_chat_support_queue()')),/not authorized/);
  await query('update dekez_chat_private.members set support_dispatcher=true where user_id=$1',[id(5)]);
  const queue=await asUser(5,()=>query('select * from dekez_chat_support_queue()'));
  assert.ok(queue.some(c=>c.case_id===reported));
  assert.ok(queue.every(c=>!('body' in c)&&!('explanation' in c)));
  await assert.rejects(asUser(5,()=>query('select dekez_chat_support_manifest($1,$2)',[reported,'Dispatch review'])),/not authorized/);
  assert.equal((await asUser(5,()=>query('select * from dekez_support_cases where id=$1',[reported]))).length,0);
  await assert.rejects(asUser(6,()=>query('select dekez_chat_support_assign($1,$2,60,$3)',[reported,id(6),'Self assignment'])),/not authorized/);
  await assert.rejects(asUser(5,()=>query('select dekez_chat_support_assign($1,$2,60,$3)',[reported,id(4),'Invalid contractor'])),/not authorized/);
  await assert.rejects(asUser(5,()=>query('select dekez_chat_support_assign($1,$2,1441,$3)',[reported,id(6),'Excessive duration'])),/access window/);
  await asUser(5,()=>query('select dekez_chat_support_assign($1,$2,60,$3)',[reported,id(6),'Investigate selected evidence']));
  assert.equal((await asUser(6,()=>query('select * from dekez_support_cases where id=$1',[reported]))).length,0,'report explanation requires audited RPC');
  const manifest=(await asUser(6,()=>query('select dekez_chat_support_manifest($1,$2) value',[reported,'Investigate selected evidence'])))[0].value;
  assert.equal(manifest.explanation,'Private reporter explanation');
  assert.deepEqual(manifest.messages.map(m=>m.id),[message.id]);
  assert.ok(manifest.messages.every(m=>!('body' in m)));
  await asUser(6,()=>query('select dekez_chat_support_status($1,$2,$3)',[reported,'closed','Issue resolved with reporter']));
  for(const sql of ['select dekez_chat_support_manifest($1,$2)','select dekez_chat_evidence($1,$3,$2)']) {
    const args=sql.includes('$3')?[reported,'Another evidence view',message.id]:[reported,'Another evidence view'];
    await assert.rejects(asUser(6,()=>query(sql,args)),/not authorized/);
  }
  await assert.rejects(asUser(5,()=>query('select dekez_chat_support_status($1,$2,$3)',[reported,'under_review','Cannot reopen closed case'])),/Invalid/);
  await assert.rejects(asUser(5,()=>query('select dekez_chat_support_assign($1,$2,60,$3)',[reported,id(6),'Cannot extend closed case'])),/no longer/);
  assert.equal((await query('select access_until from dekez_support_cases where id=$1',[reported]))[0].access_until,null);
  const actions=(await query('select action from dekez_chat_private.audit where record_id=$1',[reported])).map(r=>r.action);
  for(const action of ['support_requested','support_assigned','support_report_view','support_status_changed'])assert.ok(actions.includes(action));
  await query('update dekez_chat_private.members set support_dispatcher=false where user_id=$1',[id(5)]);
});
test('history loads at most 50 with non-overlapping older pages', async () => {
  await db.exec(`insert into dekez_messages(conversation_id,sender_id,seq,client_key,body)
    select '${conversation}','${id(4)}',g,gen_random_uuid(),'Historical message '||g from generate_series(3,2002) g;
    update dekez_conversations set message_count=2002 where id='${conversation}';`);
  const latest=await asUser(2,()=>query('select * from dekez_chat_history($1)',[conversation]));
  assert.equal(latest.length,40); assert.equal(latest[0].seq,2002);
  const older=await asUser(2,()=>query('select * from dekez_chat_history($1,$2,9999)',[conversation,latest.at(-1).seq]));
  assert.equal(older.length,50); assert.ok(older[0].seq<latest.at(-1).seq);
});
test('completed job closes chat, blocks direct RPC, preserves history and removes contact', async () => {
  await query("update maintenance_tickets set status='completed' where id=$1",[id(30)]);
  assert.equal((await query('select status from dekez_conversations where id=$1',[conversation]))[0].status,'closed');
  await assert.rejects(send(4,conversation,'After completion',104),/closed/);
  assert.equal((await asUser(2,()=>query('select * from dekez_chat_history($1)',[conversation]))).length,40);
  assert.equal((await asUser(4,()=>query('select * from dekez_chat_contacts()'))).length,0);
  await query("update maintenance_tickets set status='in_progress' where id=$1",[id(30)]);
  await assert.rejects(send(2,conversation,'Do not reopen old chat',105),/closed/);
});
test('new job with same people requires a new grant and creates a separate chat', async () => {
  await db.exec(`insert into maintenance_tickets(id,property_id,room_id,status) values('${id(32)}','${id(20)}',null,'in_progress');
    insert into maintenance_ticket_assignments values('${id(32)}','${id(4)}','accepted');
    insert into dekez_chat_private.scopes(id,kind,property_id,maintenance_ticket_id) values('${id(43)}','maintenance','${id(20)}','${id(32)}');
    insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason)
    values('${id(56)}','${id(43)}','${id(2)}','${id(4)}','${id(5)}','New job explicit authorization');`);
  const fresh=(await open(2,56))[0].id;
  assert.notEqual(fresh,conversation);
  await send(4,fresh,'New job only',106);
  await query("update maintenance_ticket_assignments set status='cancelled' where ticket_id=$1",[id(32)]);
  await assert.rejects(send(4,fresh,'Cancelled',107),/closed/);
  assert.equal((await asUser(4,()=>query('select * from dekez_chat_history($1)',[fresh]))).length,1);
});
test('migration never touches WhatsApp, authentication, financial tables or existing API guards', () => {
  const sql=fs.readFileSync(migration,'utf8');
  assert.doesNotMatch(sql,/\b(?:whatsapp_messages|whatsapp_conversations|rent_bills|payments|auth\.users|pgrst\.db_pre_request)\b/);
});
test('anonymous users have no chat table or RPC access',async()=>{
 await db.exec('set role anon');
 try {
   await assert.rejects(query('select * from dekez_messages'),/permission denied/);
   await assert.rejects(query('select dekez_chat_open($1)',[id(51)]),/permission denied/);
 } finally {await db.exec('reset role');}
});
test('an Admin can chat only when explicitly enrolled as a participant',async()=>{
 await db.exec(`insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason)
 values('${id(57)}','${id(42)}','${id(5)}','${id(8)}','${id(5)}','Explicit administrator job contact');`);
 const own=(await open(5,57))[0].id;
 await send(5,own,'Admin participating in own conversation',108);
 assert.equal((await asUser(5,()=>query('select * from dekez_chat_history($1)',[own]))).length,1);
 await assert.rejects(asUser(5,()=>query('select * from dekez_chat_history($1)',[conversation])),/unavailable/);
});
test('expired grants deny sending and contacts while retaining participant history',async()=>{
 const own=(await open(1,51))[0].id;
 await send(1,own,'Before expiry',109);
 await query("update dekez_chat_private.relationships set expires_at=now()-interval '1 second' where id=$1",[id(51)]);
 await assert.rejects(send(1,own,'After expiry',110),/closed/);
 assert.equal((await asUser(1,()=>query('select * from dekez_chat_history($1)',[own]))).length,1);
 assert.equal((await asUser(1,()=>query('select * from dekez_chat_inbox()')))[0].status,'closed');
 await query("update dekez_chat_private.relationships set status='revoked' where id=$1",[id(51)]);
 await assert.rejects(asUser(1,()=>query('select * from dekez_chat_history($1)',[own])),/unavailable/);
});
test('profile role changes invalidate existing chat capabilities',async()=>{
 const own=(await open(2,52))[0].id;
 await query("update profiles set role='client_owner' where id=$1",[id(2)]);
 await assert.rejects(send(2,own,'Changed role',111),/unavailable/);
 await query("update profiles set role='tenant' where id=$1",[id(2)]);
});
test('database rate limit prevents burst sends and resets after its window',async()=>{
 const own=(await open(2,52))[0].id;
 await query("update dekez_chat_private.send_limits set sent=60,window_started_at=now() where user_id=$1",[id(2)]);
 await assert.rejects(send(2,own,'Rate limited',112),/Please wait/);
 await query("update dekez_chat_private.send_limits set window_started_at=now()-interval '2 minutes' where user_id=$1",[id(2)]);
 assert.ok((await send(2,own,'After limit reset',112))[0].id);
});
