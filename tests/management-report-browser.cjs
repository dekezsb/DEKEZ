// Actual page/Card/Button HTML + production-built CSS. Synthetic session and
// SQL snapshot only. Browser assertions are rendering tests, NOT live login/send.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
async function run(){
 let db,browser;
 try{
  db=await require('./fixtures/management-report.cjs')();
  const snapshot=(await db.query("select dekez_management_report_snapshot($1,'2026-10-25T12:00:00Z') result",[db.id(1)])).rows[0].result;
  const load=require('./marketplace-component-loader.cjs')({'server-only':{},'@/lib/auth/session':{requireRole:async()=> 'super_admin'},'@/lib/management-report/authorization':{reportAdministrator:async()=>db.id(3)},'@/lib/management-report/config':{reportConfig:()=>({recipient:'60168173911',configured:true,scopeReady:true,sendEnabled:false,testEnabled:false,scheduleEnabled:false})},'@/lib/management-report/service':{reportPreview:async()=>snapshot},'./actions':{oneTimeTestAction:async()=>{throw Error('Live authorization or sending prohibited');}}});
  const html=renderToStaticMarkup(await load('app/admin-setup/management-report/page.tsx').default());
  const cssDir=path.join(root,'.next/static/chunks');
  const css=fs.readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssDir,f),'utf8')).join('\n');
  const output=path.join(root,'artifacts/whapi-management-report');fs.mkdirSync(output,{recursive:true});
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort()); // no external network, even assets
  const document=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="app-responsive internal-shell min-h-screen"><main class="p-4 sm:p-6 lg:p-8"><p class="mb-4 text-sm">LOCAL SYNTHETIC PREVIEW — no real data or WhatsApp sending</p>${html}</main></div></body></html>`;
  await page.setContent(document);
  for(const [width,height] of [[320,568],[390,844],[820,1180],[1024,768],[1440,900]]){
   await page.setViewportSize({width,height});assert.equal(await page.getByRole('button',{name:'Request one-time test'}).isDisabled(),false);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);
   await page.screenshot({path:path.join(output,`admin-report-${width}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('PASS: actual Admin report rendering, request-only one-time control with ordinary flags disabled, no overflow at 320/390/820/1024/1440; no external requests or browser errors.');
 }finally{await browser?.close();await db?.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
