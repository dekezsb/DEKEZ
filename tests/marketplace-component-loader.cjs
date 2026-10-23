// Test-only renderer for real application components. No Supabase or credentials.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
module.exports = function makeLoader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', code)(id => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id === 'next/link') return { __esModule: true, default: ({ prefetch, children, ...props }) => React.createElement('a', props, children) };
      if (id === 'next/image') return { __esModule: true, default: ({ priority, ...props }) => React.createElement('img', props) };
      if (id.includes('supabase') || id === '@/lib/auth/session') throw Error('Live services are forbidden in this renderer');
      if (id.startsWith('@/') || id.startsWith('.')) {
        const target = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        if (target.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
        for (const ext of ['.ts', '.tsx']) if (fs.existsSync(target + ext)) return load(target + ext);
      }
      return require(id);
    }, mod, mod.exports);
    return mod.exports;
  }
  return load;
};
