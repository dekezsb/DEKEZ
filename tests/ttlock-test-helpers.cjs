// Shared test helpers for TTLock eKey / meter tests. No live services.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
if (!Module._resolveFilename.__dekezPatched) {
  Module._resolveFilename = function (request, ...args) {
    return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
  };
  Module._resolveFilename.__dekezPatched = true;
  for (const ext of ['.ts', '.tsx']) {
    Module._extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
      fileName: f,
    }).outputText, f);
  }
}

const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

/**
 * Fake Supabase admin client. `tables[name]` is either rows (array) or a
 * function (ops) => { data, error } for custom answers. Every update/insert
 * is recorded in `writes`.
 */
function fakeAdmin(tables = {}) {
  const writes = [];
  function builder(table) {
    const ops = { table, filters: [], kind: 'select' };
    const answer = () => {
      const spec = tables[table];
      if (typeof spec === 'function') return spec(ops);
      return { data: spec ?? [], error: null };
    };
    const b = {
      select(columns) { ops.columns = columns; return b; },
      eq(col, val) { ops.filters.push(['eq', col, val]); return b; },
      in(col, val) { ops.filters.push(['in', col, val]); return b; },
      is(col, val) { ops.filters.push(['is', col, val]); return b; },
      not(col, op, val) { ops.filters.push(['not', col, val]); return b; },
      lt(col, val) { ops.filters.push(['lt', col, val]); return b; },
      order() { return b; },
      limit() { return b; },
      update(value) { ops.kind = 'update'; ops.value = value; writes.push({ table, kind: 'update', value, filters: ops.filters }); return b; },
      insert(value) { ops.kind = 'insert'; ops.value = value; writes.push({ table, kind: 'insert', value }); return b; },
      async maybeSingle() {
        if (ops.kind !== 'select') return { data: ops.kind === 'insert' ? { id: `${table}-new` } : null, error: null };
        const result = answer();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { data, error: result.error ?? null };
      },
      async single() {
        if (ops.kind === 'insert') return { data: { id: `${table}-new` }, error: null };
        return b.maybeSingle();
      },
      then(ok, fail) {
        const result = ops.kind === 'select' ? answer() : { data: null, error: null };
        return Promise.resolve(result).then(ok, fail);
      },
    };
    return b;
  }
  return { client: { from: builder, rpc: async () => ({ data: null, error: null }) }, writes };
}

module.exports = { root, read, fakeAdmin, loader: require('./marketplace-component-loader.cjs') };
