// Actual shared React UI -> actual API handler -> actual migration/RLS in PGlite.
// Authentication is synthetic; Supabase gateway, Storage and Realtime are NOT emulated.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const assert=require('node:assert/strict'),{AsyncLocalStorage}=require('node:async_hooks');
const root=path.resolve(__dirname,'..'),fixtures=path.join(__dirname,'fixtures/chat');
const {webpack}=require('next/dist/compiled/webpack/webpack');
const sizes=[[320,568],[375,812],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1024,1366],[1280,800],[1366,768],[1440,900],[1920,1080]];
async function run(){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'dekez-chat-qa-'));
 let db,server,browser;const saved=process.env.DEKEZ_CHAT_ENABLED,savedFiles=process.env.DEKEZ_CHAT_FILES_ENABLED,savedRealtime=process.env.DEKEZ_CHAT_REALTIME_ENABLED;
 try {
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(fixtures,'entry.jsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.jsx','.js'],alias:{'next/link':path.join(fixtures,'link.jsx'),'@/lib/chat/realtime':path.join(fixtures,'realtime.js'),'@':root}},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/payment-rows/loader.cjs')},{test:/\.css$/,use:path.join(fixtures,'css-loader.cjs')}]}});
  await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve())));
  db=await require('./fixtures/chat/database.cjs')();
  const reminderConversation=await require('./fixtures/chat/reminders.cjs')(db);
  await require('./fixtures/chat/admin-center.cjs')(db);
  await require('./fixtures/chat/assistant.cjs')(db);
  const actor=new AsyncLocalStorage();process.env.DEKEZ_CHAT_ENABLED='true';process.env.DEKEZ_CHAT_FILES_ENABLED='true';process.env.DEKEZ_CHAT_REALTIME_ENABLED='true';
  const storage=require('./fixtures/chat/storage.cjs')(db,()=>actor.getStore());
  const load=require('./marketplace-component-loader.cjs')({'@/lib/supabase/server':{createClient:async()=>{
   const n=actor.getStore();return {auth:{getUser:async()=>({data:{user:{id:db.id(n)}}})},rpc:(name,args)=>db.rpc(n,name,args)};
  }},'@/lib/supabase/admin':{createAdminClient:()=>storage.client}});
  const api=load('app/api/dekez-chat/route.ts'),filesApi=load('app/api/dekez-chat/files/route.ts');
  const network=[];
  server=http.createServer(async(req,res)=>{
   try {
    const url=new URL(req.url,'http://'+req.headers.host);
    const match=/^\/api\/dekez-chat\/(1|2|3|4|5|7)(\/files)?$/.exec(url.pathname);
    if(match){
     const chunks=[];for await(const chunk of req)chunks.push(chunk);
     const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
     network.push({actor:Number(match[1]),method:req.method,view:url.searchParams.get('view'),fileAction:req.headers['x-chat-action']});
     const result=await actor.run(Number(match[1]),()=>match[2]?filesApi.POST(request):req.method==='POST'?api.POST(request):api.GET(request));
     res.writeHead(result.status,Object.fromEntries(result.headers));return res.end(Buffer.from(await result.arrayBuffer()));
    }
    if(/^\/[a-zA-Z0-9_.-]+\.js$/.test(url.pathname)){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,url.pathname.slice(1))));}
    if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');return res.end('body{margin:0;padding:16px;background:#f6f3ed}'+fs.readFileSync(path.join(root,'components/chat/workspace.module.css'),'utf8')+fs.readFileSync(path.join(root,'components/chat/launcher.module.css'),'utf8'));}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><p>LOCAL SYNTHETIC TEST — NOT LIVE DATA</p><div id="root"></div><script src="/fixture.js"></script></body></html>');
   }catch(error){console.error(error);res.writeHead(500);res.end('Fixture server failure');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const owner=await browser.newPage({viewport:{width:1280,height:800}}),contractor=await browser.newPage();
  const errors=[];for(const page of [owner,contractor])page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  // Actual reminder worker -> normal API -> unread/preview/UI, with local
  // invalidation standing in for the Supabase transport (not a live WS test).
  const tenant=await browser.newPage({viewport:{width:390,height:844}});
  tenant.on('pageerror',e=>errors.push(e.message));
  await tenant.goto(url+'/?actor=2');
  await tenant.getByRole('button',{name:/Fixture Admin/}).waitFor();
  await tenant.evaluate(()=>{window.reminderNavigationToken='unchanged';});
  await db.exec("update dekez_chat_private.reminder_control set enabled=true");
  const reminderResult=(await db.query("select dekez_chat_private.reminder_batch('2026-10-24',false) as result")).rows[0].result;
  assert.equal(reminderResult.sent,1);
  await tenant.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await tenant.getByRole('link',{name:'Messages, 1 unread',exact:true}).waitFor();
  await tenant.getByRole('button',{name:/Fixture Admin/}).filter({hasText:'Rental payment due'}).waitFor();
  await tenant.getByRole('button',{name:/Fixture Admin/}).click();
  await tenant.locator('.history article strong').getByText('DEKEZ Admin',{exact:true}).waitFor();
  await tenant.locator('.history').getByText(/Remaining unpaid: RM500.00/).waitFor();
  await tenant.locator('.history').getByText('Automated Reminder',{exact:true}).waitFor();
  await tenant.getByRole('link',{name:'Messages',exact:true}).waitFor();
  assert.equal(await tenant.evaluate(()=>window.reminderNavigationToken),'unchanged');
  for(const [width,height] of [[390,844],[820,1180],[1440,900]]) {
   await tenant.setViewportSize({width,height});
   assert.ok(await tenant.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await tenant.screenshot({path:path.join(output,`reminder-${width}.png`),fullPage:true});
  }
  const center=await browser.newPage({viewport:{width:1440,height:900}});
  center.on('pageerror',e=>errors.push(e.message));
  await center.goto(url+'/?actor=5');
  await center.getByLabel('Filter conversations').selectOption('automated');
  await center.getByRole('button',{name:/Fixture/}).filter({hasText:'Rental payment due'}).waitFor();
  assert.equal(await center.getByRole('button',{name:/Fixture Contractor/}).count(),0);
  await center.evaluate(()=>{window.centerNavigationToken='unchanged';});
  await tenant.getByLabel('Message',{exact:true}).fill('I will pay tomorrow.');
  await tenant.getByRole('button',{name:'Send message',exact:true}).click();
  await tenant.locator('.history').getByText('I will pay tomorrow.',{exact:true}).waitFor();
  await center.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await center.getByRole('link',{name:'Messages, 1 unread',exact:true}).waitFor();
  await center.getByRole('button',{name:/Fixture/}).filter({hasText:'I will pay tomorrow.'}).waitFor();
  await center.getByLabel('Filter conversations').selectOption('needs_reply');
  const incoming=center.getByRole('button',{name:/Fixture/}).filter({hasText:'Needs Reply'});
  await incoming.waitFor();
  await center.screenshot({path:path.join(output,'admin-needs-reply.png'),fullPage:true});
  await incoming.click();
  await center.locator('.history').getByText('I will pay tomorrow.',{exact:true}).waitFor();
  await center.getByRole('link',{name:'Messages',exact:true}).waitFor();
  await center.getByText('No conversations match this filter.',{exact:true}).waitFor();
  await center.getByLabel('Message',{exact:true}).fill('Admin can reply in this same reminder conversation.');
  await center.getByRole('button',{name:'Send message',exact:true}).click();
  await center.locator('.history').getByText('Admin can reply in this same reminder conversation.',{exact:true}).waitFor();
  await center.locator('.history').getByText('Manual Admin message',{exact:true}).waitFor();
  await center.getByLabel('Filter conversations').selectOption('all');
  for(const [width,height] of sizes) {
   await center.setViewportSize({width,height});
   await center.locator('.history').evaluate(element=>{element.scrollTop=element.scrollHeight;});
   assert.ok(await center.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Admin center overflow at ${width}`);
   if([390,820,1440].includes(width)) await center.screenshot({path:path.join(output,`admin-center-${width}.png`),fullPage:true});
  }
  assert.equal(await center.evaluate(()=>window.centerNavigationToken),'unchanged');
  await tenant.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await tenant.locator('.history').getByText('Admin can reply in this same reminder conversation.',{exact:true}).waitFor();
  assert.equal(await tenant.evaluate(()=>window.reminderNavigationToken),'unchanged');
  // Assistant: actual queue -> scoped current records -> same history. The model
  // classifier is deterministic here; this test never calls a paid provider.
  const assistant=require('./marketplace-component-loader.cjs')()('lib/chat/assistant.ts');
  async function assistantTick() {
   await db.exec("update dekez_chat_private.assistant_state set due_at=now()-interval '1 second';set \"request.jwt.claims\"='{\"role\":\"service_role\"}'");
   try { return await assistant.runAssistantBatch({rpc:(name,args)=>db.rpc(5,name,args,true)},async q=>assistant.safeIntent(q)); }
   finally {await db.exec('reset "request.jwt.claims"');}
  }
  await db.exec('update dekez_chat_private.assistant_control set enabled=true');
  assert.equal((await db.rpc(5,'dekez_chat_assistant',{p_action:'resume',p_conversation:reminderConversation})).error,null);
  await tenant.getByLabel('Message',{exact:true}).fill('When is my rental due?');
  await tenant.getByRole('button',{name:'Send message',exact:true}).click();
  await tenant.locator('.history').getByText('When is my rental due?',{exact:true}).waitFor();
  assert.equal((await assistantTick()).sent,1);
  await tenant.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await tenant.locator('.history').getByText('DEKEZ Assistant',{exact:true}).waitFor();
  await tenant.locator('.history').getByText(/Your current invoice.*31 Oct 2026/).waitFor();
  await center.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await center.getByLabel('Filter conversations').selectOption('ai_answered');
  await center.getByRole('button',{name:/Fixture/}).filter({hasText:'Automated Assistant'}).waitFor();
  await center.getByText('AI ACTIVE',{exact:true}).waitFor();
  for(const [width,height] of sizes) {
   await center.setViewportSize({width,height});
   await center.locator('.history').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   assert.ok(await center.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Assistant controls overflow at ${width}`);
   if([320,820,1440].includes(width)) await center.screenshot({path:path.join(output,`assistant-admin-${width}.png`),fullPage:true});
  }
  await center.setViewportSize({width:1440,height:900});
  await tenant.setViewportSize({width:390,height:844});
  await tenant.locator('.history').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await tenant.screenshot({path:path.join(output,'assistant-tenant.png'),fullPage:true});
  await tenant.getByLabel('Message',{exact:true}).fill('I am angry about this');
  await tenant.getByRole('button',{name:'Send message',exact:true}).click();
  await tenant.locator('.history').getByText('I am angry about this',{exact:true}).waitFor();
  assert.equal((await assistantTick()).escalated,1);
  await center.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await center.getByLabel('Filter conversations').selectOption('needs_reply');
  await center.getByText('NEEDS ADMIN REPLY · Assistant paused',{exact:true}).waitFor();
  await center.getByRole('button',{name:/Fixture/}).filter({hasText:'Needs Reply'}).waitFor();
  await center.getByLabel('Message',{exact:true}).fill('Management is reviewing your complaint.');
  await center.getByRole('button',{name:'Send message',exact:true}).click();
  await center.getByText('ADMIN TAKEOVER',{exact:true}).waitFor();
  await center.getByRole('button',{name:'Re-enable assistant',exact:true}).click();
  await center.getByText('AI ACTIVE',{exact:true}).waitFor();
  await center.getByRole('button',{name:'Take over',exact:true}).click();
  await center.getByText('ADMIN TAKEOVER',{exact:true}).waitFor();
  assert.equal(await center.evaluate(()=>window.centerNavigationToken),'unchanged');
  await db.exec('update dekez_chat_private.assistant_control set enabled=false');
  await center.close();
  await tenant.close();
  await owner.goto(url+'/?actor=1');
  await owner.getByRole('link',{name:'Messages, 85 unread',exact:true}).waitFor();
  await owner.getByRole('button',{name:/Fixture Contractor/}).click();
  await owner.getByLabel('Message',{exact:true}).waitFor();
  assert.equal(await owner.locator('.history article').count(),40);
  await owner.getByRole('link',{name:'Messages',exact:true}).waitFor();
  await owner.getByRole('button',{name:'Load older messages'}).click();
  await owner.waitForFunction(()=>document.querySelectorAll('.history article').length===80);
  await owner.getByRole('button',{name:'New chat',exact:true}).click();
  const contacts=owner.getByRole('region',{name:'Authorized contacts'});
  await contacts.getByRole('button',{name:/^Fixture Management management/}).waitFor();
  assert.doesNotMatch(await contacts.innerText(),/Fixture Tenant|Unrelated Owner/);
  await contacts.getByRole('button',{name:'Close contacts'}).click();
  // A recoverable network failure must retain the draft and the retry key.
  let first=true;const keys=[];
  await owner.route('**/api/dekez-chat/1',async route=>{
   const body=route.request().postDataJSON();
   if(body?.action==='send'){keys.push(body.clientKey);if(first){first=false;return route.abort();}}
   return route.continue();
  });
  await owner.getByLabel('Message',{exact:true}).fill('Owner message from browser');
  await owner.getByRole('button',{name:'Send message',exact:true}).click();
  await owner.getByRole('alert').waitFor();
  assert.equal(await owner.getByLabel('Message',{exact:true}).inputValue(),'Owner message from browser');
  await owner.getByRole('button',{name:'Send message',exact:true}).click();
  await owner.locator('.history').getByText('Owner message from browser',{exact:true}).waitFor();
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  await contractor.goto(url+'/?actor=4');
  await contractor.getByRole('button',{name:/Fixture Owner/}).click();
  await contractor.locator('.history').getByText('Owner message from browser',{exact:true}).waitFor();
  await contractor.getByLabel('Message',{exact:true}).fill('Contractor reply from browser');
  await contractor.getByRole('button',{name:'Send message',exact:true}).click();
  await contractor.locator('.history').getByText('Contractor reply from browser',{exact:true}).waitFor();
  await owner.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await owner.locator('.history').getByText('Contractor reply from browser',{exact:true}).waitFor();
  const photo=await require('sharp')({create:{width:80,height:60,channels:3,background:'#b68c34'}}).png().toBuffer();
  await owner.getByLabel('Message',{exact:true}).fill('Browser photo evidence');
  await owner.getByLabel('Attach photo or PDF').setInputFiles({name:'work-photo.png',mimeType:'image/png',buffer:photo});
  await owner.getByRole('button',{name:'Send message',exact:true}).click();
  await owner.locator('.history').getByText('Browser photo evidence',{exact:true}).waitFor();
  assert.equal(network.filter(n=>n.fileAction==='view'||n.fileAction==='download').length,0,'Full-size files must not preload');
  await contractor.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await contractor.locator('.history').getByText('Browser photo evidence',{exact:true}).waitFor();
  await contractor.getByRole('button',{name:'View image'}).click();
  await contractor.getByRole('img',{name:'work-photo.webp'}).waitFor();
  assert.equal(await contractor.getByRole('img',{name:'work-photo.webp'}).evaluate(img=>img.naturalWidth),80);
  const pdfDoc=await require('pdf-lib').PDFDocument.create();pdfDoc.addPage();
  await owner.getByLabel('Message',{exact:true}).fill('Browser quotation PDF');
  await owner.getByLabel('Attach photo or PDF').setInputFiles({name:'quote.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdfDoc.save())});
  await owner.getByRole('button',{name:'Send message',exact:true}).click();
  await owner.locator('.history').getByText('Browser quotation PDF',{exact:true}).waitFor();
  await contractor.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await contractor.locator('.history').getByText('Browser quotation PDF',{exact:true}).waitFor();
  const downloaded=contractor.waitForEvent('download');await contractor.getByRole('button',{name:'Download PDF',exact:true}).click();
  assert.equal((await downloaded).suggestedFilename(),'quote.pdf');
  // Selecting evidence does not disclose the rest of this 87-message history.
  await owner.getByRole('button',{name:'Request support',exact:true}).click();
  await owner.locator('article').filter({hasText:'Contractor reply from browser'}).getByRole('checkbox').check();
  await owner.locator('article').filter({hasText:'Browser photo evidence'}).getByLabel('Include this file as support evidence').check();
  await owner.getByLabel('Explain the problem').fill('Please review this selected message only.');
  await owner.getByRole('button',{name:'Submit support request'}).click();
  await owner.getByRole('status').filter({hasText:'Support request submitted'}).waitFor();
  assert.equal((await db.query('select * from dekez_chat_private.support_evidence')).rows.length,1);
  assert.equal((await db.query('select * from dekez_chat_private.support_attachment_evidence')).rows.length,1);
  // Dispatch sees only metadata. A separately assigned support account reviews evidence.
  const dispatcher=await browser.newPage(),support=await browser.newPage({viewport:{width:390,height:844}});
  for(const page of [dispatcher,support])page.on('pageerror',e=>errors.push(e.message));
  await dispatcher.goto(url+'/?actor=5&support=1');
  await dispatcher.getByRole('button',{name:/^Case /}).click();
  assert.doesNotMatch(await dispatcher.locator('body').innerText(),/Contractor reply from browser|Please review this selected message only/);
  await dispatcher.getByLabel('Reason for access / action').fill('Assign selected evidence investigation');
  await dispatcher.getByRole('button',{name:'Choose authorized support staff'}).click();
  await dispatcher.getByRole('option',{name:'Fixture Management'}).waitFor({state:'attached'});
  await dispatcher.getByLabel('Assigned staff',{exact:true}).selectOption(db.id(3));
  await dispatcher.getByRole('button',{name:'Assign case',exact:true}).click();
  await dispatcher.getByRole('region',{name:'Selected support case'}).waitFor({state:'detached'});
  await support.goto(url+'/?actor=3&support=1');
  await support.getByRole('button',{name:/^Case /}).click();
  await support.getByLabel('Reason for access / action').fill('Investigate selected communication');
  await support.getByRole('button',{name:'Open selected evidence'}).click();
  await support.getByText('Please review this selected message only.',{exact:true}).waitFor();
  await support.getByRole('button',{name:/View selected message /}).click();
  await support.getByText('Contractor reply from browser',{exact:true}).waitFor();
  await support.getByRole('button',{name:'View image'}).click();
  await support.getByRole('img',{name:'work-photo.webp'}).waitFor();
  assert.equal(await support.getByRole('button',{name:'Download PDF',exact:true}).count(),0,'Unselected PDF stays private');
  assert.doesNotMatch(await support.locator('body').innerText(),/Earlier fixture message|Owner message from browser/);
  await support.screenshot({path:path.join(output,'support-390.png'),fullPage:true});
  assert.ok(await support.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'support mobile overflow');
  await support.getByRole('button',{name:'Mark closed',exact:true}).click();
  await support.getByRole('region',{name:'Selected support case'}).waitFor({state:'detached'});
  assert.doesNotMatch(await support.locator('body').innerText(),/Contractor reply from browser/);
  const audit=(await db.query("select action from dekez_chat_private.audit where action like 'support_%'")).rows.map(r=>r.action);
  for(const action of ['support_requested','support_assigned','support_report_view','support_message_view','support_status_changed'])assert.ok(audit.includes(action));
  assert.ok(audit.includes('support_file_view'));
  const setup=await browser.newPage({viewport:{width:820,height:1180}});setup.on('pageerror',e=>errors.push(e.message));
  await setup.goto(url+'/?actor=5&setup=1');
  await setup.getByRole('option',{name:'Fixture Contractor · contractor_preview'}).first().waitFor({state:'attached'});
  await setup.getByLabel('Reason for access change').fill('Review existing contractor assignment');
  await setup.getByLabel('Account',{exact:true}).selectOption(db.id(4));
  await setup.getByLabel(/Contractor pilot:/).check();
  await setup.getByRole('button',{name:'Save account chat access'}).click();
  await setup.getByRole('status').filter({hasText:'Chat capability saved'}).waitFor();
  await setup.getByLabel('Participant A',{exact:true}).selectOption(db.id(1));
  await setup.getByLabel('Participant B',{exact:true}).selectOption(db.id(4));
  await setup.getByLabel('Property',{exact:true}).selectOption(db.id(20));
  await setup.getByRole('button',{name:'Load active jobs for this property'}).click();
  await setup.getByRole('option',{name:'FIXTURE-JOB-1 · in_progress'}).waitFor({state:'attached'});
  await setup.getByLabel('Active job (required for contractors)').selectOption(db.id(30));
  await setup.getByRole('button',{name:'Authorize relationship',exact:true}).click();
  await setup.getByRole('status').filter({hasText:'Relationship authorized'}).waitFor();
  assert.equal(await setup.getByLabel('Relationship reference').inputValue(),db.id(50));
  for(const [width,height] of sizes){await setup.setViewportSize({width,height});assert.ok(await setup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`setup overflow ${width}`);}
  await setup.setViewportSize({width:820,height:1180});await setup.screenshot({path:path.join(output,'access-820.png'),fullPage:true});
  await owner.bringToFront();
  for(const [width,height] of sizes){
   await owner.setViewportSize({width,height});
   const problems=await owner.evaluate(()=>{
    const issues=[];if(document.documentElement.scrollWidth>innerWidth+1)issues.push('horizontal overflow');
    const input=document.querySelector('#dekez-chat-message');
    if(parseFloat(getComputedStyle(input).fontSize)<16)issues.push('small input');
    if(getComputedStyle(document.querySelector('.inbox')).display!==(innerWidth<768?'none':'block'))issues.push('inbox breakpoint');
    for(const button of document.querySelectorAll('button'))if(button.getBoundingClientRect().height>0&&button.getBoundingClientRect().height<44)issues.push('small touch target');
    return issues;
   });
   assert.deepEqual(problems,[],`${width}x${height}`);
   if([390,820,1440].includes(width))await owner.screenshot({path:path.join(output,`chat-${width}.png`),fullPage:true});
  }
  await db.query("update maintenance_tickets set status='completed' where id=$1",[db.id(30)]);
  await owner.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await owner.getByRole('status').filter({hasText:'Conversation closed'}).waitFor();
  assert.equal(await owner.getByLabel('Message',{exact:true}).count(),0);
  assert.ok(await owner.locator('.history article').count()>0);
  const blocked=await contractor.evaluate(async id=>(await fetch('/api/dekez-chat/4',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'send',conversationId:id,body:'After closure',clientKey:crypto.randomUUID()})})).status,db.conversation);
  assert.equal(blocked,403);
  await owner.getByRole('button',{name:'New chat',exact:true}).click();
  await contacts.getByRole('button',{name:/^Fixture Management management/}).waitFor();
  assert.doesNotMatch(await contacts.innerText(),/Fixture Contractor/);
  // Contractor contacts disappear after closure; Owner/Admin desk remains scoped.
  await contractor.getByRole('button',{name:'New chat',exact:true}).click();
  await contractor.getByText('No new contacts are available.',{exact:false}).waitFor();
  assert.equal(await contractor.getByRole('button',{name:/DEKEZ Support/}).count(),0);
  await contacts.getByRole('button',{name:/DEKEZ Support/}).click();
  await owner.getByLabel('Message',{exact:true}).fill('Owner support question');
  await owner.getByRole('button',{name:'Send message',exact:true}).click();
  await owner.locator('.history').getByText('Owner support question',{exact:true}).waitFor();
  const deskAdmin=await browser.newPage({viewport:{width:1440,height:900}});
  deskAdmin.on('pageerror',e=>errors.push(e.message));
  await deskAdmin.goto(url+'/?actor=5');
  await deskAdmin.getByRole('button',{name:/Fixture Owner/}).click();
  await deskAdmin.locator('.history').getByText('Owner support question',{exact:true}).waitFor();
  await deskAdmin.getByLabel('Message',{exact:true}).fill('Admin desk reply');
  await deskAdmin.getByRole('button',{name:'Send message',exact:true}).click();
  await deskAdmin.locator('.history').getByText('Admin desk reply',{exact:true}).waitFor();
  await owner.evaluate(()=>window.dispatchEvent(new Event('fixture-chat-change')));
  await owner.locator('.history').getByText('Admin desk reply',{exact:true}).waitFor();
  await deskAdmin.screenshot({path:path.join(output,'contact-desk-desktop.png'),fullPage:true});
  await owner.setViewportSize({width:390,height:844});
  await owner.screenshot({path:path.join(output,'contact-desk-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  assert.ok(network.every(r=>['GET','POST'].includes(r.method)));
  console.log(JSON.stringify({passed:true,viewports:sizes,screenshots:output,checks:['40-message initial page','older pagination','authorized contacts only','retry retains draft and key','owner sends','contractor replies','scoped invalidation updates UI','selected support evidence','metadata-only dispatch','temporary case assignment','assigned evidence view audited','closed support case clears evidence','closed job read-only','closed-job API denial','contact removed after closure','no browser exceptions'],boundary:'Synthetic auth + actual UI/API/SQL; NOT live Supabase Realtime, Storage or production auth'},null,2));
 } catch(error) {
  if(browser) for(const [i,page] of browser.contexts().flatMap(context=>context.pages()).entries()) {
   await page.screenshot({path:path.join(output,`failure-${i}.png`),fullPage:true}).catch(()=>{});
   console.error('Failure page',i,await page.locator('body').innerText().catch(()=>''));
  }
  console.error('Browser check failed:',output,error); throw error;
 }
 finally {await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db?.close();if(saved===undefined)delete process.env.DEKEZ_CHAT_ENABLED;else process.env.DEKEZ_CHAT_ENABLED=saved;if(savedFiles===undefined)delete process.env.DEKEZ_CHAT_FILES_ENABLED;else process.env.DEKEZ_CHAT_FILES_ENABLED=savedFiles;if(savedRealtime===undefined)delete process.env.DEKEZ_CHAT_REALTIME_ENABLED;else process.env.DEKEZ_CHAT_REALTIME_ENABLED=savedRealtime;}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
