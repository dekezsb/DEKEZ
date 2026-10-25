const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const database=require('./fixtures/chat/database.cjs');
let db,id,conversation;
const migration='supabase/migrations/20261024160904_dekez_chat_tenant_reminders.sql';
const clause='You must sign this agreement on or before 31 October 2026.';
async function run(day='2026-10-24',preview=false) {
 const r=await db.query('select dekez_chat_private.reminder_batch($1::date,$2) as result',[day,preview]);return r.rows[0].result;
}
async function reset() {
 await db.exec(`truncate dekez_chat_private.reminder_deliveries,dekez_chat_private.reminder_runs,dekez_chat_private.agreement_reminder_deadlines;
 delete from dekez_messages where conversation_id='${conversation}';
 update dekez_conversations set status='active',message_count=0 where id='${conversation}';
 update dekez_conversation_participants set unread_count=0,last_read_seq=0 where conversation_id='${conversation}';
 delete from dekez_chat_private.send_limits;
 delete from payments; delete from payment_submissions; delete from tenancy_renewals; delete from tenancy_agreements;
 update tenancies set status='active',checkout_date=null,billing_status='active',tenancy_end_date='2026-10-31';
 update rent_bills set tenancy_id='${id(24)}',status='unpaid',amount=500,paid_amount=0,due_date='2026-10-31',removed_at=null,tenant_facing=true;
 update dekez_chat_private.reminder_control set enabled=true,cursor_day=null,cursor_key=null;
 update dekez_chat_private.members set enabled=true;
 update dekez_chat_private.relationships set status='active';
 reset "request.jwt.claim.sub"; reset "request.jwt.claims";`);
}
async function agreement({signed=false,text=clause}={}) {
 await db.query(`insert into tenancy_agreements(id,tenancy_id,status,term_start_date,term_end_date,version_number,rendered_content,signed_at)
 values($1,$2,$3,'2026-05-01','2026-10-31',1,$4,$5)`,[id(201),id(24),signed?'signed':'pending_signature',text,signed?'2026-05-01':null]);
}
async function deadline(type='ta_signing',text=clause,date='2026-10-31') {
 await db.query(`insert into dekez_chat_private.agreement_reminder_deadlines(agreement_id,reminder_type,deadline,source_clause,agreement_fingerprint,verified_by)
 select id,$2,$3,$4,md5(rendered_content),$5 from tenancy_agreements where id=$1`,[id(201),type,date,text,id(5)]);
}
test.before(async()=>{
 db=await database();id=db.id;
 conversation=await require('./fixtures/chat/reminders.cjs')(db);
});
test.after(async()=>{await db?.close();});
test.beforeEach(reset);

test('7 / 3 / 1 / deadline / overdue use real calendar dates, without intervening stages',async()=>{
 const r=await db.query(`select d::date::text as day,dekez_chat_private.reminder_stage('2026-10-31',d::date) as stage
 from generate_series('2026-10-24'::timestamp,'2026-11-02','1 day') d`);
 assert.deepEqual(r.rows.map(x=>x.stage),['7-day',null,null,null,'3-day',null,'1-day','deadline','overdue','overdue']);
 assert.equal((await db.query(`select dekez_chat_private.reminder_stage('2028-03-01','2028-02-29') as stage`)).rows[0].stage,'1-day');
});
test('preview does not send, create conversations, increment unread, or write delivery state',async()=>{
 const before=(await db.query('select count(*)::int n from dekez_conversations')).rows[0].n;
 const result=await run('2026-10-24',true);assert.equal(result.ready,1,JSON.stringify(result));assert.equal(result.sent,0);
 assert.equal((await db.query('select count(*)::int n from dekez_chat_private.reminder_deliveries')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from dekez_conversations')).rows[0].n,before);
});
test('reminder uses normal Admin chat, trusted label, preview, unread and realtime signal; Admin can reply',async()=>{
 const before=(await db.query('select revision from dekez_chat_signals where user_id=$1',[id(2)])).rows[0].revision;
 const result=await run();assert.equal(result.sent,1);assert.equal(result.failed,0);
 const m=(await db.query('select * from dekez_messages where conversation_id=$1',[conversation])).rows[0];
 assert.equal(m.sender_id,id(5));assert.equal(m.system_label,'DEKEZ Admin');assert.match(m.body,/RM500.00/);assert.match(m.body,/31 Oct 2026/);
 const inbox=await db.rpc(2,'dekez_chat_inbox',{});assert.equal(inbox.data[0].unread_count,1);assert.match(inbox.data[0].preview,/DEKEZ Admin/);
 assert.ok((await db.query('select revision from dekez_chat_signals where user_id=$1',[id(2)])).rows[0].revision>before);
 const reply=await db.rpc(5,'dekez_chat_send',{p_conversation:conversation,p_body:'Please reply if you need help.',p_key:id(900)});assert.equal(reply.error,null);
 assert.equal((await db.rpc(2,'dekez_chat_read',{p_conversation:conversation,p_seq:2})).error,null);
 assert.equal((await db.rpc(2,'dekez_chat_summary',{})).data[0].unread_count,0);
});
test('retry and later overdue runs never duplicate a source/type/stage',async()=>{
 assert.equal((await run()).sent,1);assert.equal((await run()).already_sent,1);
 assert.equal((await run('2026-10-28')).sent,1);assert.equal((await run('2026-10-30')).sent,1);
 assert.equal((await run('2026-10-31')).sent,1);assert.equal((await run('2026-11-01')).sent,1);
 assert.equal((await run('2026-11-20')).sent,0);
 assert.equal((await db.query('select count(*)::int n from dekez_chat_private.reminder_deliveries')).rows[0].n,5);
});
test('payment on 29 Oct stops 30/31 reminders without changing the invoice',async()=>{
 await run('2026-10-28');await db.exec(`update rent_bills set paid_amount=500,status='paid'`);
 assert.equal((await run('2026-10-30')).sent,0);assert.equal((await run('2026-10-31')).sent,0);
 assert.equal((await db.query('select status from rent_bills')).rows[0].status,'paid');
});
test('partial payment uses remaining amount; confirmed but unsynchronized payment suppresses nag',async()=>{
 await db.exec('update rent_bills set paid_amount=300');assert.equal((await run()).sent,1);
 assert.match((await db.query('select body from dekez_messages where conversation_id=$1',[conversation])).rows[0].body,/Remaining unpaid: RM200.00/);
 await db.query("insert into payments(rent_bill_id,amount,status) values($1,500,'confirmed')",[id(200)]);
 assert.equal((await run('2026-10-28')).sent,0);
});
test('pending verification, cancelled/waived/hidden/removed bills do not receive reminders',async()=>{
 await db.query("insert into payment_submissions(rent_bill_id,verification_status) values($1,'pending_verification')",[id(200)]);
 assert.equal((await run()).sent,0);await db.exec('delete from payment_submissions');
 for(const status of ['paid','cancelled','waived','draft','pending_verification','payment_submitted']) {
  await db.query('update rent_bills set status=$1',[status]);assert.equal((await run()).sent,0,status);
 }
 await db.exec("update rent_bills set status='unpaid',tenant_facing=false");assert.equal((await run()).sent,0);
 await db.exec('update rent_bills set tenant_facing=true,removed_at=now()');assert.equal((await run()).sent,0);
});
test('checkout and ended/terminated tenancy stop all normal reminders',async()=>{
 await agreement({signed:true});await db.exec("update tenancies set checkout_date='2026-10-24'");assert.equal((await run()).sent,0);
 await db.exec("update tenancies set checkout_date=null,status='ended'");assert.equal((await run()).sent,0);
 await db.exec("update tenancies set status='active',billing_status='terminated'");assert.equal((await run()).sent,0);
});
test('no matching existing Admin chat is skipped, never provisioned',async()=>{
 await db.query("update dekez_conversations set status='closed' where id=$1",[conversation]);
 assert.equal((await run()).sent,0);assert.equal((await run()).skipped,1);
 assert.equal((await db.query('select count(*)::int n from dekez_messages where conversation_id=$1',[conversation])).rows[0].n,0);
});
test('revoked or disabled participant still fails existing send authorization',async()=>{
 await db.query('update dekez_chat_private.members set enabled=false where user_id=$1',[id(2)]);
 assert.equal((await run()).sent,0);
 await db.query('update dekez_chat_private.members set enabled=true where user_id=$1',[id(2)]);
 await db.query("update dekez_chat_private.relationships set status='revoked' where id=$1",[id(55)]);
 assert.equal((await run()).sent,0);
});
test('unlinked invoice does not guess tenant identity',async()=>{
 await db.exec('update rent_bills set tenancy_id=null');assert.equal((await run()).sent,0);
});
test('unsigned TA without an actual reviewed signing deadline does not invent one',async()=>{
 await db.exec("update rent_bills set status='paid'");await agreement();assert.equal((await run()).sent,0);
 await deadline();assert.equal((await run()).sent,1);
});
test('signed TA stops all remaining signing stages',async()=>{
 await db.exec("update rent_bills set status='paid'");await agreement();await deadline();assert.equal((await run()).sent,1);
 await db.exec("update tenancy_agreements set signed_at='2026-10-29',status='signed'; update tenancies set tenancy_end_date='2027-04-30'");
 assert.equal((await run('2026-10-30')).sent,0);assert.equal((await run('2026-10-31')).sent,0);
});
test('actual agreement expiry is used; prepared next-term agreement does not imply renewal completed',async()=>{
 await db.exec("update rent_bills set status='paid'");await agreement({signed:true});
 await db.query("insert into tenancy_renewals(tenancy_id,new_start_date,decision_status,renewal_status) values($1,'2026-11-01','pending','pending_signature')",[id(24)]);
 assert.equal((await run()).sent,1);
 const message=(await db.query('select body from dekez_messages where conversation_id=$1',[conversation])).rows[0].body;
 assert.match(message,/Expiry date: 31 Oct 2026/);assert.doesNotMatch(message,/will.*renew/i);
});
test('completed renew/not-renew decision stops expiry and renewal deadline reminders',async()=>{
 await db.exec("update rent_bills set status='paid'");await agreement({signed:true});
 await db.query("insert into tenancy_renewals(tenancy_id,new_start_date,decision_status,renewal_status) values($1,'2026-11-01','renew','renewal_approved')",[id(24)]);
 assert.equal((await run()).sent,0);
 await db.exec("update tenancy_renewals set decision_status='not_renew',renewal_status='not_renewing'");assert.equal((await run()).sent,0);
});
test('auto-renew warning quotes verified actual clause, never changes dates or auto-renews',async()=>{
 const rule='This tenancy will automatically renew for six months if written notice is not received by 31 October 2026.';
 await db.exec("update rent_bills set status='paid'");await agreement({signed:true,text:rule});await deadline('auto_renewal',rule);
 assert.equal((await run()).sent,2); // separate actual expiry and notice types
 const rows=(await db.query('select body from dekez_messages where conversation_id=$1',[conversation])).rows;
 assert.ok(rows.some(x=>x.body.includes(rule)));
 assert.equal((await db.query('select tenancy_end_date::text as date from tenancies')).rows[0].date,'2026-10-31');
 assert.equal((await db.query('select count(*)::int n from tenancy_renewals')).rows[0].n,0);
});
test('non-automatic agreement, fabricated quote and stale agreement version cannot create warnings',async()=>{
 await agreement({text:'Renewal is not automatic. '+clause});
 await assert.rejects(deadline('auto_renewal',clause),/does not support/);
 await assert.rejects(deadline('ta_signing','A deadline that does not exist in the actual saved agreement.'),/exact saved/);
 await deadline();await db.exec("update tenancy_agreements set rendered_content='Changed authoritative agreement'");
 await db.exec("update rent_bills set status='paid'");assert.equal((await run()).sent,0);
});
test('message failure rolls back delivery ledger, counters and restores identity',async()=>{
 await db.query('insert into dekez_chat_private.send_limits values($1,now(),60)',[id(5)]);
 const r=await run();assert.equal(r.failed,1);assert.equal(r.sent,0);
 assert.equal((await db.query('select count(*)::int n from dekez_chat_private.reminder_deliveries')).rows[0].n,0);
 assert.equal((await db.query("select nullif(current_setting('request.jwt.claim.sub',true),'') as sub")).rows[0].sub,null);
 await db.exec('delete from dekez_chat_private.send_limits');assert.equal((await run()).sent,1);
});
test('ordinary users cannot invoke worker, view sources/ledger, configure terms, or forge system labels',async()=>{
 for(const actor of [1,2,3,4,5]) {
  assert.ok((await db.rpc(actor,'dekez_chat_reminders',{p_preview:false})).error);
  await assert.rejects(db.as(actor,'select * from dekez_chat_private.reminder_sources'),/permission denied/);
  await assert.rejects(db.as(actor,'select * from dekez_chat_private.reminder_deliveries'),/permission denied/);
 }
 await run();await assert.rejects(db.as(2,"update dekez_messages set system_label='DEKEZ Admin' where conversation_id=$1",[conversation]),/permission denied/);
 assert.ok((await db.rpc(7,'dekez_chat_history',{p_conversation:conversation})).error);
});
test('database switch is disabled by default and service entry rejects missing trusted role',async()=>{
 assert.match(fs.readFileSync(migration,'utf8'),/enabled boolean not null default false/);
 await db.exec('update dekez_chat_private.reminder_control set enabled=false');assert.equal((await run()).disabled,true);
 assert.ok((await db.rpc(5,'dekez_chat_reminders',{p_preview:false},true)).error);
});
test('real scheduled entry derives Malaysia date and ignores caller date/sender identities',async()=>{
 await db.exec(`set role service_role; set "request.jwt.claims"='{"role":"service_role"}';`);
 try {
  const r=await db.query('select public.dekez_chat_reminders(true) as result');
  assert.equal(r.rows[0].result.day,(await db.query("select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date::text as day")).rows[0].day);
 } finally {await db.exec('reset role; reset "request.jwt.claims"');}
});
test('migration changes no WhatsApp/accounting sources, chat policies or permissions',()=>{
 const sql=fs.readFileSync(migration,'utf8');
 assert.doesNotMatch(sql,/\b(?:insert into|update|delete from|alter table) public\.(?:rent_bills|payments|tenancies|tenancy_agreements|tenancy_renewals|whatsapp_\w+)/i);
 assert.doesNotMatch(sql,/create (?:or replace )?(?:policy|function dekez_chat_private\.(?:can_start|can_read|valid_pair|send)\()/i);
});

test('bounded batches advance past missing conversations and do not starve later sources',async()=>{
 await db.query(`insert into rent_bills(id,tenancy_id,tenant_id,property_id,room_id,due_date,amount,paid_amount,status,tenant_facing,invoice_number)
 select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,tenancy_id,tenant_id,property_id,room_id,due_date,amount,paid_amount,status,tenant_facing,'PAGING-'||n
 from rent_bills cross join generate_series(1000,1050) n where id=$1`,[id(200)]);
 try {
  await db.query("update dekez_conversations set status='closed' where id=$1",[conversation]);
  const first=await run();assert.equal(first.examined,50);assert.equal(first.more,true);assert.equal(first.skipped,50);
  const next=await run();assert.equal(next.examined,2);assert.equal(next.more,false);
  assert.equal((await db.query('select cursor_key from dekez_chat_private.reminder_control')).rows[0].cursor_key,null);
 } finally {await db.exec("delete from rent_bills where invoice_number like 'PAGING-%'");}
});

test('committed dedupe row and message cannot diverge; unique stage is enforced by database',async()=>{
 await run();
 await assert.rejects(db.query(`insert into dekez_chat_private.reminder_deliveries(tenant_id,tenancy_id,invoice_id,source_key,reminder_type,stage,deadline,message_id,conversation_id,sender_id)
 select tenant_id,tenancy_id,invoice_id,source_key,reminder_type,stage,deadline,message_id,conversation_id,sender_id from dekez_chat_private.reminder_deliveries`),/duplicate key/);
 assert.equal((await db.query(`select count(*)::int n from dekez_chat_private.reminder_deliveries d
 join dekez_messages m on m.id=d.message_id and m.conversation_id=d.conversation_id and m.sender_id=d.sender_id`)).rows[0].n,1);
});
