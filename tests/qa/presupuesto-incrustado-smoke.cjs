// Humo de navegador: el presupuesto se arma dentro de la pestaña Tratamiento del paciente.
//   NODE_PATH=$(npm root -g) node tests/qa/presupuesto-incrustado-smoke.cjs
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
  const P = 'p2000000-0000-4000-8000-000000000002';
  await page.evaluate((P) => { window.miRolEquipo = 'dueño'; const T = window.__db.camila_pacientes[0].tenant_id;
    const snap = (n, price) => ({ name: n, patient_name: n, category: 'preventive', specialty: 'preventive', scope_type: 'session', pricing_mode: 'fixed', reference_price: price, currency: 'MXN', sat_product_service_code: '85121800', sat_unit_code: 'E48', tax_object_code: '02', fiscal_status: 'reviewed' });
    window.__db.smyl_services = [{ id: '50000000-0000-4000-8000-000000000001', tenant_id: T, ...snap('Limpieza dental', 800), active: true, catalog_revision: 1, tax_treatment: 'exempt' }];
    window.__db.smyl_proposals = []; window.__db.smyl_proposal_events = []; window.__db.smyl_branches = [{ id: 'b1', tenant_id: T, name: 'Principal', is_default: true, active: true }];
    window.__db.smyl_clinical_plans = [{ tenant_id: T, patient_id: P, revision: 2, status: 'reviewed', treatment_id: null, updated_by: T, reviewed_by: T, updated_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), document: { schema: 2, reason: 'Dolor', background: '', assessment: 'Caries', treatments: [{ id: 't1', name: 'Limpieza dental', area: '', notes: '', phase: 'prevent', service_id: '50000000-0000-4000-8000-000000000001', service_revision: 1, service_snapshot: snap('Limpieza dental', 800), teeth: [], surfaces: [] }] } }]; }, P);
  await page.evaluate((P) => window.verPaciente(P), P); await page.waitForTimeout(2500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,[role=tab]')].find(x => /^Tratamiento$/.test(x.textContent.trim())); if (b) b.click(); }); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.cw-step[data-label="Presupuesto y aceptación"]').click()); await page.waitForTimeout(700);
  check(await page.locator('#cw-quote-host').count() === 1, 'el presupuesto tiene su espacio dentro de la pestaña');
  await page.evaluate(() => [...document.querySelectorAll('.cw-action-row button')].find(b => /presupuesto/i.test(b.textContent)).click()); await page.waitForTimeout(2200);
  check(await page.locator('#cw-quote-host:not([hidden]) #proposal-form').count() === 1, '«Preparar presupuesto» monta el editor dentro de la pestaña');
  check(!(await page.evaluate(() => document.getElementById('p-propuestas').classList.contains('activa'))), 'no se sale a la pantalla de Cotizaciones');
  check(await page.locator('#cw-quote-host .proposal-item').count() === 1, 'trae el concepto del plan con su precio');
  check((await page.inputValue('#cw-quote-host #proposal-terms')).length > 20, 'vigencia y condiciones vienen escritas');
  await page.screenshot({ path: '/tmp/presupuesto-incrustado.png' });
  await page.click('#cw-quote-host .clinic-back'); await page.waitForTimeout(600);
  check(await page.locator('#cw-quote-host:not([hidden])').count() === 0, '«Volver al paciente» cierra el editor y regresa al recorrido');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
