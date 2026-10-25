const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function behavior(source){
 const file=ts.createSourceFile('component.tsx',source.replace(/\r\n/g,'\n').replace(/\bdekez-(?:card|table-scroll|table|button|primary|secondary|outline|ghost|danger) /g,''),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const result=ts.transform(file,[context=>{const walk=node=>{
  if(ts.isJsxAttribute(node)&&['className','aria-current'].includes(node.name.getText(file)))return undefined;
  if(ts.isJsxText(node)&&!node.text.trim())return undefined;
  if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(file)==='className'&&p.initializer&&ts.isStringLiteral(p.initializer)&&['tenant-nav-brand','management-nav-brand'].includes(p.initializer.text)))return undefined;
  return ts.visitEachChild(node,walk,context);
 };return n=>ts.visitNode(n,walk);}]);
 const printed=ts.createPrinter({removeComments:true}).printFile(result.transformed[0]);result.dispose();return printed;
}
test('UI-only component changes preserve all non-presentation code and existing controls',()=>{
 for(const file of ['components/app-shell.tsx','components/ui/card.tsx','components/ui/button.tsx','components/ui/table.tsx']){
  assert.equal(behavior(read(file)),behavior(read('artifacts/portal-consistency/before/'+file)),file);
 }
});
test('shared theme uses Owner values and does not restyle semantic status colours',()=>{
 const tokens=read('app/portal-tokens.css'),css=read('app/globals.css').split('/* Shared Owner-derived UI.')[1];
 for(const value of ['#fbf8f1','#fffdf8','#17130d','#8a641d','#e8e1d5','232px','16px'])assert.ok(tokens.includes(value));
 assert.match(css,/@media screen/);assert.match(css,/min-width:1024px/);assert.match(css,/safe-area-inset-bottom/);
 assert.doesNotMatch(css,/\.text-(red|blue|green)|\.bg-(red|blue|green)|zoom:|transform:.*scale|overflow-x:hidden/);
 assert.match(read('components/ui/button.tsx'),/destructive: "dekez-danger bg-red-600 text-white hover:bg-red-700/);
});
test('chat presentation changes preserve bubble icon, red unread badge and all behavior',()=>{
 const css=read('components/chat/launcher.module.css');assert.match(css,/\.badge\{[^}]*background:#c62828/);
 const launcher=read('components/chat/launcher.tsx');assert.match(launcher,/MessageCircle/);assert.match(launcher,/count > 0/);
 const before=read('artifacts/portal-consistency/before/components/chat/workspace.module.css');
 assert.ok(read('components/chat/workspace.module.css').replace(/\r\n/g,'\n').startsWith(before.replace(/\r\n/g,'\n')));
});
