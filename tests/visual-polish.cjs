// Read-only visual comparison using real portal components and existing local fixtures.
// No login, credentials, database calls, uploads or production writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const baseline = '7499e872464db3e117c14799c73dc0ce66e7a83b';
const files = ['app/globals.css', 'components/owner/portal.module.css', 'components/marketplace/contractor-portal.module.css'];
const before = Object.fromEntries(files.map(file => [path.join(root, file), execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' })]));
const decorative = new Set(['color', 'background', 'background-color', 'border-color', 'box-shadow', '--gold', '--ink', '--muted']);
function geometryCss(css) {
  const ast = postcss.parse(css.replace(/\r\n/g, '\n'));
  ast.walkComments(node => node.remove());
  ast.walkDecls(node => { if (decorative.has(node.prop)) node.remove(); });
  // Empty colour-only rules do not contribute any geometry.
  for (let i = 0; i < 4; i++) ast.walk(node => { if (node.nodes && !node.nodes.length) node.remove(); });
  const encode = node => node.type === 'decl' ? [node.prop, node.value, !!node.important] : [node.type, node.selector || node.name || '', node.params || '', node.nodes?.map(encode)];
  return ast.nodes.map(encode);
}
for (const file of files) assert.deepEqual(geometryCss(fs.readFileSync(path.join(root, file), 'utf8')), geometryCss(before[path.join(root, file)]), `${file}: non-decorative CSS changed`);
const tenancy = { id:'fixture-tenancy', propertyCode:'SAMPLE', propertyName:'Sample Property', roomName:'Room 1', checkIn:'2026-07-01', dueDay:1, monthlyRent:600, contractEnd:'2027-06-30', outstandingAmount:0 };
const tenantFixture = { hasTenancy:true, profile:{fullName:'Sample Tenant'}, tenancy, tenancies:[tenancy], lockAccess:[], submissions:[], bills:[], topUpRequests:[] };

async function harness(script, variant, role) {
  let resolveHandler;
  const ready = new Promise(resolve => { resolveHandler = resolve; });
  const filename = path.join(__dirname, script);
  const nativeRequire = createRequire(filename);
  const fixtureFs = new Proxy(fs, { get(target, key) {
    if (key === 'readFileSync') return (file, ...args) => variant === 'before' && before[path.resolve(file)] !== undefined ? before[path.resolve(file)] : fs.readFileSync(file, ...args);
    return target[key];
  }});
  let source = fs.readFileSync(filename, 'utf8');
  if (role) {
    // Separate Tailwind compiler cache keys for baseline/current source.
    source = source.replace("{from:path.join(root,'app/globals.css')}", `{from:path.join(root,'app/visual-${variant}-${role}.css')}`);
    source = source.replace("[k]??k)", "[k]??load('lib/i18n.ts').translate('en',k))");
    source = source.replace('return {createSignedUrl:', "return {createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'/receipt.svg'})),error:null}),createSignedUrl:");
    source = source.replace("resolveUserAccess('admin')", `resolveUserAccess('${role}')`).replace("role:'admin',access", `role:'${role}',access`);
    if (role === 'tenant') {
      source = source.replace("if(name==='next/navigation')", "if(name==='@/app/payments/actions')return {uploadMonthlyPaymentProof(){throw Error('Fixture action disabled');}}; if(name==='@/components/smart-meter/electricity-top-up-pilot')return {ElectricityTopUpPilot:()=>null}; if(name==='./referral-programme')return {ReferralProgramme:()=>null}; if(name==='next/navigation')");
      source = source.replace("const claims=await load('app/claims/page.tsx').default({searchParams:Promise.resolve({})});", `const claims=React.createElement(load('components/tenant/tenant-portal.tsx').TenantHome,{data:${JSON.stringify(tenantFixture)}});`);
    }
  }
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'node:fs') return fixtureFs;
      if (name === 'node:http') return {createServer(handler) {return {listen() {resolveHandler(handler);}};}};
      return nativeRequire(name);
    }, __dirname, console, URL, URLSearchParams, structuredClone, Buffer, process, setTimeout,
  }, {filename});
  return ready;
}
function measure() {
  const round = n => Math.round(n * 100) / 100;
  const rect = r => [r.x,r.y,r.width,r.height].map(round);
  const properties = ['fontSize','fontFamily','fontWeight','lineHeight','letterSpacing','display','position','padding','margin','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','gap','gridTemplateColumns','overflowX','overflowY'];
  return {
    page:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
    elements:[...document.body.querySelectorAll('*')].map(el => {
      const css = getComputedStyle(el);
      const text = [...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>{
        const range=document.createRange();range.selectNodeContents(n);
        return [n.textContent,[...range.getClientRects()].map(rect)];
      });
      return [el.tagName,el.getAttribute('href'),el.getAttribute('src'),rect(el.getBoundingClientRect()),properties.map(p=>css[p]),text];
    }),
  };
}
(async () => {
  const handlers = {};
  for (const variant of ['before','after']) {
    handlers[`${variant}/owner`] = await harness('owner-portal-preview.cjs',variant);
    handlers[`${variant}/contractor`] = await harness('marketplace-portal-preview.cjs',variant);
    for (const [portal,role] of [['management','admin'],['admin','super_admin'],['tenant','tenant']]) handlers[`${variant}/${portal}`] = await harness('responsive-preview.cjs',variant,role);
  }
  const server = http.createServer((req,res) => {
    if (req.url === '/dekez-logo.jpg') {res.setHeader('Content-Type','image/jpeg');return res.end(fs.readFileSync(path.join(root,'public/dekez-logo.jpg')));}
    if (req.url === '/receipt.svg') return handlers['after/management'](req,res);
    const [,variant,portal,...rest] = req.url.split('/');
    const handler = handlers[`${variant}/${portal}`];
    if (!handler) {res.statusCode=404;return res.end();}
    req.url='/'+rest.join('/');return handler(req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const output=path.join(root,'artifacts/visual-polish');fs.mkdirSync(output,{recursive:true});
  const sizes=[[320,568],[375,812],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1024,1366],[1280,800],[1366,768],[1440,900],[1920,1080]];
  const pages=[['admin','claims'],['management','claims'],['tenant','dashboard'],['owner','owner/home'],['contractor','admin/marketplace/contractor-preview/dashboard'],['owner','owner/properties'],['owner','owner/finance'],['owner','owner/documents'],['owner','owner/profile']];
  let comparisons=0; const screenshots=[];
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    for(const [portal,route] of pages) for(const [width,height] of sizes) {
      await page.setViewportSize({width,height});let original;
      for(const variant of ['before','after']) {
        const response=await page.goto(`${base}/${variant}/${portal}/${route}`,{waitUntil:'load'});
        assert.equal(response.status(),200,`${portal} rendering failed`);
        await page.evaluate(()=>document.fonts.ready);
        const measured=await page.evaluate(measure);
        if(variant==='after') assert.equal(await page.locator('.app-responsive,.portal').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(251, 248, 241)',`${portal}: golden-white background not applied`);
        if(variant==='before') original=measured;
        else assert.deepEqual(measured,original,`${portal}/${route} ${width}x${height}: geometry/content changed`);
        if([390,820,1440].includes(width) && pages.find(p=>p[0]===portal)?.[1]===route) {
          const file=`${portal}-${width}-${variant}.png`;
          await page.screenshot({path:path.join(output,file),fullPage:true});screenshots.push(file);
        }
      }
      comparisons++;
      console.log(`Identical geometry: ${portal}/${route} ${width}x${height}`);
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({baseline,comparisons,sizes,screenshots,scope:'Read-only component fixtures. Not live authentication or database tests.'},null,2));
    console.log(`PASS: ${comparisons} identical before/after layouts; ${screenshots.length} screenshots. ${output}`);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
