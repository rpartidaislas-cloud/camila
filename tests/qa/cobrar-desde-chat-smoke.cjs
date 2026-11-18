// Humo de navegador: «Cobrar» desde el chat abre el cobro guiado EN EL MISMO LUGAR (sin pasar a la pantalla de Cobros) y con el paciente ya elegido.
//   NODE_PATH=$(npm root -g) node tests/qa/cobrar-desde-chat-smoke.cjs      (requiere Playwright y Chromium)
// Usa tests/qa/fake-supabase-agenda.js. Sale con código 1 si algo falla.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 }, timezoneId: 'America/Mexico_City', locale: 'es-MX' });
  const page = await ctx.newPage(); const errs = []; let fails = 0;
  const check = (cond, msg) => { console.log((cond ? 'ok · ' : 'FALLA · ') + msg); if (!cond) fails++; };
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200))); page.on('dialog', (d) => d.dismiss());
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8') });
    return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.evaluate(() => ir('agenda')); await page.waitForTimeout(1500);
  const patient = 'p1000000-0000-4000-8000-000000000001';
  const state = () => page.evaluate(() => {
    const d = document.getElementById('finance-dialog'); const r = d && d.getBoundingClientRect();
    return { inBody: !!d && d.parentNode === document.body, open: !!d && d.open, visible: !!r && r.width > 300 && r.height > 200, guide: !!document.querySelector('#finance-dialog .finance-collection-guide'),
      patientStepHidden: !!document.querySelector('#finance-dialog .finance-guide-patient') && document.querySelector('#finance-dialog .finance-guide-patient').hidden,
      title: (document.querySelector('#finance-dialog .finance-guide-account strong') || {}).textContent || '', cajaVisible: !!document.getElementById('p-caja') && document.getElementById('p-caja').offsetParent !== null,
      options: [...document.querySelectorAll('#finance-dialog [data-guide-path]')].map((x) => x.querySelector('strong').textContent.replace(/Sugerido/, '').trim()) };
  });
  const res = await page.evaluate((id) => window.SmylFinance.collect(id, { name: 'Paciente de LANA' }), patient); await page.waitForTimeout(500);
  let s = await state(); console.log(JSON.stringify(s));
  check(res && res.ok === true, 'collect responde ok');
  check(s.inBody, 'el diálogo de cobros vive en <body> (se puede abrir desde cualquier pantalla)');
  check(s.open && s.visible && s.guide, 'el cobro guiado se ve encima de la pantalla actual');
  check(!s.cajaVisible, 'no se pasó a la pantalla de Cobros');
  check(s.patientStepHidden && /Paciente de LANA/.test(s.title), 'el paciente de la conversación ya viene elegido: ' + s.title);
  check(s.options.length >= 2, 'ofrece opciones de cobro: ' + s.options.join(' | '));
  await page.screenshot({ path: path.join(os.tmpdir(), 'cobrar-desde-chat.png') });
  await page.evaluate(() => document.getElementById('finance-dialog').close()); await page.waitForTimeout(200);
  // sin paciente vinculado: abre el cobro con su propio buscador (sin lista previa)
  const res2 = await page.evaluate(() => window.SmylFinance.collect('')); await page.waitForTimeout(400);
  s = await state(); console.log(JSON.stringify(s));
  check(res2 && res2.ok === true && s.open && s.guide && !s.patientStepHidden, 'sin paciente vinculado: se abre con «¿A quién le cobras?»');
  check(!s.cajaVisible, 'tampoco sale del chat');
  // la pantalla de Cobros sigue funcionando con el diálogo en <body>
  await page.evaluate(() => document.getElementById('finance-dialog').close());
  await page.evaluate(() => ir('caja')); await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('finance-guided-collection').click()); await page.waitForTimeout(500);
  const pay = await page.evaluate(() => { const d = document.getElementById('finance-dialog'); const r = d.getBoundingClientRect(); return { open: d.open, form: !!d.querySelector('.finance-collection-guide'), w: Math.round(r.width), caja: document.getElementById('p-caja').offsetParent !== null }; });
  check(pay.open && pay.form && pay.w > 300 && pay.caja, 'desde Cobros «Cobrar a paciente» sigue abriendo igual: ' + JSON.stringify(pay));
  console.log('errores de página:', errs.join('|') || 'ninguno'); if (errs.length) fails++;
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
