// Humo de navegador del numerito de «Cobros» en el menú lateral (pacientes pendientes de cargo), con tests/qa/fake-supabase-agenda.js.
//   NODE_PATH=$(npm root -g) node tests/qa/cobros-nav-badge-smoke.cjs      (requiere Playwright y Chromium)
// Comprueba: aparece al iniciar sin abrir Cobros, coincide con la lista, baja al cerrar una visita «Sin cargo», sube con un evento de la agenda,
// se oculta en 0, y se ve en el menú colapsado y en la fila «Más» del móvil. Sale con código 1 si algo falla.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 900 } }); const page = await ctx.newPage(); const errs = []; let fails = 0;
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); fails++; } };
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8') }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  const badge = () => page.evaluate(() => { const c = document.querySelector('.pro-app-nav [data-route="caja"] .pro-nav-count'); return c ? { text: c.textContent, hidden: c.hidden, aria: c.getAttribute('aria-label') } : null; });
  await page.waitForTimeout(4500);
  let x = await badge(); console.log('1) sin abrir Cobros:', JSON.stringify(x)); check(x && x.text === '2' && !x.hidden && /2 pacientes pendientes de cargo/.test(x.aria), 'debe mostrar 2 al iniciar, sin abrir Cobros');
  await page.evaluate(() => ir('caja')); await page.waitForTimeout(2000);
  const filas = await page.$$eval('.finance-visit-row', e => e.length); x = await badge(); console.log('2) en Cobros:', JSON.stringify(x), 'filas', filas); check(x && x.text === String(filas), 'el numerito debe coincidir con las filas de la lista');
  await page.click('[data-visit-nocharge]'); await page.waitForTimeout(400); await page.click('.finance-nocharge button[type=submit]'); await page.waitForTimeout(1500);
  x = await badge(); console.log('3) tras «Sin cargo»:', JSON.stringify(x)); check(x && x.text === '1' && /1 paciente pendiente/.test(x.aria), 'debe bajar a 1');
  await page.evaluate(() => { window.__db.smyl_appointments.find(a => a.id === 'a6').status = 'arrived'; window.dispatchEvent(new CustomEvent('smyl:appointments-changed')); }); await page.waitForTimeout(1500);
  x = await badge(); console.log('4) llega otro paciente:', JSON.stringify(x)); check(x && x.text === '2', 'un evento de la agenda debe subirlo a 2');
  await page.evaluate(() => { window.__db.smyl_appointments.forEach(a => { if (['arrived', 'in_progress', 'completed'].includes(a.status)) a.status = 'confirmed'; }); window.dispatchEvent(new CustomEvent('smyl:appointments-changed')); }); await page.waitForTimeout(1500);
  x = await badge(); console.log('5) nadie pendiente:', JSON.stringify(x)); check(x && x.hidden, 'con 0 pendientes el numerito se oculta');
  await page.evaluate(() => { ['a1', 'a3'].forEach(id => { window.__db.smyl_appointments.find(a => a.id === id).status = id === 'a1' ? 'arrived' : 'completed'; }); window.__db.smyl_appointment_no_charge.length = 0; window.dispatchEvent(new CustomEvent('smyl:appointments-changed')); }); await page.waitForTimeout(1200);
  await page.evaluate(() => document.body.classList.add('smyl-sidebar-collapsed')); await page.waitForTimeout(300);
  const colapsado = await page.evaluate(() => { const c = document.querySelector('.pro-app-nav [data-route="caja"] .pro-nav-count'); const r = c && c.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; }); check(colapsado, 'el numerito debe verse con el menú colapsado');
  await page.evaluate(() => document.body.classList.remove('smyl-sidebar-collapsed'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800);
  const movil = await page.evaluate(() => { const c = document.querySelector('.pam-row[data-route="caja"] .pro-nav-count'); return c ? c.textContent + (c.hidden ? ' (oculto)' : '') : 'sin fila'; }); console.log('6) móvil («Más»):', movil); check(movil === '2', 'la fila de Cobros en «Más» del móvil debe mostrar 2');
  console.log('errores de página:', JSON.stringify(errs)); if (errs.length) fails++;
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
