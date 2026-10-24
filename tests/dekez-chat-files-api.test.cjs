const test=require('node:test'),assert=require('node:assert/strict'),{PDFDocument}=require('pdf-lib'),sharp=require('sharp');
const loader=require('./marketplace-component-loader.cjs');
const {validateChatFile,boundedBytes,CHAT_FILE_LIMIT}=loader()('lib/chat/files.ts');
let db,api,storage,actor=1,pdf,upload,fileId,caseId;const saved=[process.env.DEKEZ_CHAT_ENABLED,process.env.DEKEZ_CHAT_FILES_ENABLED];
const send=(headers,body,origin='https://chat.test')=>api.POST(new Request('https://chat.test/api/dekez-chat/files',{method:'POST',headers:{origin,...headers},body}));
test.before(async()=>{
 db=await require('./fixtures/chat/database.cjs')();storage=require('./fixtures/chat/storage.cjs')(db,()=>actor);
 api=loader({'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:db.id(actor)}}})},rpc:(name,args)=>db.rpc(actor,name,args)})},'@/lib/supabase/admin':{createAdminClient:()=>storage.client}})('app/api/dekez-chat/files/route.ts');
 process.env.DEKEZ_CHAT_ENABLED='true';process.env.DEKEZ_CHAT_FILES_ENABLED='true';
 const doc=await PDFDocument.create();doc.addPage();pdf=Buffer.from(await doc.save());
});
test.after(async()=>{await db?.close();for(const [i,key]of ['DEKEZ_CHAT_ENABLED','DEKEZ_CHAT_FILES_ENABLED'].entries()){if(saved[i]===undefined)delete process.env[key];else process.env[key]=saved[i];}});
test('file validator checks actual bytes, strips image metadata, sanitizes names and bounds streams',async()=>{
 const png=await sharp({create:{width:16,height:16,channels:3,background:'#a09070'}}).png().toBuffer();
 const image=await validateChatFile(png,'../../fake<script>.jpg');assert.equal(image.mime,'image/webp');assert.doesNotMatch(image.name,/[<>/\\]/);
 assert.equal((await sharp(image.bytes).metadata()).exif,undefined);
 assert.equal((await validateChatFile(pdf,'quote.pdf')).mime,'application/pdf');
 for(const bytes of [Buffer.from('<svg onload="alert(1)"></svg>'),Buffer.from('%PDF-invalid'),Buffer.alloc(CHAT_FILE_LIMIT+1)])await assert.rejects(validateChatFile(bytes,'bad.png'));
 await assert.rejects(boundedBytes(new Request('http://local',{method:'POST',body:Buffer.alloc(CHAT_FILE_LIMIT+1)})),/exceeds/);
});
test('file API blocks origin forgery and unrelated accounts before any storage writes',async()=>{
 const headers={'x-chat-action':'upload','x-chat-conversation':db.conversation,'x-chat-key':db.id(201),'x-chat-name':'quote.pdf'};
 assert.equal((await send(headers,pdf,'https://other.test')).status,403);
 actor=5;assert.equal((await send(headers,pdf)).status,403);actor=1;
 assert.equal(storage.objects.size,0);
 assert.equal((await send(headers,Buffer.from('<script>fake</script>'))).status,400);
});
test('actual upload API -> reservation -> immutable storage -> service attestation -> end-user message',async()=>{
 const headers={'x-chat-action':'upload','x-chat-conversation':db.conversation,'x-chat-key':db.id(202),'x-chat-name':'quotation.pdf'};
 let result=await send(headers,pdf);assert.equal(result.status,200,await result.clone().text());upload=(await result.json()).data;
 result=await send(headers,pdf);assert.equal(result.status,200);assert.equal((await result.json()).data.uploadId,upload.uploadId);assert.equal(storage.objects.size,1);
 const sent=await db.rpc(1,'dekez_chat_file_send',{p_upload:upload.uploadId,p_body:'Attached quotation'});assert.equal(sent.error,null);
 fileId=upload.uploadId;
 actor=4;const view=await send({'x-chat-action':'download','x-chat-attachment':fileId});assert.equal(view.status,200);assert.equal(view.headers.get('cache-control'),'private, no-store');assert.match(view.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await view.arrayBuffer()),pdf);
 actor=5;assert.equal((await send({'x-chat-action':'download','x-chat-attachment':fileId})).status,403);actor=1;
});
test('support file delivery is reauthorized after storage I/O and denied if case closes during fetch',async()=>{
 caseId=(await db.rpc(1,'dekez_chat_report',{p_conversation:db.conversation,p_reason:'other',p_explanation:'Selected PDF',p_messages:[],p_attachments:[fileId]})).data;
 assert.equal((await db.rpc(5,'dekez_chat_support_assign',{p_case:caseId,p_staff:db.id(3),p_minutes:15,p_reason:'Review PDF evidence'})).error,null);
 actor=3;storage.setBeforeDownload(async()=>{await db.rpc(5,'dekez_chat_support_status',{p_case:caseId,p_status:'closed',p_reason:'Access no longer required'});});
 const response=await send({'x-chat-action':'download','x-chat-attachment':fileId,'x-chat-case':caseId,'x-chat-reason':encodeURIComponent('Review PDF evidence')});
 assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/%PDF/);
 assert.equal((await db.query("select count(*) n from dekez_chat_private.audit where action='support_file_download'")).rows[0].n,1);
 storage.setBeforeDownload(null);actor=1;
});
