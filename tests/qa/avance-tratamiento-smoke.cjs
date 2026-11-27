// Humo de navegador: la etapa «En tratamiento» muestra el avance (conceptos realizados, cobrado y por cobrar).
//   NODE_PATH=$(npm root -g) node tests/qa/avance-tratamiento-smoke.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const handler = `rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);
if(name==='smyl_treatment_progress'){return {data:window.__progress||null,error:window.__progressError||null};}
`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1100 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8').replace("rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);", handler);
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  const P = 'p2000000-0000-4000-8000-000000000002';
  await page.evaluate(() => { window.miRolEquipo = 'dueño'; window.__progress = { concepts: [
    { proposal_id: 'b1', item_id: 'q1', label: 'Implante dental', quantity: 2, done: 1, scheduled: 1, amount: 36000, paid: 13000 },
    { proposal_id: 'b1', item_id: 'q2', label: 'Corona de zirconia', quantity: 1, done: 0, scheduled: 0, amount: 9500, paid: 1500 }],
    totals: { units: 3, done: 1, charged: 45500, paid: 14500, due: 31000, realized_value: 18000 } }; });
  await page.evaluate((P) => window.verPaciente(P), P); await page.waitForTimeout(2500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,[role=tab]')].find(x => /^Tratamiento$/.test(x.textContent.trim())); if (b) b.click(); }); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.cw-step[data-label="En tratamiento"]').click()); await page.waitForTimeout(1800);
  const txt = await page.evaluate(() => (document.querySelector('.cw-progress') || {}).innerText || '');
  console.log(txt.replace(/\s+/g, ' ').slice(0, 260));
  check(/1 de 3 conceptos realizados/.test(txt), 'muestra «1 de 3 conceptos realizados»');
  check(/Cobrado/.test(txt) && /\$14,500 de \$45,500/.test(txt.replace(/\s/g, ' ')), 'muestra lo cobrado contra lo cargado');
  check(/Por cobrar/.test(txt) && /\$31,000/.test(txt), 'muestra lo que falta por cobrar');
  check(/Implante dental/.test(txt) && /En curso/.test(txt) && /Corona de zirconia/.test(txt) && /Pendiente/.test(txt), 'lista cada concepto con su estado');
  check(await page.locator('.cw-progress [role=progressbar][aria-valuenow="33"]').count() === 1, 'la barra de avance marca 33 %');
  // Sin permiso de finanzas llegan los conteos pero no los importes.
  await page.evaluate(() => { window.__progress = { concepts: [{ proposal_id: 'b1', item_id: 'q1', label: 'Implante dental', quantity: 1, done: 1, scheduled: 0, amount: null, paid: null }], totals: { units: 1, done: 1, charged: null, paid: null, due: null, realized_value: null } }; document.querySelector('.cw-progress').dataset.stale = '1'; });
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await page.screenshot({ path: '/tmp/avance.png' });
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
