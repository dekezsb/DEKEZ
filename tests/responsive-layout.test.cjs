const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function withoutClasses(source){const file=ts.createSourceFile('screen.tsx',source.replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const result=ts.transform(file,[context=>{const walk=node=>ts.isJsxAttribute(node)&&node.name.getText(file)==='className'?undefined:ts.visitEachChild(node,walk,context);return n=>ts.visitNode(n,walk);}]);const printed=ts.createPrinter().printFile(result.transformed[0]);result.dispose();return printed;}
test('Claims and Rent Due Tracker differ only in CSS classes; queries, statuses and actions unchanged',()=>{
 // Non-presentation AST baselines from production fd52dea; portable to CI without .git.
 const baseline={'app/claims/page.tsx':'891f06400a91bda307938fb3067e274c750f1fb7c30ce051146d5af434a2f6b7','app/rent-due-tracker/page.tsx':'83b73eef7f3f97e2b9770c8e7c6fd64a6fd67756e972962778d86c5d73e38105'};
 for(const f of ['app/claims/page.tsx','app/rent-due-tracker/page.tsx']){
 assert.equal(crypto.createHash('sha256').update(withoutClasses(read(f))).digest('hex'),baseline[f],f);
 }
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
