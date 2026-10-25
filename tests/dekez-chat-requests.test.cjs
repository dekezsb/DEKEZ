const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const out={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/chat/requests.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out.exports,URLSearchParams});
const {chatCommand,chatQuery,chatError}=out.exports;
const id='00000000-0000-0000-0000-000000000001';
test('commands never accept caller-supplied identity or arbitrary RPCs',()=>{
 for(const key of ['sender_id','user_id','role','participants','assigned_to','scope_id','message_type','system_label'])
 assert.equal(chatCommand({action:'send',conversationId:id,clientKey:id,body:'Hi',[key]:id}),null);
 assert.equal(chatCommand({action:'arbitrary_rpc'}),null);
 assert.equal(chatCommand({action:'send',conversationId:id,clientKey:id,body:' Hi '}).args.p_body,'Hi');
 assert.equal(chatCommand({action:'send',conversationId:id,body:'Hi'}),null);
});
test('message, read and evidence validation is bounded',()=>{
 assert.equal(chatCommand({action:'send',conversationId:id,clientKey:id,body:'x'.repeat(10001)}),null);
 assert.equal(chatCommand({action:'read',conversationId:id,sequence:-1}),null);
 assert.equal(chatCommand({action:'evidence',caseId:id,messageId:id,reason:''}),null);
 assert.equal(chatCommand({action:'report',conversationId:id,reason:'other',explanation:'Help',messageIds:Array(51).fill(id),attachmentIds:[]}),null);
});

test('support actions require explicit reasons and bounded temporary grants',()=>{
 const assign={action:'support-assign',caseId:id,staffId:id,minutes:60,reason:'Investigate case'};
 assert.equal(chatCommand(assign).rpc,'dekez_chat_support_assign');
 for(const minutes of [0,14,1441,Infinity])assert.equal(chatCommand({...assign,minutes}),null);
 assert.equal(chatCommand({...assign,reason:''}),null);
 assert.equal(chatCommand({action:'support-status',caseId:id,status:'open',reason:'Attempt reopen'}),null);
 assert.equal(chatQuery(new URLSearchParams('view=support-manifest')),null,'private report reads must be audited POSTs');
 assert.equal(chatQuery(new URLSearchParams('view=support-queue&limit=9999')).args.p_limit,25);
 assert.equal(chatQuery(new URLSearchParams('view=support-staff&limit=9999')).args.p_limit,25);
});
test('history and inbox queries are bounded, cursor-based, and cannot select another user',()=>{
 assert.equal(chatQuery(new URLSearchParams(`view=history&conversation=${id}&limit=100000`)).args.p_limit,40);
 assert.equal(chatQuery(new URLSearchParams('view=inbox')).args.p_limit,25);
 assert.equal(chatQuery(new URLSearchParams(`view=history&conversation=${id}&before=NaN`)),null);
 assert.equal(chatQuery(new URLSearchParams('view=all_users')),null);
});

test('Admin filters are validated and only add filters to the same bounded participant inbox',()=>{
 for(const filter of ['all','unread','tenant','owner','contractor','automated','needs_reply','ai_answered']) {
  const q=chatQuery(new URLSearchParams(`view=inbox&filter=${filter}&limit=100000`));
  assert.equal(q.rpc,'dekez_chat_inbox');assert.equal(q.args.p_filter,filter);assert.equal(q.args.p_limit,25);
 }
 assert.equal(chatQuery(new URLSearchParams('view=inbox&filter=global')),null);
 assert.equal(chatQuery(new URLSearchParams('view=support-queue&filter=all')),null);
 assert.equal(chatQuery(new URLSearchParams(`view=detail&conversation=${id}&context=true`)).args.p_context,true);
});
test('assistant endpoint exposes only participant controls, never worker or reply injection',()=>{
 const command=chatCommand({action:'assistant-control',conversationId:id,mode:'pause'});
 assert.equal(command.rpc,'dekez_chat_assistant');assert.equal(command.args.p_action,'pause');assert.equal(command.args.p_conversation,id);
 assert.equal(chatQuery(new URLSearchParams(`view=assistant&conversation=${id}&p_action=claim`)).args.p_action,'status');
 for(const mode of ['claim','finish','enable','send']) assert.equal(chatCommand({action:'assistant-control',conversationId:id,mode}),null);
 assert.equal(chatCommand({action:'send',conversationId:id,clientKey:id,body:'Fake',message_type:'AI_ASSISTANT'}),null);
});
test('errors contain no SQL or raw backend details; API is disabled by default and uses end-user session',()=>{
 assert.equal(chatError('42501').status,403);
 assert.equal(chatError('XX000').status,503);
 const route=fs.readFileSync('app/api/dekez-chat/route.ts','utf8');
 assert.match(route,/DEKEZ_CHAT_ENABLED !== "true"/);
 assert.match(route,/auth\.getUser\(\)/);
 assert.doesNotMatch(route,/createAdminClient|service_role|router\.refresh/);
 assert.match(route,/size > 65536/);
 assert.match(route,/private, no-store/);
});
