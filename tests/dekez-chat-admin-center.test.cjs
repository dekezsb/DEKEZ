const test=require('node:test'),assert=require('node:assert/strict');
const database=require('./fixtures/chat/database.cjs');
let db,id,conversation,key=1000;
const inbox=(actor=5,filter='all',extra={})=>db.rpc(actor,'dekez_chat_inbox',{p_before:null,p_before_id:null,p_limit:25,p_filter:filter,...extra});
const send=(actor,body)=>db.rpc(actor,'dekez_chat_send',{p_conversation:conversation,p_body:body,p_key:id(++key)});
async function reminder(){await db.exec('update dekez_chat_private.reminder_control set enabled=true');return (await db.query("select dekez_chat_private.reminder_batch('2026-10-24',false) as r")).rows[0].r;}
test.before(async()=>{db=await database();id=db.id;conversation=await require('./fixtures/chat/reminders.cjs')(db);await require('./fixtures/chat/admin-center.cjs')(db);});
test.after(async()=>db?.close());
test.beforeEach(async()=>{
 await db.exec(`truncate dekez_chat_private.reminder_deliveries,dekez_chat_private.reminder_runs,dekez_chat_private.welcome_deliveries;
 delete from dekez_messages where conversation_id='${conversation}';
 update dekez_conversations set message_count=0,status='active' where id='${conversation}';
 update dekez_conversation_participants set unread_count=0,last_read_seq=0 where conversation_id='${conversation}';
 delete from dekez_chat_private.send_limits; update dekez_chat_private.welcome_control set enabled=false;
 update dekez_chat_private.reminder_control set cursor_day=null,cursor_key=null;
 update maintenance_tickets set status='in_progress'; reset "request.jwt.claim.sub";`);
});
test('manual Admin and user messages are classified by backend; old history stays unchanged',async()=>{
 assert.equal((await send(5,'Admin reply')).data.message_type,'MANUAL_ADMIN');
 assert.equal((await send(2,'Tenant reply')).data.message_type,'USER_MESSAGE');
 const history=await db.rpc(1,'dekez_chat_history',{p_conversation:db.conversation,p_limit:40});
 assert.ok(history.data.every(m=>m.message_type===null));
 assert.equal((await db.rpc(5,'dekez_chat_history',{p_conversation:conversation,p_limit:40})).data.length,2);
});
test('automatic reminder, tenant reply and manual Admin reply share one audited conversation',async()=>{
 const before=(await db.query('select count(*)::int n from dekez_conversations')).rows[0].n;
 assert.equal((await reminder()).sent,1);
 let list=await inbox();assert.equal(list.error,null);assert.equal(list.data[0].latest_message_type,'AUTO_REMINDER');
 assert.equal((await inbox(5,'automated')).data.length,1);
 await send(2,'I will pay tomorrow');list=await inbox(5,'needs_reply');
 assert.equal(list.data[0].conversation_id,conversation);assert.equal(list.data[0].unread_count,1);assert.equal(list.data[0].needs_reply,true);
 assert.equal(list.data[0].contact_role,'tenant');assert.match(list.data[0].preview,/tomorrow/);
 assert.equal((await inbox(5,'automated')).data.length,1,'reminder filter includes thread even after user reply');
 await send(5,'Thank you');assert.equal((await inbox(5,'needs_reply')).data.length,0);
 const history=(await db.rpc(2,'dekez_chat_history',{p_conversation:conversation,p_limit:40})).data;
 assert.deepEqual(history.map(m=>m.message_type),['MANUAL_ADMIN','USER_MESSAGE','AUTO_REMINDER']); // newest first
 assert.equal(history.find(m=>m.message_type==='AUTO_REMINDER').system_label,'DEKEZ Admin');
 assert.equal((await db.query('select count(*)::int n from dekez_conversations')).rows[0].n,before);
 assert.equal((await db.query('select count(*)::int n from dekez_chat_private.reminder_deliveries')).rows[0].n,1);
});
test('reading clears unread and needs reply without creating a separate queue',async()=>{
 await send(2,'Please help');assert.equal((await inbox(5,'unread')).data.length,1);
 await db.rpc(5,'dekez_chat_read',{p_conversation:conversation,p_seq:1});
 assert.equal((await inbox(5,'needs_reply')).data.length,0);assert.equal((await inbox(5,'unread')).data.length,0);
 assert.equal((await db.rpc(5,'dekez_chat_summary',{})).data[0].unread_count,0);
});
test('role filters and scoped details never grant Admin or strangers private access',async()=>{
 await send(2,'Private');assert.equal((await inbox(5,'tenant')).data.length,1);assert.equal((await inbox(5,'owner')).data.length,0);
 for(const actor of [1,3,4,7]) assert.ok((await inbox(actor)).data.every(r=>r.conversation_id!==conversation));
 assert.ok((await inbox()).data.every(r=>r.conversation_id!==db.conversation),'Admin cannot browse private owner-contractor thread');
 assert.equal((await db.rpc(5,'dekez_chat_detail',{p_conversation:db.conversation,p_context:true})).error.code,'42501');
 const detail=await db.rpc(5,'dekez_chat_detail',{p_conversation:conversation,p_context:true});
 assert.equal(detail.error,null);assert.equal(detail.data[0].contact_role,'tenant');
 assert.equal((await inbox(5,'everything')).error.code,'P0001');
});
test('owner/tenant creation and completed contractor sending stay blocked',async()=>{
 assert.equal((await db.rpc(1,'dekez_chat_open',{p_relationship:id(52)})).error.code,'42501');
 await db.exec("update maintenance_tickets set status='completed'");
 assert.equal((await db.rpc(4,'dekez_chat_send',{p_conversation:db.conversation,p_body:'Not allowed',p_key:id(++key)})).error.code,'42501');
 assert.equal((await db.rpc(1,'dekez_chat_history',{p_conversation:db.conversation,p_limit:40})).error,null);
});
test('welcome is disabled by default; reopening existing chat cannot resend it',async()=>{
 assert.equal((await db.query('select enabled from dekez_chat_private.welcome_control')).rows[0].enabled,false);
 await db.exec('update dekez_chat_private.welcome_control set enabled=true');
 for(let i=0;i<3;i++) assert.equal((await db.rpc(2,'dekez_chat_open',{p_relationship:id(55)})).data,conversation);
 assert.equal((await db.query('select count(*)::int n from dekez_chat_private.welcome_deliveries')).rows[0].n,0,'no retrospective welcome on existing chat');
});
test('new authorized Admin–Tenant chat welcomes once, creates unread, preserves actor and allows replies',async()=>{
 await db.exec(`update dekez_chat_private.welcome_control set enabled=true;
 insert into dekez_chat_private.scopes(id,kind,property_id,room_id,tenancy_id) values('${id(59)}','property','${id(20)}','${id(22)}','${id(24)}');
 insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason)
 values('${id(58)}','${id(59)}','${id(2)}','${id(5)}','${id(5)}','Synthetic second scoped relationship');`);
 const opened=await db.rpc(2,'dekez_chat_open',{p_relationship:id(58)});assert.equal(opened.error,null);
 const history=await db.rpc(2,'dekez_chat_history',{p_conversation:opened.data,p_limit:40});
 assert.equal(history.data.length,1,JSON.stringify((await db.query("select * from dekez_chat_private.audit where action='welcome_message_failed'")).rows));
 assert.equal(history.data[0].message_type,'WELCOME_MESSAGE');assert.equal(history.data[0].sender_id,id(5));
 assert.equal(history.data[0].system_label,'DEKEZ Admin');
 for(let i=0;i<3;i++) await db.rpc(2,'dekez_chat_open',{p_relationship:id(58)});
 assert.equal((await db.query('select count(*)::int n from dekez_chat_private.welcome_deliveries')).rows[0].n,1);
 assert.equal((await db.query('select initiated_by from dekez_chat_private.welcome_deliveries')).rows[0].initiated_by,id(2));
 const reply=await db.rpc(2,'dekez_chat_send',{p_conversation:opened.data,p_body:'Thanks',p_key:id(++key)});
 assert.equal(reply.data.sender_id,id(2),'delegated Admin identity restored');
 // Synthetic cleanup only, so subsequent tests retain their original one thread.
 await db.exec(`delete from dekez_chat_private.welcome_deliveries;delete from dekez_messages where conversation_id='${opened.data}';
 delete from dekez_conversation_participants where conversation_id='${opened.data}';delete from dekez_conversations where id='${opened.data}';
 delete from dekez_chat_private.relationships where id='${id(58)}';delete from dekez_chat_private.scopes where id='${id(59)}';`);
});
test('ordinary users cannot enable welcomes, forge types or alter delivery history',async()=>{
 for(const sql of ["update dekez_chat_private.welcome_control set enabled=true","select * from dekez_chat_private.welcome_deliveries",`update dekez_messages set message_type='SYSTEM_NOTICE' where conversation_id='${conversation}'`]) {
  await assert.rejects(db.as(2,sql),e=>e.code==='42501');
 }
});

test('filters apply before paging; cursor stays bounded and actual message time is retained',async()=>{
 await send(2,'Older tenant thread');
 const sent=(await inbox()).data[0].message_time;
 await db.exec(`insert into dekez_chat_private.scopes(id,kind,property_id) values('${id(60)}','property','${id(20)}');
 insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason)
 values('${id(61)}','${id(60)}','${id(1)}','${id(5)}','${id(5)}','Synthetic owner admin scope');`);
 const opened=await db.rpc(5,'dekez_chat_open',{p_relationship:id(61)});assert.equal(opened.error,null);
 await db.rpc(1,'dekez_chat_send',{p_conversation:opened.data,p_body:'Newer owner thread',p_key:id(++key)});
 assert.equal((await inbox(5,'all',{p_limit:1})).data[0].conversation_id,opened.data);
 assert.equal((await inbox(5,'tenant',{p_limit:1})).data[0].conversation_id,conversation);
 const first=(await inbox(5,'all',{p_limit:1})).data[0];
 assert.equal((await inbox(5,'all',{p_limit:1,p_before:first.last_message_at,p_before_id:first.conversation_id})).data[0].conversation_id,conversation);
 await db.rpc(5,'dekez_chat_read',{p_conversation:conversation,p_seq:1});
 assert.equal(new Date((await inbox(5,'tenant')).data[0].message_time).getTime(),new Date(sent).getTime(),'reading cannot change visible message timestamp');
});
