// Local visual test harness for the actual ContractorPortal component and CSS.
// Loopback only, read-only, no credentials, account bypass or database connections.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const load = require('./marketplace-component-loader.cjs')();
const { ContractorPortal } = load('components/marketplace/contractor-portal.tsx');
const { contractorPreviewPath, contractorSection } = load('lib/marketplace/portal.ts');
const root = path.resolve(__dirname, '..');
http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Read-only preview'); }
  const url = new URL(req.url, 'http://127.0.0.1:4190');
  if (url.pathname === '/dekez-logo.jpg') {
    res.setHeader('Content-Type', 'image/jpeg'); return res.end(fs.readFileSync(path.join(root, 'public/dekez-logo.jpg')));
  }
  if (url.pathname === '/admin/marketplace') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<h1>Local Contractor layout preview</h1><p>The real management page requires Super Admin authentication in DEKEZ. This read-only test server has no account or database access.</p><a href="${contractorPreviewPath}/dashboard">Return to Contractor preview</a>`);
  }
  const section = url.pathname.startsWith(contractorPreviewPath + '/') ? contractorSection(url.pathname.slice(contractorPreviewPath.length + 1)) : null;
  if (!section) { res.writeHead(404); return res.end('Not found'); }
  try {
    const css = fs.readFileSync(path.join(root, 'components/marketplace/contractor-portal.module.css'), 'utf8');
    const html = renderToStaticMarkup(React.createElement(ContractorPortal, { section }));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>DEKEZ Contractor · Local foundation preview</title><style>body{margin:0}button,input,select{font:inherit}${css}</style></head><body>${html}</body></html>`);
  } catch (error) { console.error(error.message); res.writeHead(500); res.end('Preview could not be rendered'); }
}).listen(4190, '127.0.0.1', () => console.log(`Local read-only Contractor preview: http://127.0.0.1:4190${contractorPreviewPath}/dashboard`));
