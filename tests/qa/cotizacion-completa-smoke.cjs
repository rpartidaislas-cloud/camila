// Humo de navegador de la cotización completa: servicios del catálogo, etapas y vista previa por etapas.
//   NODE_PATH=$(npm root -g) node tests/qa/cotizacion-completa-smoke.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8');
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const P = 'p2000000-0000-4000-8000-000000000002';
  await page.evaluate((P) => {
    const db = window.__db, T = db.camila_pacientes[0].tenant_id;
    const snap = (n, pm, price) => ({ name: n, patient_name: n, category: 'General', specialty: 'general', scope_type: 'tooth', pricing_mode: pm, reference_price: price, currency: 'MXN', sat_product_service_code: '85121800', sat_unit_code: 'E48', tax_object_code: '02', fiscal_status: 'reviewed' });
    db.smyl_services = [
      { id: '33333333-3333-4333-8333-333333333331', tenant_id: T, name: 'Limpieza dental', patient_name: 'Limpieza dental', category: 'Prevención', specialty: 'general', scope_type: 'session', pricing_mode: 'fixed', reference_price: 800, currency: 'MXN', sat_product_service_code: '85121800', sat_unit_code: 'E48', tax_object_code: '02', fiscal_status: 'reviewed', active: true, catalog_revision: 1 },
      { id: '33333333-3333-4333-8333-333333333332', tenant_id: T, name: 'Implante', patient_name: 'Implante dental', category: 'Cirugía', specialty: 'general', scope_type: 'tooth', pricing_mode: 'per_tooth', reference_price: 18000, currency: 'MXN', sat_product_service_code: '85121800', sat_unit_code: 'E48', tax_object_code: '02', fiscal_status: 'pending', active: true, catalog_revision: 2 }
    ];
    db.smyl_branches = [{ id: 'b1', tenant_id: T, name: 'Principal', is_default: true, active: true }];
    db.smyl_service_branch_prices = []; db.smyl_proposals = []; db.smyl_proposal_events = [];
    db.smyl_clinical_plans = [{ tenant_id: T, patient_id: P, revision: 1, status: 'reviewed', treatment_id: null, document: { schema: 2, reason: '', background: '', assessment: 'x', treatments: [
      { id: 't1', name: 'Resina', area: '', notes: '', phase: 'treat', service_id: null, service_revision: null, service_snapshot: null, teeth: [], surfaces: [] },
      { id: 't2', name: 'Profilaxis', area: '', notes: '', phase: 'prevent', service_id: null, service_revision: null, service_snapshot: null, teeth: [], surfaces: [] }] } }];
    window.miRolEquipo = 'dueño';
  }, P);
  await page.evaluate((P) => window.SmylProposals.forPatient(P), P); await page.waitForTimeout(1500);
  check(await page.locator('.proposal-item').count() === 2, 'el editor abre con los 2 conceptos del plan');
  check(await page.locator('.proposal-item select[data-field=phase]').count() === 2, 'cada concepto tiene su etapa');
  check((await page.inputValue('#proposal-valid')) !== '' && (await page.inputValue('#proposal-terms')).length > 20, 'vigencia y condiciones vienen escritas');
  check(!(await page.textContent('#proposal-items')).includes('SAT'), 'el editor no muestra códigos SAT');
  await page.click('#proposal-add-service'); await page.waitForTimeout(500);
  check(await page.locator('.proposal-service-option').count() === 2, 'el buscador lista los servicios del catálogo');
  await page.fill('.proposal-service-search', 'impl'); check(await page.locator('.proposal-service-option').count() === 1, 'el buscador filtra');
  await page.click('.proposal-service-option'); await page.waitForTimeout(300);
  check(await page.locator('.proposal-item').count() === 3, 'agrega el servicio del catálogo a la cotización');
  const added = await page.evaluate(() => { const rows = [...document.querySelectorAll('.proposal-item')], r = rows[rows.length - 1], m = JSON.parse(r.dataset.itemMeta); return { sid: m.service_id, rev: m.service_revision, tid: m.treatment_id, price: r.querySelector('[data-field=price]').value, warn: r.textContent.includes('fiscales por revisar') }; });
  check(added.sid === '33333333-3333-4333-8333-333333333332' && added.rev === 2 && added.tid === null && added.price === '18000.00', 'trae servicio, revisión y precio del catálogo');
  check(added.warn, 'avisa al equipo (no al paciente) si el servicio tiene datos fiscales por revisar');
  await page.click('.proposal-service-dialog footer button'); await page.waitForTimeout(200);
  await page.selectOption('.proposal-item:nth-child(3) select[data-field=phase]', 'maintain');
  const doc = await page.evaluate(() => { document.getElementById('proposal-title').dispatchEvent(new Event('input', { bubbles: true })); return null; });
  await page.fill('.proposal-item:nth-child(1) [data-field=price]', '500'); await page.fill('.proposal-item:nth-child(2) [data-field=price]', '300');
  await page.click('#proposal-preview'); await page.waitForTimeout(800);
  const paper = await page.evaluate(() => (document.getElementById('proposal-preview-paper') || {}).innerText || '');
  check(/Etapa 1 · Prevención/.test(paper) && /Etapa 2 · Tratamiento/.test(paper) && /Etapa 3 · Mantenimiento/.test(paper), 'la vista previa agrupa por etapas');
  check(/Subtotal de la etapa 1/.test(paper), 'muestra subtotal por etapa');
  check(!/SAT/.test(paper), 'el paciente no ve códigos SAT');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await page.screenshot({ path: path.join(process.env.TMPDIR || '/tmp', 'cotizacion-preview.png') });
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
