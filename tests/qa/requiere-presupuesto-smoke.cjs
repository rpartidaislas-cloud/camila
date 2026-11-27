// Humo de navegador: «Requiere presupuesto» en el catálogo y «Por cotizar» en Cotizaciones.
//   NODE_PATH=$(npm root -g) node tests/qa/requiere-presupuesto-smoke.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const handler = `rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);
if(name==='smyl_patients_needing_quote'){return {data:[{patient_id:'p2000000-0000-4000-8000-000000000002',patient_name:'Rich',plan_revision:1,reviewed_at:new Date().toISOString(),concepts:['Implante 36','Corona 36']}],error:null};}
`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8').replace("rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);", handler);
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  await page.evaluate(() => { window.miRolEquipo = 'dueño'; window.__db.smyl_proposals = []; window.__db.smyl_proposal_events = []; });
  await page.evaluate(() => ir('propuestas')); await page.waitForTimeout(2000);
  check(await page.locator('.proposal-toquote').count() === 1, 'Cotizaciones muestra la sección «Por cotizar»');
  const txt = await page.textContent('.proposal-toquote');
  check(/Por cotizar · 1/.test(txt) && /Rich/.test(txt) && /Implante 36/.test(txt), 'lista al paciente y los conceptos que requieren presupuesto');
  check(await page.locator('.proposal-toquote button:has-text("Preparar presupuesto")').count() === 1, 'ofrece «Preparar presupuesto»');
  // catálogo: el interruptor solo existe cuando la base ya tiene la columna
  await page.evaluate(() => { const T = window.__db.camila_pacientes[0].tenant_id; window.__db.smyl_services = [
    { id: 's1', tenant_id: T, name: 'Limpieza dental', patient_name: 'Limpieza dental', category: 'preventive', specialty: 'preventive', scope_type: 'session', pricing_mode: 'fixed', duration_minutes: 30, reference_price: 800, currency: 'MXN', fiscal_status: 'reviewed', tax_treatment: 'exempt', active: true, catalog_revision: 1, requires_quote: null },
    { id: 's2', tenant_id: T, name: 'Implante', patient_name: 'Implante dental', category: 'implantology', specialty: 'implantology', scope_type: 'tooth', pricing_mode: 'per_tooth', duration_minutes: 90, reference_price: 18000, currency: 'MXN', fiscal_status: 'reviewed', tax_treatment: 'exempt', active: true, catalog_revision: 1, requires_quote: null }]; });
  await page.evaluate(() => ir('precios')); await page.waitForTimeout(2000);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.catalog-service')].map(c => c.textContent.replace(/\s+/g, ' ')));
  check(cards.some(c => /Implante/.test(c) && /Requiere presupuesto/.test(c)), 'Implante (implantología) aparece con «Requiere presupuesto» por defecto');
  check(!cards.some(c => /Limpieza/.test(c) && /Requiere presupuesto/.test(c)), 'Limpieza no lo requiere por defecto');
  await page.evaluate(() => document.querySelector('[data-edit="s1"]').click()); await page.waitForTimeout(600);
  check(await page.locator('#catalog-dialog [name=requires_quote]').count() === 1 && !(await page.locator('#catalog-dialog [name=requires_quote]').isChecked()), 'el editor muestra el interruptor, apagado para limpieza');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
