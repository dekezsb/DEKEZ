// Actual interactive React control with browser-local synthetic actions only.
// Real server-action authorization and database safety are covered separately.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),fixtures=path.join(__dirname,'fixtures/management-report-ui');
const {webpack}=require('next/dist/compiled/webpack/webpack');
async function run(){
 let server,browser;const output=fs.mkdtempSync(path.join(os.tmpdir(),'dekez-report-test-ui-'));
 try{
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(fixtures,'entry.jsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.jsx','.js'],alias:{'@':root}},plugins:[new webpack.NormalModuleReplacementPlugin(/^\.\/actions$/,resource=>{if(resource.context===path.join(root,'app/admin-setup/management-report'))resource.request=path.join(fixtures,'actions.js');})],module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/payment-rows/loader.cjs')}]}});
  await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve())));
  const cssDir=path.join(root,'.next/static/chunks'),css=fs.readdirSync(cssDir).filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync(path.join(cssDir,file),'utf8')).join('\n');
  server=http.createServer((request,response)=>{
   if(request.url==='/fixture.js'){response.setHeader('Content-Type','text/javascript');return response.end(fs.readFileSync(path.join(output,'fixture.js')));}
   response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="app-responsive internal-shell"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{if(route.request().url().startsWith(base+'/'))return route.continue();external.push(route.request().url());return route.abort();});
  const artifacts=path.join(root,'artifacts/whapi-single-use-test');fs.mkdirSync(artifacts,{recursive:true});
  await page.goto(base);assert.deepEqual(await page.evaluate(()=>window.fixtureActions||[]),[]);
  await page.getByRole('button',{name:'Request one-time test',exact:true}).click();await page.getByText('Review one authorized [TEST] report',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixtureActions),['request']);
  const send=page.getByRole('button',{name:'Send one [TEST] report',exact:true});assert.equal(await send.isDisabled(),true);
  for(const [width,height] of [[320,568],[390,844],[820,1180],[1024,768],[1440,900]]){
   await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);await page.screenshot({path:path.join(artifacts,`one-time-review-${width}.png`),fullPage:true});
  }
  await page.getByRole('checkbox').check();assert.equal(await send.isDisabled(),false);await send.click();
  await page.getByRole('button',{name:'Processing authorization…',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Processing authorization…',exact:true}).isDisabled(),true);
  await page.getByRole('status').filter({hasText:'Delivery is uncertain'}).waitFor();assert.equal(await page.getByRole('button').count(),0);assert.deepEqual(await page.evaluate(()=>window.fixtureActions),['request','execute']);
  await page.goto(base);await page.getByRole('button',{name:'Request one-time test',exact:true}).click();await page.getByRole('button',{name:'Cancel authorization',exact:true}).click();await page.getByRole('status').filter({hasText:'Authorization cancelled'}).waitFor();assert.deepEqual(await page.evaluate(()=>window.fixtureActions),['request','cancel']);
  await page.goto(base+'/?expire=1');await page.getByRole('button',{name:'Request one-time test',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('alert').filter({hasText:'Authorization expired'}).waitFor();assert.equal(await page.getByRole('button',{name:'Send one [TEST] report',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.fixtureActions),['request']);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: interactive request/confirmation/pending/uncertain/cancel/expiry; no automatic action or external request; no overflow at 320/390/820/1024/1440. Synthetic UI actions only; no live authorization or WhatsApp send.');
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
