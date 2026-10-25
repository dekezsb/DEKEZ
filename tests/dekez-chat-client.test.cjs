const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const loader=require('./marketplace-component-loader.cjs');
const {mergeMessages,requestChat,ChatRequestError}=loader()('lib/chat/client.ts');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('message source labels distinguish automatic and manual; legacy history is not guessed',()=>{
 const {messageSourceLabel}=loader()('lib/chat/client.ts');
 assert.equal(messageSourceLabel('AUTO_REMINDER'),'Automated Reminder');
 assert.equal(messageSourceLabel('WELCOME_MESSAGE'),'Automated Welcome');
 assert.equal(messageSourceLabel('SYSTEM_NOTICE'),'System Notice');
 assert.equal(messageSourceLabel('MANUAL_ADMIN'),'Manual Admin message');
 assert.equal(messageSourceLabel('USER_MESSAGE'),null);assert.equal(messageSourceLabel(null),null);
});
test('unread badge and short identity presentation',()=>{
 const {unreadLabel,shortChatName,chatInitials}=loader()('lib/chat/display.ts');
 assert.equal(unreadLabel(0),'');assert.equal(unreadLabel(99),'99');assert.equal(unreadLabel(100),'99+');
 assert.equal(shortChatName('AQIL · D1'),'AQIL · D1');assert.equal(shortChatName('Aqil Bin Long Legal Name'),'Aqil Bin');assert.equal(chatInitials('AQIL · D1'),'AD');
});
test('messages merge by identity in sequence order without duplicating events',()=>{
 const a={id:'a',seq:1,body:'one'},b={id:'b',seq:2,body:'two'};
 assert.deepEqual(mergeMessages([b],[a,b]),[a,b]);
});
test('client rejects login redirects and malformed responses without rendering raw content',async()=>{
 const original=global.fetch;
 try {
  global.fetch=async()=>({redirected:true});
  await assert.rejects(requestChat('/api/dekez-chat',new URLSearchParams()),e=>e instanceof ChatRequestError&&e.status===401);
  global.fetch=async()=>({status:503,json:async()=>{throw Error('private raw HTML');}});
  await assert.rejects(requestChat('/api/dekez-chat',{}),e=>!e.message.includes('private')&&e.status===503);
 }finally{global.fetch=original;}
});
function realtimeFixture(){
 const listeners=[],connections=[],removed=[];let status,changes=0;
 const channel={on:(kind,filter,handler)=>{listeners.push({kind,filter,handler});return channel;},subscribe:callback=>{status=callback;return channel;}};
 const client={channel:()=>channel,removeChannel:c=>{removed.push(c);return Promise.resolve();}};
 const {subscribeChat}=loader({'@/lib/supabase/client':{createClient:()=>client}})('lib/chat/realtime.ts');
 return {listeners,connections,removed,connect:s=>status(s),count:()=>changes,subscribe:id=>subscribeChat('caller',id,()=>changes++,s=>connections.push(s))};
}
test('realtime filters only the caller signal without subscribing to message bodies; bursts coalesce',async()=>{
 const f=realtimeFixture(),stop=f.subscribe('conversation-a');
 assert.deepEqual(f.listeners.map(x=>x.filter),[
  {event:'*',schema:'public',table:'dekez_chat_signals',filter:'user_id=eq.caller'}]);
 f.connect('SUBSCRIBED');for(let n=0;n<20;n++)f.listeners[0].handler({revision:4});
 await sleep(240);assert.equal(f.count(),1);
 f.connect('CHANNEL_ERROR');assert.deepEqual(f.connections,[true,false]);
 f.listeners[0].handler();stop();f.listeners[0].handler();f.connect('SUBSCRIBED');
 await sleep(240);assert.equal(f.count(),1);assert.equal(f.removed.length,1);assert.deepEqual(f.connections,[true,false]);
});
test('closed/unselected conversations retain only caller inbox subscription',()=>{
 const f=realtimeFixture(),stop=f.subscribe(null);
 assert.equal(f.listeners.length,1);assert.equal(f.listeners[0].filter.table,'dekez_chat_signals');stop();
});
test('header and workspace share one channel; final unmount removes it',async()=>{
 const f=realtimeFixture(),a=f.subscribe(null),b=f.subscribe('active');
 assert.equal(f.listeners.length,1);f.connect('SUBSCRIBED');await sleep(240);assert.equal(f.count(),2);
 a();assert.equal(f.removed.length,0);f.listeners[0].handler();await sleep(240);assert.equal(f.count(),3);
 b();assert.equal(f.removed.length,1);
});
test('portal chat entries stay gated and never join portal-wide refresh subscriptions',()=>{
 const read=file=>fs.readFileSync(file,'utf8');
 assert.match(read('components/chat/entry.tsx'),/DEKEZ_CHAT_ENABLED/);
 assert.doesNotMatch(read('components/chat/workspace.tsx'),/router\.refresh|location\.reload|localStorage|sessionStorage/);
 assert.doesNotMatch(read('lib/chat/realtime.ts'),/whatsapp|PortalLiveSync|router\.refresh/);
 assert.equal((read('components/app-shell.tsx').match(/pathname === "\/messages" \? null : <PortalLiveSync \/>/g)||[]).length,3);
 assert.match(read('components/owner/portal.tsx'),/DEKEZ_CHAT_ENABLED==="true"\?<ChatLauncher href="\/owner\/messages"/);
 assert.match(read('app/owner/messages/page.tsx'),/requireRole\(\["client_owner"\]\)/);
});
