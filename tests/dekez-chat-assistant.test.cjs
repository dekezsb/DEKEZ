const test=require('node:test'),assert=require('node:assert/strict');
const database=require('./fixtures/chat/database.cjs');
let db,id,conversation,key=4000;
const send=(actor=2,body='When is my rental due?')=>db.rpc(actor,'dekez_chat_send',{p_conversation:conversation,p_body:body,p_key:id(++key)});
const control=(actor,action)=>db.rpc(actor,'dekez_chat_assistant',{p_action:action,p_conversation:conversation});
const inbox=filter=>db.rpc(5,'dekez_chat_inbox',{p_before:null,p_before_id:null,p_limit:25,p_filter:filter});
async function worker(action,args={}) {
 await db.exec(`set "request.jwt.claims"='{"role":"service_role"}'`);
 try { const response=await db.rpc(5,'dekez_chat_assistant',{p_action:action,...args},true);assert.equal(response.error,null,JSON.stringify(response.error));return response.data; }
 finally {await db.exec('reset "request.jwt.claims"');}
}
async function claim(){await db.exec("update dekez_chat_private.assistant_state set due_at=now()-interval '1 second'");return (await worker('claim'))[0];}
async function finish(item,intent='rent_due'){return worker('finish',{p_conversation:item.conversation,p_message:item.message,p_token:item.token,p_intent:intent});}
const history=async()=>(await db.rpc(2,'dekez_chat_history',{p_conversation:conversation,p_limit:40})).data;
test.before(async()=>{db=await database();id=db.id;conversation=await require('./fixtures/chat/reminders.cjs')(db);await require('./fixtures/chat/admin-center.cjs')(db);await require('./fixtures/chat/assistant.cjs')(db);});
test.after(async()=>db?.close());
test.beforeEach(async()=>{
 await db.exec(`truncate dekez_chat_private.assistant_deliveries,dekez_chat_private.assistant_state,dekez_chat_private.reminder_deliveries;
 delete from dekez_messages where conversation_id='${conversation}';delete from dekez_chat_private.send_limits;
 update dekez_conversations set status='active',message_count=0 where id='${conversation}';
 update dekez_conversation_participants set unread_count=0,last_read_seq=0 where conversation_id='${conversation}';
 update dekez_chat_private.assistant_control set enabled=true,office_start=null,office_end=null,office_days=null;
 update tenancies set checkout_date=null,status='active';delete from payment_submissions;delete from payments;delete from tenancy_agreements;
 update rent_bills set amount=500,paid_amount=0,status='unpaid',tenant_facing=true,removed_at=null;
 reset "request.jwt.claim.sub";`);
});
test('disabled assistant queues and sends nothing',async()=>{
 await db.exec('update dekez_chat_private.assistant_control set enabled=false');await send();
 assert.equal((await worker('claim')).disabled,true);assert.equal((await history()).length,1);
});
test('manual reply while disabled still preserves human takeover on later activation',async()=>{
 await db.exec('update dekez_chat_private.assistant_control set enabled=false');await send(5,'I am handling this');
 await db.exec('update dekez_chat_private.assistant_control set enabled=true');await send();
 assert.equal((await control(5,'status')).data.mode,'takeover');assert.equal((await worker('claim')).length,0);
});
test('expired worker lease can retry but cannot create a second reply',async()=>{
 await send();const stale=await claim();await db.exec("update dekez_chat_private.assistant_state set lease_until=now()-interval '1 second'");
 const retry=await claim();assert.notEqual(stale.token,retry.token);assert.equal((await finish(stale)).skipped,true);
 assert.equal((await finish(retry)).sent,true);assert.equal((await finish(retry)).skipped,true);assert.equal((await history()).length,2);
});
test('closed conversations are skipped and removed from the worker queue',async()=>{
 await send();const item=await claim();await db.query("update dekez_conversations set status='closed' where id=$1",[conversation]);
 assert.equal((await finish(item)).skipped,true);await db.exec("update dekez_chat_private.assistant_state set lease_until=now()-interval '1 second'");
 assert.equal((await worker('claim')).length,0);assert.equal((await db.query('select pending_message from dekez_chat_private.assistant_state')).rows[0].pending_message,null);
 assert.equal((await history()).length,1);
});
test('delayed queue, actual due date, assistant label, unread and duplicate prevention',async()=>{
 await send();assert.equal((await worker('claim')).length,0,'wait for human response window');
 const item=await claim();assert.ok(item.token);assert.equal((await worker('claim')).length,0,'lease prevents duplicate workers');
 const result=await finish(item);assert.equal(result.sent,true);assert.equal(result.escalated,false);
 const h=await history();assert.equal(h.length,2);assert.equal(h[0].message_type,'AI_ASSISTANT');assert.equal(h[0].system_label,'DEKEZ Assistant');assert.match(h[0].body,/31 Oct 2026/);
 assert.equal((await finish(item)).skipped,true);assert.equal((await inbox('ai_answered')).data.length,1);assert.equal((await inbox('needs_reply')).data.length,0);
 assert.equal((await db.rpc(2,'dekez_chat_summary',{})).data[0].unread_count,1);
});
test('manual Admin reply cancels queued answer and pauses until explicit re-enable',async()=>{
 await send();const item=await claim();await send(5,'I can help');
 assert.equal((await finish(item)).skipped,true);assert.equal((await control(5,'status')).data.mode,'takeover');
 await send(2,'How much do I need to pay?');assert.equal((await worker('claim')).length,0);
 assert.equal((await inbox('needs_reply')).data.length,1);
 assert.equal((await control(5,'resume')).error,null);await send();assert.ok(await claim());
});
test('newer user message invalidates in-flight answer',async()=>{
 await send();const stale=await claim();await send(2,'I want a refund');assert.equal((await finish(stale)).skipped,true);
 const fresh=await claim();assert.notEqual(fresh.message,stale.message);assert.equal((await finish(fresh,'sensitive')).escalated,true);
});
test('a simple follow-up cannot conceal an earlier unanswered complaint',async()=>{
 await send(2,'I am angry about a charge');await send(2,'When is my rental due?');
 assert.equal((await finish(await claim(),'rent_due')).escalated,true);
 assert.equal((await control(5,'status')).data.needs_admin_reply,true);assert.doesNotMatch((await history())[0].body,/31 Oct/);
});
test('multiple current invoices are escalated rather than choosing one',async()=>{
 await db.query(`insert into rent_bills select $1,tenancy_id,tenant_id,property_id,room_id,due_date,amount,paid_amount,status,tenant_facing,removed_at,'SECOND' from rent_bills limit 1`,[id(209)]);
 try {await send();assert.equal((await finish(await claim())).escalated,true);}finally{await db.query('delete from rent_bills where id=$1',[id(209)]);}
});
test('complaint escalates once; reading does not dismiss Admin follow-up',async()=>{
 await send(2,'I am angry');await finish(await claim(),'complaint');
 assert.equal((await control(5,'status')).data.mode,'escalated');assert.match((await history())[0].body,/Management review/);
 await db.rpc(5,'dekez_chat_read',{p_conversation:conversation,p_seq:2});assert.equal((await inbox('needs_reply')).data.length,1);
 await send(2,'Still angry');assert.equal((await worker('claim')).length,0);assert.equal((await history()).length,3);
 await send(5,'Let us review this');assert.equal((await inbox('needs_reply')).data.length,0);
});
test('outstanding is actual remaining balance and fresh data is rechecked before reply',async()=>{
 await send(2,'How much do I need to pay?');const item=await claim();
 await db.exec('update rent_bills set paid_amount=300');await finish(item,'rent_amount');
 assert.match((await history())[0].body,/RM200.00/);
 assert.equal((await db.query('select amount,paid_amount from rent_bills')).rows[0].amount,'500');
});
test('pending payment is not called confirmed, recorded payment needs actual record',async()=>{
 await send(2,'Did you receive my payment?');
 await db.query("insert into payment_submissions(rent_bill_id,verification_status) values($1,'pending_verification')",[id(200)]);
 await finish(await claim(),'payment_status');assert.match((await history())[0].body,/pending verification/);
 await db.exec("delete from payment_submissions;insert into payments(rent_bill_id,amount,status) values('"+id(200)+"',500,'confirmed')");
 await send(2,'I already paid');await finish(await claim(),'already_paid');assert.match((await history())[0].body,/A payment has been recorded/);
});
test('unrecorded I already paid goes to Admin, not a false confirmation',async()=>{
 await send(2,'I already paid');assert.equal((await finish(await claim(),'already_paid')).escalated,true);
 assert.doesNotMatch((await history())[0].body,/payment has been recorded/);
});
test('signed TA date is read-only; absent TA never invents an expiry',async()=>{
 await db.query(`insert into tenancy_agreements(id,tenancy_id,status,term_start_date,term_end_date,version_number,signed_at) values($1,$2,'signed','2026-05-01','2026-10-31',1,now())`,[id(201),id(24)]);
 await send(2,'When does my agreement expire?');await finish(await claim(),'ta_expiry');assert.match((await history())[0].body,/31 Oct 2026/);
 await db.exec('delete from tenancy_agreements');await send(2,'When does my agreement expire?');assert.equal((await finish(await claim(),'ta_expiry')).escalated,true);
});
test('active maintenance ticket status is returned, without creating a duplicate',async()=>{
 await send(2,'I have a maintenance problem');await finish(await claim(),'maintenance');
 assert.match((await history())[0].body,/FIXTURE-JOB-1.*in progress/);assert.match((await history())[0].body,/no need to submit a duplicate/);
 assert.equal((await db.query('select count(*)::int n from maintenance_tickets')).rows[0].n,1);
});
test('checked-out or ambiguous tenancy cannot receive guessed financial answers',async()=>{
 await send();const item=await claim();await db.exec("update tenancies set checkout_date=current_date");
 const result=await finish(item);assert.ok(result.skipped||result.escalated);assert.ok(!(await history()).some(m=>m.message_type==='AI_ASSISTANT'&&m.body.includes('31 Oct')));
});
test('after-hours acknowledgement occurs at most once per 24 hours with configured hours only',async()=>{
 await db.exec("update dekez_chat_private.assistant_control set office_start='09:00',office_end='17:00',office_days='{}'");
 await send();await finish(await claim());assert.match((await history())[0].body,/we have received your message/);
 await send();await finish(await claim());assert.doesNotMatch((await history())[0].body,/we have received your message/);
});
test('automated reminders never trigger human takeover or assistant loops',async()=>{
 await db.exec('update dekez_chat_private.reminder_control set enabled=true,cursor_key=null,cursor_day=null');
 await db.query("select dekez_chat_private.reminder_batch('2026-10-24',false)");
 assert.equal((await db.query('select count(*)::int n from dekez_chat_private.assistant_state')).rows[0].n,0);
 await send();await finish(await claim());assert.equal((await worker('claim')).length,0);
});
test('tenant/unrelated Admin cannot control assistant, claim records or forge replies',async()=>{
 for(const actor of [1,2,3,4,7]) assert.equal((await control(actor,'pause')).error.code,'42501');
 assert.equal((await control(5,'claim')).error.code,'42501');
 await assert.rejects(db.as(2,'select * from dekez_chat_private.assistant_deliveries'),e=>e.code==='42501');
 await assert.rejects(db.as(5,'update dekez_chat_private.assistant_control set enabled=true'),e=>e.code==='42501');
});

test('partial or malformed office schedules cannot silently bypass configuration checks',async()=>{
 for(const schedule of [
  "office_start='09:00',office_end=null,office_days=array[1,2,3,4,5]",
  "office_start='09:00',office_end='17:00',office_days=array[1,null,5]",
  "office_start='17:00',office_end='09:00',office_days=array[1]",
  "office_start='09:00',office_end='17:00',office_days=array[7]",
 ]) await assert.rejects(db.exec('update dekez_chat_private.assistant_control set '+schedule),e=>e.code==='23514');
});

test('end-to-end reminder, assistant, escalation and human reply keep one thread and never write source data',async()=>{
 // Guard every synthetic business source against writes throughout the flow.
 // Only chat tables and private automation tracking may be changed.
 const sources=['profiles','properties','rooms','tenancies','tenants','property_owners',
  'client_owner_settings','company_users','companies','maintenance_tickets','maintenance_ticket_assignments',
  'rent_bills','payments','payment_submissions','tenancy_agreements','tenancy_renewals'];
 await db.exec("create function public.fixture_no_business_write() returns trigger language plpgsql as $$begin raise exception 'Unexpected source write: %',TG_TABLE_NAME; end$$");
 for(const table of sources) await db.exec(`create trigger fixture_read_only before insert or update or delete on public.${table} for each statement execute function public.fixture_no_business_write()`);
 const count=Number((await db.query('select count(*) n from dekez_conversations')).rows[0].n);
 try {
  await db.exec('update dekez_chat_private.reminder_control set enabled=true,cursor_key=null,cursor_day=null');
  assert.equal((await db.query("select dekez_chat_private.reminder_batch('2026-10-24',false) result")).rows[0].result.sent,1);
  await send(2,'How much do I need to pay?');await finish(await claim(),'rent_amount');
  assert.match((await history())[0].body,/RM500.00/);
  await send(2,'I need an extension');await finish(await claim(),'sensitive');
  assert.equal((await inbox('needs_reply')).data.length,1);
  await send(5,'Management will review your request.');
  assert.equal((await control(5,'status')).data.mode,'takeover');
  await send(2,'Thank you');assert.equal((await worker('claim')).length,0);
  const messages=await history();
  assert.deepEqual(messages.map(m=>m.message_type).reverse(),['AUTO_REMINDER','USER_MESSAGE','AI_ASSISTANT','USER_MESSAGE','AI_ASSISTANT','MANUAL_ADMIN','USER_MESSAGE']);
  assert.equal(Number((await db.query('select count(*) n from dekez_conversations')).rows[0].n),count);
  assert.equal((await db.query("select dekez_chat_private.reminder_batch('2026-10-24',false) result")).rows[0].result.already_sent,1);
  assert.equal((await inbox('unread')).data.length,1);
 } finally {
  for(const table of sources) await db.exec(`drop trigger fixture_read_only on public.${table}`);
  await db.exec('drop function public.fixture_no_business_write()');
 }
});
