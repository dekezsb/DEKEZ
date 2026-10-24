const test=require('node:test'),assert=require('node:assert/strict');
let db;
const call=async(n,name,args={})=>{const r=await db.rpc(n,name,args);if(r.error)throw Error(r.error.message);return r.data;};
test.before(async()=>{db=await require('./fixtures/chat/database.cjs')();});
test.after(async()=>db?.close());
test('new summary cannot be read anonymously or with disabled chat membership',async()=>{
 assert.equal((await db.query("select has_function_privilege('anon','public.dekez_chat_summary()','EXECUTE') allowed")).rows[0].allowed,false);
 await db.query('update dekez_chat_private.members set enabled=false where user_id=$1',[db.id(7)]);
 await assert.rejects(call(7,'dekez_chat_summary'));
 await db.query('update dekez_chat_private.members set enabled=true where user_id=$1',[db.id(7)]);
});
test('upgrading an existing contractor desk closes sending without deleting historical messages',async()=>{
 const old=await require('./fixtures/chat/database.cjs')({mvp:false});
 try {
  const desk=(await old.rpc(4,'dekez_chat_desks',{})).data[0];
  const conv=(await old.rpc(4,'dekez_chat_desk_open',{p_desk:desk.desk_id})).data;
  assert.equal((await old.rpc(4,'dekez_chat_send',{p_conversation:conv,p_body:'Historical desk message',p_key:old.id(998)})).error,null);
  await old.exec(require('node:fs').readFileSync('supabase/migrations/20261024152754_dekez_chat_mvp.sql','utf8'));
  assert.equal((await old.rpc(4,'dekez_chat_detail',{p_conversation:conv})).data[0].status,'closed');
  assert.equal((await old.rpc(4,'dekez_chat_history',{p_conversation:conv})).data.length,1);
  for(const actor of [4,5])assert.equal((await old.rpc(actor,'dekez_chat_send',{p_conversation:conv,p_body:'Disallowed',p_key:old.id(999)})).error.code,'42501');
 }finally{await old.close();}
});
test('unread summary is caller-scoped and uses all authorized counters, not just inbox page',async()=>{
 assert.equal((await call(1,'dekez_chat_summary'))[0].unread_count,85);
 assert.equal((await call(7,'dekez_chat_summary'))[0].unread_count,0);
 await call(1,'dekez_chat_read',{p_conversation:db.conversation,p_seq:85});
 assert.equal((await call(1,'dekez_chat_summary'))[0].unread_count,0);
 await assert.rejects(db.as(1,'select dekez_chat_private.contact_label($1,$2)',[db.id(41),db.id(2)]));
});
test('tenant display label uses only the authorized room scope and short name',async()=>{
 await db.query('update dekez_chat_private.scopes set room_id=$1 where id=$2',[db.id(22),db.id(40)]);
 await db.query("insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason) values($1,$2,$3,$4,$5,'Tenant management fixture')",[db.id(54),db.id(40),db.id(2),db.id(3),db.id(5)]);
 await db.query("update profiles set full_name='AQIL BIN LONG LEGAL NAME' where id=$1",[db.id(2)]);
 const conv=await call(2,'dekez_chat_open',{p_relationship:db.id(54)});
 assert.equal((await call(3,'dekez_chat_detail',{p_conversation:conv}))[0].contact_name,'AQIL · D1');
 assert.equal((await call(3,'dekez_chat_inbox')).find(c=>c.conversation_id===conv).contact_name,'AQIL · D1');
});
test('Owner can contact authorized Admin desk without changing job records',async()=>{
 await db.query('delete from maintenance_ticket_assignments where assigned_to=$1',[db.id(4)]);
 await call(4,'dekez_chat_bootstrap');
 const desks=(await call(1,'dekez_chat_desks')).filter(d=>d.label.startsWith('DEKEZ'));
 assert.equal(desks.length,1);assert.match(desks[0].label,/DEKEZ Support/);
 const conversation=await call(1,'dekez_chat_desk_open',{p_desk:desks[0].desk_id});
 assert.equal(await call(1,'dekez_chat_desk_open',{p_desk:desks[0].desk_id}),conversation);
 const sent=await call(1,'dekez_chat_send',{p_conversation:conversation,p_body:'General question, no job needed',p_key:db.id(910)});
 const reply=await call(5,'dekez_chat_send',{p_conversation:conversation,p_body:'Admin reply',p_key:db.id(911)});
 assert.equal(reply.seq,sent.seq+1);
 assert.equal((await call(1,'dekez_chat_detail',{p_conversation:conversation}))[0].status,'active');
 for(const other of [2,3,7])await assert.rejects(call(other,'dekez_chat_history',{p_conversation:conversation}));
 assert.equal((await db.query('select count(*) n from maintenance_ticket_assignments')).rows[0].n,0);
});
test('desk contact list is scoped, not a global account directory',async()=>{
 assert.equal((await call(7,'dekez_chat_desks')).length,0);
 assert.equal((await call(1,'dekez_chat_desks')).length,2);
 const management=(await call(1,'dekez_chat_desks')).find(d=>d.label.startsWith('Property Management'));
 assert.equal((await call(4,'dekez_chat_desks')).length,0);
 await assert.rejects(call(4,'dekez_chat_desk_open',{p_desk:management.desk_id}));
 await assert.rejects(call(1,'dekez_chat_desk_open',{p_desk:db.id(2)}));
 await assert.rejects(db.as(4,'select * from dekez_chat_private.desks'));
});
test('bootstrap is self-only, idempotent, does not restore disabled or changed-role membership',async()=>{
 await call(4,'dekez_chat_bootstrap');await call(4,'dekez_chat_bootstrap');
 await assert.rejects(db.as(4,'select dekez_chat_private.ensure_member($1)',[db.id(7)]));
 await db.query('update dekez_chat_private.members set enabled=false where user_id=$1',[db.id(4)]);
 await assert.rejects(call(4,'dekez_chat_bootstrap'));
 await db.query('update dekez_chat_private.members set enabled=true where user_id=$1',[db.id(4)]);
 await db.query("update profiles set role='tenant' where id=$1",[db.id(4)]);
 await assert.rejects(call(4,'dekez_chat_bootstrap'));
 await db.query("update profiles set role='contractor_preview' where id=$1",[db.id(4)]);
});
test('desk support remains selected-evidence-only, company-scoped and revocable',async()=>{
 const desk=(await call(1,'dekez_chat_desks'))[0];
 const conv=await call(1,'dekez_chat_desk_open',{p_desk:desk.desk_id});
 const history=await call(1,'dekez_chat_history',{p_conversation:conv});
 const report=await call(1,'dekez_chat_report',{p_conversation:conv,p_reason:'other',p_explanation:'Please review this selected message',p_messages:[history[0].id],p_attachments:[]});
 await assert.rejects(call(3,'dekez_chat_evidence',{p_case:report,p_message:history[0].id,p_reason:'Investigating case'}));
 await call(5,'dekez_chat_support_assign',{p_case:report,p_staff:db.id(3),p_minutes:15,p_reason:'Review selected message'});
 assert.ok(await call(3,'dekez_chat_evidence',{p_case:report,p_message:history[0].id,p_reason:'Investigating case'}));
 await assert.rejects(call(3,'dekez_chat_history',{p_conversation:conv}));
 await assert.rejects(call(3,'dekez_chat_evidence',{p_case:report,p_message:history[1].id,p_reason:'Investigating case'}));
 await call(5,'dekez_chat_support_status',{p_case:report,p_status:'closed',p_reason:'Investigation completed'});
 await assert.rejects(call(3,'dekez_chat_evidence',{p_case:report,p_message:history[0].id,p_reason:'Investigating case'}));
});
test('disabled staff desk rejects new messages and retains participant history',async()=>{
 const desk=(await call(1,'dekez_chat_desks'))[0];
 const conv=await call(1,'dekez_chat_desk_open',{p_desk:desk.desk_id});
 await db.query('update dekez_chat_private.desks set enabled=false where id=$1',[desk.desk_id]);
 await assert.rejects(call(1,'dekez_chat_send',{p_conversation:conv,p_body:'Blocked',p_key:db.id(912)}));
 assert.equal((await call(1,'dekez_chat_detail',{p_conversation:conv}))[0].status,'closed');
 assert.ok((await call(1,'dekez_chat_history',{p_conversation:conv})).length);
 assert.ok(!(await call(1,'dekez_chat_desks')).some(d=>d.desk_id===desk.desk_id));
});
