// Local-only fictional fixtures: no database credentials or financial writes.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),fixtures=path.join(__dirname,'fixtures/renovation');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'dekez-renovation-qa-'));
const {webpack}=require('next/dist/compiled/webpack/webpack');
const compiler=webpack({mode:'development',devtool:false,entry:path.join(fixtures,'entry.jsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.jsx','.js'],alias:{'@/app/renovation/actions':path.join(fixtures,'mocks.jsx'),'next/image':path.join(fixtures,'mocks.jsx'),'@':root}},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/payment-rows/loader.cjs')}]}});
compiler.run(async(error,stats)=>{
 let server,browser;
 try {
  if(error||stats.hasErrors()) throw error||new Error(stats.toString({all:false,errors:true}));
  compiler.close(()=>{});
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')});
  server=http.createServer((req,res)=>{
   if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'fixture.js')));}
   if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css.css);}
   if(req.url==='/dekez-logo.jpg'){res.setHeader('Content-Type','image/jpeg');return res.end(fs.readFileSync(path.join(root,'public/dekez-logo.jpg')));}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url); await page.getByRole('button',{name:'+ Saved partition work',exact:true}).click();
  await page.getByLabel('Project / scope title').fill('Test new job');
  await page.getByLabel('Quantity',{exact:true}).fill('10');
  await page.getByLabel('Discount type').selectOption('percent');
  await page.getByLabel('Discount',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Save draft & preview'}).click();
  await page.waitForFunction(()=>window.savedDraft);
  const saved=await page.evaluate(()=>window.savedDraft);
  assert.equal(saved.items[0].quantity,10);assert.equal(saved.discount_value,10);assert.equal(saved.discount_kind,'percent');
  assert.equal(await page.getByRole('combobox',{name:/^Client/}).inputValue(),'test-client');
  assert.equal(await page.getByLabel('Discount type').inputValue(),'percent');
  await page.screenshot({path:path.join(output,'editor-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile editor has no horizontal scrolling');
  await page.screenshot({path:path.join(output,'editor-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1000,height:900}); await page.goto(url+'?print=1');
  await page.getByText('TOTAL CONTRACT SUM:').waitFor();
  await page.screenshot({path:path.join(output,'quotation.png'),fullPage:true});
  if(process.env.RENOVATION_PDF_QA==='1') await page.pdf({path:path.join(output,'quotation.pdf'),printBackground:true,preferCSSPageSize:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,output}));
 }catch(e){console.error(e);process.exitCode=1;}finally{await browser?.close();server?.close();compiler.close(()=>{});}
});
