const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function withoutClasses(source){const file=ts.createSourceFile('screen.tsx',source.replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const result=ts.transform(file,[context=>{const walk=node=>ts.isJsxAttribute(node)&&node.name.getText(file)==='className'?undefined:ts.visitEachChild(node,walk,context);return n=>ts.visitNode(n,walk);}]);const printed=ts.createPrinter().printFile(result.transformed[0]);result.dispose();return printed;}
test('Claims approved batch loading and Rent Due Tracker retain reviewed non-layout baselines',()=>{
 // Claims baseline deliberately updated for the 2026-10-23 storage batching.
 // Original queries and rendered controls remain fingerprinted separately below.
 const baseline={'app/claims/page.tsx':'c8f59e04db573b5ec3d8c21b4e58bc364592de9ab77e7c7c577fada111f40f9b','app/rent-due-tracker/page.tsx':'83b73eef7f3f97e2b9770c8e7c6fd64a6fd67756e972962778d86c5d73e38105'};
 for(const f of ['app/claims/page.tsx','app/rent-due-tracker/page.tsx']){
 assert.equal(crypto.createHash('sha256').update(withoutClasses(read(f))).digest('hex'),baseline[f],f);
 }
});

test('Claims batching preserves original database queries, displayed amounts, statuses and controls',()=>{
 const source=read('app/claims/page.tsx').replace(/\r\n/g,'\n');
 const file=ts.createSourceFile('claims.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const printer=ts.createPrinter(),queries=[];
 function walk(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['select','eq','in','order'].includes(node.expression.name.text)) queries.push(printer.printNode(ts.EmitHint.Unspecified,node,file));
  ts.forEachChild(node,walk);
 }
 walk(file);
 const page=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ClaimsPage');
 const jsx=page.body.statements.filter(ts.isReturnStatement).at(-1).expression;
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 // Both fingerprints taken from production b8d0130, before batching.
 assert.equal(hash(queries.join('\n')),'1ebbd109fe4f9a86a3d7d1cb6e20ebc0eae64fc92bec25eca0d9bcb31be367e0');
 assert.equal(hash(printer.printNode(ts.EmitHint.Unspecified,jsx,file)),'ecfd6be3f9708bb0baa1306599d68252f577f6ddfbaaedc759ec48ab6a3413cf');
});
test('same management navigation, links, permissions and logout action remain',()=>{
 const src=read('components/app-shell.tsx');
 assert.match(src,/consolidateBillNavigation\(roleNavigation\[role\]\.filter/);
 assert.match(src,/hasModuleAccess\(access, item.module\)/);
 assert.match(src,/href=\{item.href\}/);assert.match(src,/action="\/logout" method="post"/);
 const admin=src.split('if (role === "admin")')[1].split('\n  return (')[0];
 assert.equal((admin.match(/<nav\b/g)||[]).length,1);assert.match(admin,/navigation\.map/);assert.doesNotMatch(admin,/navigation\.slice/);
});
test('responsive rules reflow rather than scale, isolate tables and preserve print',()=>{
 const css=read('app/globals.css').split('/* Presentation only.')[1];
 assert.match(css,/@media screen/);assert.match(css,/min-width: 1024px/);assert.match(css,/min-width: 1440px/);
 assert.match(css,/max-width: 1600px/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/100dvh/);assert.match(css,/font-size: 16px/);
 assert.doesNotMatch(css,/(?:transform\s*:.*scale|zoom\s*:)/);
 assert.match(read('components/ui/table.tsx'),/min-w-0 w-full max-w-full overflow-auto/);
 assert.match(read('app/claims/page.tsx'),/claim-receipts flex min-w-0 flex-wrap/);
});
