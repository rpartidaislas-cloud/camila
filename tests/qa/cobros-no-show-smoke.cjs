// Humo de navegador del cobro por «No vino», con tests/qa/fake-supabase-agenda.js.
//   NODE_PATH=$(npm root -g) node tests/qa/cobros-no-show-smoke.cjs      (requiere Playwright y Chromium)
// Comprueba: apagado por omisión (la inasistencia no aparece); «Cobro por inasistencia» en Más acciones guarda el monto; la fila «No vino» aparece
// con «Cobrar inasistencia» y «Perdonar»; el cargo se abre con concepto y monto puestos y la cita ligada; «Perdonar» la cierra; la agenda muestra
// «Inasistencia por cobrar» / «Perdonada»; y el numerito del menú la cuenta. Sale con código 1 si algo falla.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage(); const errs = []; let fails = 0;
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); fails++; } };
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8') }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  const badge = () => page.evaluate(() => { const c = document.querySelector('.pro-app-nav [data-route="caja"] .pro-nav-count'); return c && !c.hidden ? c.textContent : '0'; });
  const rows = () => page.$$eval('.finance-visit-row', els => els.map(e => ({ n: e.querySelector('strong').textContent, b: e.querySelector('.finance-badge').textContent, btns: [...e.querySelectorAll('button')].map(x => x.textContent) })));
  await page.evaluate(() => ir('caja')); await page.waitForTimeout(2000);
  let r = await rows(); console.log('1) apagado por omisión:', JSON.stringify(r.map(x => x.b))); check(!r.some(x => x.b === 'No vino'), 'sin monto configurado la inasistencia no debe aparecer');
  const base = await badge();
  await page.click('.finance-more-actions summary'); await page.click('#finance-no-show-fee'); await page.waitForTimeout(300);
  await page.fill('.finance-nocharge input[name=amount]', '200'); await page.click('.finance-nocharge button[type=submit]'); await page.waitForTimeout(1500);
  r = await rows(); const ns = r.find(x => x.b === 'No vino'); console.log('2) con monto de $200:', JSON.stringify(ns)); check(ns && ns.btns.some(t => /Cobrar inasistencia · \$200/.test(t)) && ns.btns.includes('Perdonar'), 'debe aparecer la fila No vino con Cobrar inasistencia y Perdonar');
  const b2 = await badge(); console.log('   numerito:', base, '→', b2); check(Number(b2) === Number(base) + 1, 'el numerito debe contar la inasistencia');
  await page.click('[data-visit-noshow="a8"]'); await page.waitForTimeout(600);
  const form = await page.evaluate(() => { const f = document.querySelector('.finance-charge-form'); return f && { cita: f.elements.appointment.value, concepto: f.elements.concept.value, precio: f.elements.price.value, servicio: f.elements.service.value }; });
  console.log('3) cargo prellenado:', JSON.stringify(form)); check(form && form.cita === 'a8' && /^Inasistencia a cita/.test(form.concepto) && form.precio === '200.00' && form.servicio === '', 'el cargo debe abrirse con la cita, el concepto y el monto de la inasistencia');
  await page.screenshot({ path: path.join(os.tmpdir(), 'cobros-no-vino-cargo.png') });
  await page.evaluate(() => document.getElementById('finance-dialog').close()); await page.waitForTimeout(200);
  await page.evaluate(() => { document.querySelector('[data-visit-waive="a8"]').click(); }); await page.waitForTimeout(400);
  await page.fill('.finance-nocharge input[name=note]', 'Avisó con tiempo'); await page.click('.finance-nocharge button[type=submit]'); await page.waitForTimeout(1500);
  r = await rows(); console.log('4) tras Perdonar:', JSON.stringify(r.map(x => x.b))); check(!r.some(x => x.b === 'No vino'), 'perdonada deja de estar pendiente');
  check(await page.$eval('.finance-visits-closed', e => /Inasistencia perdonada/.test(e.textContent) || (e.open = true, /Inasistencia perdonada/.test(e.textContent))).catch(() => false), 'debe quedar en Cerradas sin cargo como Inasistencia perdonada');
  await page.click('.finance-visits-closed summary').catch(() => {}); await page.click('[data-visit-reopen="a8"]').catch(() => {}); await page.waitForTimeout(1500);
  await page.evaluate(() => ir('agenda')); await page.waitForTimeout(2500); await page.getByRole('button', { name: 'Lista', exact: true }).first().click(); await page.waitForTimeout(800);
  const chips = await page.$$eval('.schedule-billing', els => els.map(e => e.textContent)); console.log('5) agenda:', JSON.stringify(chips)); check(chips.includes('Inasistencia por cobrar'), 'la agenda debe mostrar «Inasistencia por cobrar»');
  await page.evaluate(() => ir('caja')); await page.waitForTimeout(1200); await page.evaluate(() => { document.querySelector('[data-visit-waive="a8"]').click(); }); await page.waitForTimeout(300); await page.click('.finance-nocharge button[type=submit]'); await page.waitForTimeout(1200);
  await page.evaluate(() => ir('agenda')); await page.waitForTimeout(2500); await page.getByRole('button', { name: 'Lista', exact: true }).first().click(); await page.waitForTimeout(800);
  const chips2 = await page.$$eval('.schedule-billing', els => els.map(e => e.textContent)); console.log('6) agenda tras perdonar:', JSON.stringify(chips2)); check(chips2.includes('Perdonada'), 'la agenda debe mostrar «Perdonada»');
  console.log('errores de página:', JSON.stringify(errs)); if (errs.length) fails++;
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
