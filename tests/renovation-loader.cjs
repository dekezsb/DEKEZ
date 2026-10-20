const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache=new Map(),root=path.resolve(__dirname,'..');
module.exports=function load(file){
  file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(id=>{
    if(id.startsWith('@/')||id.startsWith('.')){
      const target=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);
      for(const ext of ['.ts','.tsx'])if(fs.existsSync(target+ext))return load(target+ext);
    }
    return require(id);
  },module,module.exports);return module.exports;
};
