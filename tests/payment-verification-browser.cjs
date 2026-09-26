// Run manually for browser smoke checks; serves only fictional data on localhost.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http');
const root=path.resolve(__dirname,'..'),fixtures=path.join(__dirname,'fixtures/payment-rows');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'dekez-payment-row-test-'));
const {webpack}=require('next/dist/compiled/webpack/webpack');
const {NormalModuleReplacementPlugin}=webpack;
const compiler=webpack({mode:'development',devtool:false,entry:path.join(fixtures,'entry.jsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.jsx','.js'],alias:{'@':root,'next/navigation':path.join(fixtures,'mocks.jsx')}},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:path.join(fixtures,'loader.cjs')}]},plugins:[new NormalModuleReplacementPlugin(/^\.\/(actions|reference-actions)$/,resource=>{if(resource.context.endsWith('payment-verification'))resource.request=path.join(fixtures,'mocks.jsx');})]});
compiler.run(async(error,stats)=>{
 if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
 compiler.close(()=>{});
 const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')});
 const script=fs.readFileSync(path.join(output,'fixture.js'));
 http.createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(script);}
  if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css.css);}
  if(req.url==='/slip.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="#edf2f5"/><text x="8" y="25" font-size="10">TEST SLIP</text><text x="8" y="45" font-size="10">RM100.00</text></svg>');}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><title>Payment row test</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 }).listen(4317,'127.0.0.1',()=>console.log('Test-only payment row fixture: http://127.0.0.1:4317'));
});
