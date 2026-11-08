// Humo de navegador de «Pacientes pendientes de cargo» en Cobros, con un Supabase simulado (tests/qa/fake-supabase-cobros.js).
//   NODE_PATH=$(npm root -g) node tests/qa/cobros-pending-visits-smoke.cjs      (requiere Playwright y Chromium)
// Comprueba: la lista (3 pacientes; excluye Revisión de $0, cita ya cobrada y cita no llegada), el formulario de cargo con la
// cita y el servicio ya elegidos, «Sin cargo» con motivo, «Reabrir» y que una llegada nueva aparece sin recargar. Sale con código 1 si algo falla.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..'), S = __dirname; // los datos viven en fake-supabase-cobros.js; las capturas se guardan en la carpeta temporal
const shots = require('os').tmpdir();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(S, 'fake-supabase-cobros.js'), 'utf8') }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.evaluate(() => ir('caja')); await page.waitForTimeout(2000);
  const rows = () => page.$$eval('.finance-visit-row', els => els.map(e => ({ nombre: e.querySelector('strong').textContent, estado: e.dataset.visitState, badge: e.querySelector('.finance-badge').textContent, botones: [...e.querySelectorAll('button')].map(x => x.textContent) })));
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); failCount++; } };
  let failCount = 0;
  const r1 = await rows(); console.log('1) pendientes:', JSON.stringify(r1));
  check(r1.map(r => r.nombre).join('|') === 'La doña 2|Rich|Paciente de LANA', 'la lista debe tener 3 pendientes, la ya terminada primero');
  console.log('   título:', await page.$eval('.finance-visits-card h2', e => e.textContent));
  await page.screenshot({ path: shots + '/cobros-pendientes.png' });
  await page.click('[data-visit-charge="a2"]'); await page.waitForTimeout(600);
  const form = await page.evaluate(() => { const f = document.querySelector('.finance-charge-form'); return f && { paciente: f.elements.patient.value.slice(0, 2), cita: f.elements.appointment.value, servicio: f.elements.service.value, precio: f.elements.price.value, concepto: f.elements.concept.value }; });
  console.log('2) Agregar cargo →', JSON.stringify(form)); check(form && form.cita === 'a2' && form.servicio === 's1' && form.precio === '800.00', 'Agregar cargo debe abrir el formulario con cita y servicio elegidos');
  await page.screenshot({ path: shots + '/cobros-agregar-cargo.png' });
  await page.evaluate(() => document.getElementById('finance-dialog').close()); await page.waitForTimeout(200);
  await page.click('[data-visit-nocharge="a1"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: shots + '/cobros-sin-cargo.png' });
  await page.selectOption('.finance-nocharge select[name=reason]', 'review'); await page.fill('.finance-nocharge input[name=note]', 'Control'); await page.click('.finance-nocharge button[type=submit]'); await page.waitForTimeout(1500);
  check(await page.$eval('.finance-visits-closed summary', e => e.textContent).then(t => /\(1\)/.test(t)).catch(() => false), '«Sin cargo» debe dejarla en Cerradas sin cargo (1)');
  console.log('3) tras «Sin cargo» a1:', JSON.stringify((await rows()).map(r => r.nombre)), '| cerradas:', await page.$eval('.finance-visits-closed summary', e => e.textContent).catch(() => 'no hay'));
  console.log('   rpc:', JSON.stringify(await page.evaluate(() => window.__calls.filter(c => c[0] === 'rpc' && c[1].includes('no_charge')).map(c => [c[1], c[2].p_reason, c[2].p_note]))));
  await page.click('.finance-visits-closed summary'); await page.click('[data-visit-reopen="a1"]'); await page.waitForTimeout(1500);
  const r4 = (await rows()).map(r => r.nombre); console.log('4) tras reabrir:', JSON.stringify(r4)); check(r4.length === 3, 'reabrir debe devolverla a pendientes');
  // llega un paciente nuevo mientras Cobros ya estaba cargado: al volver a entrar debe aparecer
  await page.evaluate(() => { window.__db.smyl_appointments.push({ id: 'a7', tenant_id: window.__db.camila_tenants[0].id, patient_id: 'p2000000-0000-4000-8000-000000000002', service_id: 's1', branch_id: 'b1', starts_at: new Date().toISOString(), status: 'arrived' }); ir('dashboard'); });
  await page.waitForTimeout(300); await page.evaluate(() => ir('caja')); await page.waitForTimeout(1500);
  const r5 = (await rows()).length; console.log('5) llegada nueva sin recargar:', r5, 'pendientes'); check(r5 === 4, 'una llegada nueva debe aparecer al volver a Cobros');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400); await page.screenshot({ path: shots + '/cobros-pendientes-movil.png' });
  const fail = [];
  const first = (await rows()); void first;
  console.log('errores de página:', JSON.stringify(errs)); if (errs.length) fail.push('errores de página'); if (failCount) fail.push('aserciones');
  await b.close(); server.close(); process.exit(fail.length ? 1 : 0);
});
