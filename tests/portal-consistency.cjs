// Read-only visual regression using the real portal components. No live services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts/portal-consistency'),baseline=path.join(output,'before');
const tenant={id:'fixture-tenancy',propertyCode:'SAMPLE',propertyName:'Sample Property',roomName:'Room D1',checkIn:'2026-07-01',dueDay:1,monthlyRent:600,contractEnd:'2027-06-30',outstandingAmount:0};
const tenantData={hasTenancy:true,profile:{fullName:'Sample Tenant'},tenancy:tenant,tenancies:[tenant],lockAccess:[],submissions:[],bills:[],topUpRequests:[]};
async function harness(script,variant,role){
 let ready;const promise=new Promise(resolve=>ready=resolve),filename=path.join(__dirname,script),nativeRequire=createRequire(filename);
 const fixtureFs=new Proxy(fs,{get(target,key){if(key==='readFileSync')return(file,...args)=>{const relative=path.relative(root,path.resolve(file)),saved=path.join(baseline,relative);return fs.readFileSync(variant==='before'&&!relative.startsWith('..')&&fs.existsSync(saved)?saved:file,...args);};return target[key];}});
 let source=fs.readFileSync(filename,'utf8');
 if(role){
  source=source.replace("if(name==='next/navigation')","if(name.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})}; if(name==='next/navigation')");
  source=source.replace("{from:path.join(root,'app/globals.css')}",`{from:path.join(root,'app/consistency-${variant}-${role}.css')}`);
  source=source.replace('[k]??k)',"[k]??load('lib/i18n.ts').translate('en',k))");
  source=source.replace('return {createSignedUrl:',"return {createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'/receipt.svg'})),error:null}),createSignedUrl:");
  source=source.replace("resolveUserAccess('admin')",`resolveUserAccess('${role}')`).replace("role:'admin',access",`role:'${role}',access`);
  if(role==='tenant'){
   source=source.replace("if(name==='next/navigation')","if(name==='@/app/payments/actions')return {uploadMonthlyPaymentProof(){throw Error('Fixture action disabled');}}; if(name==='@/components/smart-meter/electricity-top-up-pilot')return {ElectricityTopUpPilot:()=>null}; if(name==='./referral-programme')return {ReferralProgramme:()=>null}; if(name==='next/navigation')");
   source=source.replace("const claims=await load('app/claims/page.tsx').default({searchParams:Promise.resolve({})});",`const claims=React.createElement(load('components/tenant/tenant-portal.tsx').TenantHome,{data:${JSON.stringify(tenantData)}});`);
  }
  if(role==='owner'){
   // Accounting uses the existing internal role shell and shared table primitives.
   // This specimen never invokes a report query or financial action.
   source=source.replace("const claims=await load('app/claims/page.tsx').default({searchParams:Promise.resolve({})});",`const {Table,TableHeader,TableBody,TableRow,TableHead,TableCell}=load('components/ui/table.tsx');const {Card}=load('components/ui/card.tsx');const claims=React.createElement(Card,{className:'p-5'},React.createElement('h1',null,'Accounting table · layout specimen'),React.createElement('p',null,'Synthetic read-only rows. No financial calculations or actions.'),React.createElement(Table,null,React.createElement(TableHeader,null,React.createElement(TableRow,null,...['Reference','Property','Description','Date','Amount','Status'].map(x=>React.createElement(TableHead,{key:x},x)))),React.createElement(TableBody,null,...Array.from({length:5},(_,i)=>React.createElement(TableRow,{key:i},...['SAMPLE-'+i,'SLS','Long reference / receipt information retained in the table','25 Oct 2026','RM 12,345.00','Pending review'].map((x,j)=>React.createElement(TableCell,{key:j},x)))))));`);
  }
 }
 vm.runInNewContext(source,{require(name){if(name==='node:fs')return fixtureFs;if(name==='node:http')return{createServer(handler){return{listen(){ready(handler);}};}};return nativeRequire(name);},__dirname,console,URL,URLSearchParams,structuredClone,Buffer,process,setTimeout},{filename});
 return promise;
}
function signature(){const content=document.body.cloneNode(true);content.querySelectorAll('.tenant-nav-brand,.management-nav-brand').forEach(el=>el.remove());return {content:content.textContent.replace(/\s+/g,' ').trim(),controls:[...document.querySelectorAll('a,form,input,select,textarea,button')].map(el=>[el.tagName,el.getAttribute('href'),el.getAttribute('action'),el.getAttribute('method'),el.getAttribute('name'),el.getAttribute('type'),el.textContent.trim(),el.required,el.disabled])};}
(async()=>{
 const handlers={};for(const variant of ['before','after']){
  handlers[`${variant}/owner`]=await harness('owner-portal-preview.cjs',variant);
  handlers[`${variant}/contractor`]=await harness('marketplace-portal-preview.cjs',variant);
  for(const [portal,role] of [['admin','super_admin'],['management','admin'],['tenant','tenant'],['staff','maintenance_staff'],['accounting','owner']])handlers[`${variant}/${portal}`]=await harness('responsive-preview.cjs',variant,role);
 }
 const server=http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);return res.end('Read-only');}if(req.url==='/dekez-logo.jpg'){res.setHeader('Content-Type','image/jpeg');return res.end(fs.readFileSync(path.join(root,'public/dekez-logo.jpg')));}if(req.url==='/receipt.svg')return handlers['after/management'](req,res);const[,variant,portal,...rest]=req.url.split('/'),handler=handlers[`${variant}/${portal}`];if(!handler){res.writeHead(404);return res.end();}req.url='/'+rest.join('/');return handler(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const sizes=[[320,568],[375,812],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1024,1366],[1280,800],[1366,768],[1440,900],[1920,1080],[2560,1440]];
 const pages=[['owner','owner/home'],['admin','claims'],['management','claims'],['tenant','dashboard'],['contractor','admin/marketplace/contractor-preview/dashboard'],['staff','claims'],['accounting','reports'],['owner','owner/finance'],['owner','owner/documents'],['owner','owner/profile'],['owner','owner/properties'],['contractor','admin/marketplace/contractor-preview/profile'],['contractor','admin/marketplace/contractor-preview/quotations']];
 let comparisons=0;const shots=[];
 try{const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  for(const[portal,route]of pages)for(const[width,height]of sizes){await page.setViewportSize({width,height});let previous;
   for(const variant of ['before','after']){
    assert.equal((await page.goto(`http://127.0.0.1:${server.address().port}/${variant}/${portal}/${route}`)).status(),200);
    await page.evaluate(()=>document.fonts.ready);const current=await page.evaluate(signature);
    if(variant==='before')previous=current;else{
     assert.deepEqual(current,previous,`${portal} controls/routes changed`);
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${portal} overflow at ${width}`);
     if(portal==='tenant'){
      const geometry=await page.locator('.tenant-navigation').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
      assert.equal(await page.locator('.tenant-navigation a').count(),4);
      assert.ok(width>=1024?geometry.width===232&&geometry.y===0:geometry.width===width&&geometry.y>height/2,`Tenant navigation ${width}`);
     }
     if(portal!=='owner'&&portal!=='contractor')assert.ok((await page.locator('.portal-header').evaluate(el=>getComputedStyle(el).backgroundImage)).startsWith('radial-gradient(at 100% 0%, rgb(233, 221, 196) 0px, rgba(0, 0, 0, 0) 62%)'));
    }
    if([390,820,1440].includes(width)&&pages.find(p=>p[0]===portal)[1]===route){const name=`${portal}-${width}-${variant}.png`;await page.screenshot({path:path.join(output,name),fullPage:true});shots.push(name);}
   }comparisons++;
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({comparisons,sizes,pages,shots,scope:'Actual presentation components, synthetic fixtures, no live auth/database or financial submissions.'},null,2));
  const portals=['owner','admin','management','tenant','contractor','staff','accounting'];
  fs.writeFileSync(path.join(output,'review.html'),`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>DEKEZ UI consistency review</title><style>body{font:16px Arial;background:#fbf8f1;color:#17130d;margin:24px}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#8a641d}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{max-width:100%;border:1px solid #e8e1d5}section{margin-block:32px}h3{font-size:16px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>One DEKEZ design language</h1><p>Local UI-only preview · synthetic data · not deployed. Owner remains the reference. Existing content, links and form controls match before/after.</p><nav>${portals.map(p=>`<a href="#${p}">${p}</a>`).join('')}</nav>${portals.map(p=>`<section id="${p}"><h2>${p}</h2>${[390,820,1440].map(w=>`<h3>${w}px</h3><div class="pair"><div>Before<img loading="lazy" src="${p}-${w}-before.png"></div><div>After<img loading="lazy" src="${p}-${w}-after.png"></div></div>`).join('')}</section>`).join('')}</html>`);
  console.log(JSON.stringify({passed:true,comparisons,sizes,review:path.join(output,'review.html')},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
