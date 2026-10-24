const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('./fixtures/chat/database.cjs');
let db,upload,message,supportCase;const digest='a'.repeat(64);
const call=async(n,name,args,service=false)=>{const result=await db.rpc(n,name,args,service);if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.data;};
test.before(async()=>{db=await fixture();});test.after(async()=>db?.close());
test('account setup uses existing approved company-linked accounts with empty organization fields and explicit Super Admin authority',async()=>{
 const args={p_user:db.id(4),p_enabled:true,p_support:false,p_dispatch:false,p_preview_ack:false,p_reason:'Reviewed contractor chat pilot'};
 for(const actor of [1,2,3,4])await assert.rejects(call(actor,'dekez_chat_member_setup',args));
 await assert.rejects(call(5,'dekez_chat_member_setup',args),/acknowledgement/);
 await call(5,'dekez_chat_member_setup',{...args,p_preview_ack:true});
 await db.query('update profiles set organization_id=$1 where id=$2',[db.id(12),db.id(7)]);
 await assert.rejects(call(5,'dekez_chat_member_setup',{...args,p_user:db.id(7)}));
 assert.equal((await db.query("select count(*) n from dekez_chat_private.audit where action='chat_member_setup'")).rows[0].n,1);
});
test('scope setup checks ownership, tenancy, management company and active contractor assignment',async()=>{
 const args={p_a:db.id(1),p_b:db.id(3),p_property:db.id(20),p_room:null,p_tenancy:null,p_ticket:null,p_reason:'Property management communication'};
 assert.equal(await call(5,'dekez_chat_relationship_setup',args),db.id(51));
 await assert.rejects(call(3,'dekez_chat_relationship_setup',args));
 await assert.rejects(call(5,'dekez_chat_relationship_setup',{...args,p_b:db.id(2)}),/Owner–Tenant/);
 await assert.rejects(call(5,'dekez_chat_relationship_setup',{...args,p_a:db.id(7)}));
 await assert.rejects(call(5,'dekez_chat_relationship_setup',{...args,p_b:db.id(4)}));
 const grant=await call(5,'dekez_chat_relationship_setup',{...args,p_a:db.id(2),p_b:db.id(4),p_ticket:db.id(30)});
 assert.ok(await call(2,'dekez_chat_open',{p_relationship:grant}));
 await db.query("update company_users set status='inactive' where profile_id=$1",[db.id(3)]);
 assert.equal((await call(1,'dekez_chat_contacts',{p_after:null,p_limit:25})).filter(c=>c.contact_id===db.id(3)).length,0);
 await db.query("update company_users set status='active' where profile_id=$1",[db.id(3)]);
});
test('uploads require active participant access, are idempotent and cannot be self-attested',async()=>{
 const args={p_conversation:db.conversation,p_key:db.id(101),p_digest:digest,p_name:'test.pdf',p_mime:'application/pdf',p_size:120};
 for(const n of [2,3,5,7])await assert.rejects(call(n,'dekez_chat_file_reserve',args));
 upload=await call(1,'dekez_chat_file_reserve',args);
 assert.deepEqual(await call(1,'dekez_chat_file_reserve',args),upload);
 await assert.rejects(call(1,'dekez_chat_file_reserve',{...args,p_digest:'b'.repeat(64)}),/retry/);
 await assert.rejects(call(1,'dekez_chat_file_uploaded',{p_upload:upload.id,p_digest:digest}));
 await assert.rejects(call(1,'dekez_chat_file_send',{p_upload:upload.id,p_body:'PDF evidence'}));
 await call(1,'dekez_chat_file_uploaded',{p_upload:upload.id,p_digest:digest},true);
 message=await call(1,'dekez_chat_file_send',{p_upload:upload.id,p_body:'PDF evidence'});
 assert.equal((await call(1,'dekez_chat_file_send',{p_upload:upload.id,p_body:'PDF evidence'})).id,message.id);
 assert.equal((await db.query('select count(*) n from dekez_message_attachments where id=$1',[upload.id])).rows[0].n,1);
 await assert.rejects(call(4,'dekez_chat_file_send',{p_upload:upload.id,p_body:'Stolen upload'}));
});
test('an upload cannot retroactively alter an existing text message',async()=>{
 const key=db.id(109);
 const original=await call(1,'dekez_chat_send',{p_conversation:db.conversation,p_body:'Original text',p_key:key});
 const reserved=await call(1,'dekez_chat_file_reserve',{p_conversation:db.conversation,p_key:key,p_digest:digest,p_name:'later.pdf',p_mime:'application/pdf',p_size:120});
 await call(1,'dekez_chat_file_uploaded',{p_upload:reserved.id,p_digest:digest},true);
 await assert.rejects(call(1,'dekez_chat_file_send',{p_upload:reserved.id,p_body:'Original text'}),/another message/);
 assert.equal((await db.query('select count(*) n from dekez_message_attachments where message_id=$1',[original.id])).rows[0].n,0);
});
test('private file metadata and bytes authorization never grant ordinary Admin access',async()=>{
 const args={p_attachment:upload.id,p_case:null,p_reason:null,p_intent:'download'};
 assert.equal((await call(4,'dekez_chat_file_access',args)).file_name,'test.pdf');
 for(const n of [2,3,5,7])await assert.rejects(call(n,'dekez_chat_file_access',args));
 assert.equal((await call(4,'dekez_chat_files',{p_conversation:db.conversation,p_messages:[message.id]})).length,1);
 await assert.rejects(call(5,'dekez_chat_files',{p_conversation:db.conversation,p_messages:[message.id]}));
 await db.query("insert into storage.objects(bucket_id,name) values('dekez-chat-files','private'),('existing-bucket','untouched')");
 assert.deepEqual((await db.as(1,'select name from storage.objects')).rows,[{name:'untouched'}]);
 await assert.rejects(db.as(1,"insert into storage.objects(bucket_id,name) values('dekez-chat-files','forged')"));
});
test('support sees only selected files, logs every access and loses access when closed',async()=>{
 supportCase=await call(1,'dekez_chat_report',{p_conversation:db.conversation,p_reason:'other',p_explanation:'Review this file only',p_messages:[],p_attachments:[upload.id]});
 await call(5,'dekez_chat_support_assign',{p_case:supportCase,p_staff:db.id(3),p_minutes:15,p_reason:'Investigate selected file'});
 const manifest=await call(3,'dekez_chat_support_manifest',{p_case:supportCase,p_reason:'Investigate selected file'});
 assert.equal(manifest.messages.length,0);assert.equal(manifest.attachments[0].id,upload.id);
 const args={p_attachment:upload.id,p_case:supportCase,p_reason:'Investigate selected file',p_intent:'view'};
 await db.query('update company_users set company_id=$1 where profile_id=$2',[db.id(12),db.id(3)]);
 await assert.rejects(call(3,'dekez_chat_file_access',args));
 assert.equal((await call(3,'dekez_chat_support_queue',{p_before:null,p_before_id:null,p_limit:25})).length,0);
 await db.query('update company_users set company_id=$1 where profile_id=$2',[db.id(11),db.id(3)]);
 await call(3,'dekez_chat_file_access',args);await call(3,'dekez_chat_file_access',{...args,p_intent:'download'});
 assert.equal((await db.query("select count(*) n from dekez_chat_private.audit where action like 'support_file_%'")).rows[0].n,2);
 await assert.rejects(call(5,'dekez_chat_file_access',args));
 await assert.rejects(call(3,'dekez_chat_evidence',{p_case:supportCase,p_message:message.id,p_reason:args.p_reason}));
 await call(5,'dekez_chat_support_status',{p_case:supportCase,p_status:'closed',p_reason:'Investigation completed'});
 await assert.rejects(call(3,'dekez_chat_file_access',args));
});
test('identical support retries deduplicate and direct access to the unbounded helper is denied',async()=>{
 const args={p_conversation:db.conversation,p_reason:'other',p_explanation:'Retry this case safely',p_messages:[],p_attachments:[upload.id]};
 const first=await call(1,'dekez_chat_report',args);assert.equal(await call(1,'dekez_chat_report',args),first);
 await assert.rejects(db.as(1,'select dekez_chat_private.create_report($1,$2,$3,$4,$5)',[db.conversation,'other','Bypass',[],[]]));
 for(let n=0;n<8;n++)await call(1,'dekez_chat_report',{...args,p_explanation:'Different issue '+n});
 await assert.rejects(call(1,'dekez_chat_report',{...args,p_explanation:'Rate limit overflow'}),/wait/);
});
test('realtime signals contain no content and RLS exposes only the caller row',async()=>{
 const rows=(await db.as(1,'select * from dekez_chat_signals')).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].user_id,db.id(1));assert.deepEqual(Object.keys(rows[0]).sort(),['revision','updated_at','user_id']);
 assert.equal((await db.as(5,'select * from dekez_chat_signals where user_id=$1',[db.id(1)])).rows.length,0);
 await assert.rejects(db.as(1,'update dekez_chat_signals set revision=0'));
});
test('job closure prevents uploads and sends but preserves authorized attachment history',async()=>{
 await db.query("update maintenance_tickets set status='completed' where id=$1",[db.id(30)]);
 await assert.rejects(call(4,'dekez_chat_file_reserve',{p_conversation:db.conversation,p_key:db.id(102),p_digest:digest,p_name:'test.pdf',p_mime:'application/pdf',p_size:120}));
 await assert.rejects(call(1,'dekez_chat_file_send',{p_upload:upload.id,p_body:'PDF evidence'}));
 assert.ok(await call(4,'dekez_chat_file_access',{p_attachment:upload.id,p_case:null,p_reason:null,p_intent:'download'}));
 assert.equal((await call(4,'dekez_chat_contacts',{p_after:null,p_limit:25})).length,0);
});
