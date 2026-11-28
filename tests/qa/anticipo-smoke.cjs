// Humo de navegador: la cotización lleva el anticipo al aceptar (editor, vista previa y guardado).
//   NODE_PATH=$(npm root -g) node tests/qa/anticipo-smoke.cjs
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
    const snap = { name: 'Implante', patient_name: 'Implante', category: 'implantology', specialty: 'implantology', scope_type: 'tooth', pricing_mode: 'fixed', reference_price: 10000, currency: 'MXN', sat_product_service_code: '85121800', sat_unit_code: 'E48', tax_object_code: '02', fiscal_status: 'reviewed' };
    window.__db.smyl_services = [{ id: '50000000-0000-4000-8000-000000000001', tenant_id: T, ...snap, active: true, catalog_revision: 1, tax_treatment: 'exempt' }];
    window.__db.smyl_proposals = []; window.__db.smyl_proposal_events = []; window.__db.smyl_branches = [{ id: 'b1', tenant_id: T, name: 'Principal', is_default: true, active: true }];
    window.__db.smyl_clinical_plans = [{ tenant_id: T, patient_id: P, revision: 2, status: 'reviewed', treatment_id: null, updated_by: T, reviewed_by: T, updated_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), document: { schema: 2, reason: '', background: '', assessment: 'x', treatments: [{ id: 't1', name: 'Implante', area: '', notes: '', phase: 'treat', service_id: '50000000-0000-4000-8000-000000000001', service_revision: 1, service_snapshot: snap, teeth: [], surfaces: [] }] } }]; }, P);
  await page.evaluate((P) => window.SmylProposals.forPatient(P), P); await page.waitForTimeout(1800);
  check(await page.locator('#proposal-down').count() === 1, 'el editor tiene el campo «Anticipo al aceptar»');
  check(await page.inputValue('#proposal-down') === '30', 'una cotización nueva sale con 30 % de anticipo');
  check(/Anticipo al aceptar \(30 %\): \$3,000\.00/.test(await page.textContent('#proposal-down-note')), 'el resumen muestra $3,000 de anticipo sobre $10,000');
  await page.click('#proposal-preview'); await page.waitForTimeout(800);
  let paper = await page.evaluate(() => (document.getElementById('proposal-preview-paper') || {}).innerText || '');
  check(/Anticipo al aceptar \(30 %\)/.test(paper) && /\$3,000/.test(paper) && /El resto se paga conforme se realiza/.test(paper), 'la vista previa para el paciente muestra el anticipo y que el resto se paga al realizar cada tratamiento');
  await page.evaluate(() => document.querySelector('#proposal-preview-dialog [type=button],#proposal-preview-dialog button').click()); await page.waitForTimeout(300);
  await page.selectOption('#proposal-down', ''); await page.waitForTimeout(200);
  check((await page.textContent('#proposal-down-note')).trim() === '', 'sin anticipo desaparece la nota');
  await page.selectOption('#proposal-down', '50'); await page.waitForTimeout(200);
  await page.click('#proposal-save'); await page.waitForTimeout(1200);
  const saved = await page.evaluate(() => { const c = (window.__calls || []).filter(x => x[0] === 'rpc' && /^smyl_save_proposal/.test(x[1])).pop(); return c ? c[2].p_document : null; });
  check(saved && saved.down_payment_pct === 50, 'al guardar, el documento enviado lleva down_payment_pct = 50 (' + JSON.stringify(saved && saved.down_payment_pct) + ')');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
