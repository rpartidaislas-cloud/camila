// Humo de navegador de la etiqueta de cobro en la Agenda, con un Supabase simulado (tests/qa/fake-supabase-agenda.js).
//   NODE_PATH=$(npm root -g) node tests/qa/agenda-billing-smoke.cjs      (requiere Playwright y Chromium)
// Comprueba, en las vistas Semana, Día y Lista: Por cobrar / Saldo $700 / Cobrada, que la Revisión de $0 no lleva etiqueta
// y que el detalle de la cita muestra la línea «Cobro» con «Ir a Cobros». Sale con código 1 si algo falla.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage(); const errs = []; let failCount = 0;
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); failCount++; } };
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8') }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.evaluate(() => ir('agenda')); await page.waitForTimeout(2500);
  const chips = () => page.$$eval('.schedule-billing', els => els.map(e => e.textContent + '·' + e.dataset.billing).sort());
  const esperado = ['Cobrada·paid', 'Por cobrar·pending', 'Por cobrar·pending', 'Saldo $700·due'];
  const semana = await chips(); console.log('Semana:', JSON.stringify(semana)); check(JSON.stringify(semana) === JSON.stringify(esperado), 'la semana debe mostrar 4 etiquetas (la Revisión de $0 no lleva)');
  for (const v of ['Lista', 'Día']) {
    await page.getByRole('button', { name: v, exact: true }).first().click(); await page.waitForTimeout(800);
    const c = await chips(); console.log(v + ':', JSON.stringify(c)); check(c.includes('Saldo $700·due') && c.includes('Por cobrar·pending'), 'la vista ' + v + ' debe mostrar Saldo y Por cobrar');
    const visible = await page.$$eval('.schedule-billing', els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length);
    check(visible === c.length, 'en la vista ' + v + ' todas las etiquetas deben verse (hay ' + visible + ' de ' + c.length + ')');
  }
  await page.locator('[data-appointment="a2"]').first().click(); await page.waitForTimeout(500);
  const fila = await page.$eval('.sched-billing-row', e => e.innerText.replace(/\n/g, ' ')).catch(() => ''); console.log('Detalle:', fila); check(/Saldo \$700/.test(fila) && /Ir a Cobros/.test(fila), 'el detalle debe mostrar el saldo y «Ir a Cobros»');
  await page.click('[data-go-finance]'); await page.waitForTimeout(800);
  check(await page.evaluate(() => document.getElementById('p-caja').classList.contains('activa')), '«Ir a Cobros» debe abrir Cobros');
  console.log('errores de página:', JSON.stringify(errs)); if (errs.length) failCount++;
  await b.close(); server.close(); process.exit(failCount ? 1 : 0);
});
