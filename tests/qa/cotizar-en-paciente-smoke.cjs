// Humo de navegador: «Cotizar» a un paciente abre su pestaña Tratamiento con el presupuesto ahí mismo; sin plan aprobado cae a Cotizaciones.
//   NODE_PATH=$(npm root -g) node tests/qa/cotizar-en-paciente-smoke.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1100 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8');
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  const P = 'p2000000-0000-4000-8000-000000000002', P3 = 'p3000000-0000-4000-8000-000000000003';
  await page.evaluate((P) => { window.miRolEquipo = 'dueño'; const T = window.__db.camila_pacientes[0].tenant_id;
    const snap = { name: 'Limpieza', patient_name: 'Limpieza', category: 'preventive', specialty: 'preventive', scope_type: 'session', pricing_mode: 'fixed', reference_price: 800, currency: 'MXN', sat_product_service_code: '85121800', sat_unit_code: 'E48', tax_object_code: '02', fiscal_status: 'reviewed' };
    window.__db.smyl_services = [{ id: '50000000-0000-4000-8000-000000000001', tenant_id: T, ...snap, active: true, catalog_revision: 1, tax_treatment: 'exempt' }];
    window.__db.smyl_proposals = []; window.__db.smyl_proposal_events = []; window.__db.smyl_branches = [{ id: 'b1', tenant_id: T, name: 'Principal', is_default: true, active: true }];
    window.__db.smyl_clinical_plans = [{ tenant_id: T, patient_id: P, revision: 2, status: 'reviewed', treatment_id: null, updated_by: T, reviewed_by: T, updated_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), document: { schema: 2, reason: '', background: '', assessment: 'x', treatments: [{ id: 't1', name: 'Limpieza', area: '', notes: '', phase: 'prevent', service_id: '50000000-0000-4000-8000-000000000001', service_revision: 1, service_snapshot: snap, teeth: [], surfaces: [] }] } }]; }, P);
  await page.evaluate(() => ir('propuestas')); await page.waitForTimeout(1500);
  await page.evaluate((P) => window.SmylProposals.forPatient(P), P); await page.waitForTimeout(4500);
  check(await page.evaluate(() => document.getElementById('p-paciente-detalle').classList.contains('activa')), 'desde Cotizaciones se abre el expediente del paciente');
  check(await page.locator('#cw-quote-host:not([hidden]) #proposal-form').count() === 1, 'el presupuesto se arma dentro de la pestaña Tratamiento');
  check(await page.locator('#cw-quote-host .proposal-item').count() === 1, 'trae el concepto del plan');
  // Sin plan aprobado: cae a Cotizaciones, que explica qué falta.
  await page.evaluate((P3) => window.SmylProposals.forPatient(P3), P3); await page.waitForTimeout(5000);
  check(await page.evaluate(() => document.getElementById('p-propuestas').classList.contains('activa')), 'sin plan aprobado cae a la pantalla de Cotizaciones');
  check(/ANTES DE COTIZAR|no tiene plan|sin revisar/i.test(await page.textContent('#p-propuestas')), 'y explica por qué no se puede cotizar todavía');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
