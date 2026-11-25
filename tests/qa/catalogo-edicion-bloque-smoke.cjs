// Humo de navegador: edición en bloque de Servicios y tarifas con una base de datos simulada.
//   NODE_PATH=$(npm root -g) node tests/qa/catalogo-edicion-bloque-smoke.cjs      (requiere Playwright y Chromium)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/page.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="/smyl-service-catalog.css"><link rel="stylesheet" href="/smyl-service-catalog-stage1.css"></head><body><div id="p-precios"></div></body></html>'); }
  const f = path.join(root, decodeURIComponent(u));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch(); let fails = 0; const errs = [];
  const check = (ok, msg) => { console.log((ok ? 'ok · ' : 'FALLA · ') + msg); if (!ok) fails++; };
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 160))); page.on('dialog', d => d.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);
  await page.evaluate(() => {
    window.__updates = []; window.tenantId = 't1'; window.miRolEquipo = 'dueño'; window.TITULOS = {}; window.ir = () => {};
    const full = { sat_product_service_code: '85121800', sat_unit_code: 'E48', tax_object_code: '01', tax_treatment: 'exempt', fiscal_status: 'pending' };
    const mk = (id, name, extra) => Object.assign({ id, tenant_id: 't1', template_key: null, name, patient_name: name, category: 'diagnostic', scope_type: 'session', pricing_mode: 'fixed', duration_minutes: 30, reference_price: null, active: true, description: '', specialty: 'diagnostic' }, extra);
    let rows = [mk('a', 'Servicio A', full), mk('b', 'Servicio B', { sat_product_service_code: null }), mk('c', 'Servicio C', Object.assign({}, full, { active: false }))];
    window.__rows = () => rows;
    const builder = (table) => {
      const q = { table, filters: {}, op: 'select', patch: null };
      const api = { select() { return api; }, eq(k, v) { q.filters[k] = v; return api; }, in(k, v) { q.filters[k] = v; return api; }, order() { return api; },
        update(p) { q.op = 'update'; q.patch = p; return api; },
        then(ok, ko) { try {
          if (q.op === 'update') { const ids = [].concat(q.filters.id); window.__updates.push({ ids, patch: q.patch }); rows = rows.map(r => ids.indexOf(r.id) >= 0 ? Object.assign({}, r, q.patch) : r); return Promise.resolve({ data: [], error: null }).then(ok, ko); }
          return Promise.resolve({ data: table === 'smyl_services' ? rows : [], error: null }).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); } } };
      return api;
    };
    window.sb = { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: builder, rpc: async () => ({ data: null, error: null }) };
  });
  for (const f of ['smyl-service-catalog-model.js', 'smyl-service-catalog.js']) await page.addScriptTag({ url: '/' + f });
  await page.evaluate(() => window.SmylServiceCatalog.reload()); await page.waitForSelector('.catalog-service', { state: 'attached' });
  check(await page.isVisible('#catalog-bulk-toggle'), 'quien administra ve «Editar varios»');
  check(await page.locator('[data-bulk-id]').count() === 0, 'sin modo bloque no hay casillas');
  await page.click('#catalog-bulk-toggle');
  await page.locator('#catalog-list summary').first().click().catch(() => {});
  await page.evaluate(() => document.querySelectorAll('#catalog-list details').forEach(d => d.open = true));
  check(await page.locator('[data-bulk-id]').count() === 3, 'aparecen 3 casillas (solo servicios ya creados)');
  check(await page.isVisible('#catalog-bulkbar'), 'aparece la barra de acciones');
  check(await page.locator('[data-bulk-do="price"]').isDisabled(), 'acciones desactivadas sin selección');
  await page.click('[data-bulk-all]');
  check(/3 servicios seleccionados/.test(await page.textContent('#catalog-bulkbar strong')), 'elegir visibles selecciona 3');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false });
  // precio
  await page.click('[data-bulk-do="price"]'); await page.fill('#catalog-bulk-dialog input', '800'); await page.click('#catalog-bulk-dialog [type=submit]');
  await page.waitForFunction(() => window.__updates.length >= 1);
  let u = await page.evaluate(() => window.__updates[0]);
  check(u.ids.length === 3 && u.patch.reference_price === 800 && Object.keys(u.patch).length === 1, 'precio: una sola actualización de 3 servicios con solo reference_price=800');
  await page.waitForSelector('.catalog-notice');
  check(await page.locator('[data-bulk-id]').count() === 3 && (await page.locator('[data-bulk-id]:checked').count()) === 0, 'después de aplicar se limpia la selección');
  // duración inválida
  await page.click('[data-bulk-all]'); await page.click('[data-bulk-do="duration"]'); await page.fill('#catalog-bulk-dialog input', '5'); await page.click('#catalog-bulk-dialog [type=submit]');
  check(await page.isVisible('#catalog-bulk-dialog .catalog-form-error'), 'duración fuera de rango muestra error y no guarda');
  check(await page.evaluate(() => window.__updates.length) === 1, '…sin escribir nada');
  await page.fill('#catalog-bulk-dialog input', '45'); await page.click('#catalog-bulk-dialog [type=submit]');
  await page.waitForFunction(() => window.__updates.length >= 2);
  check((await page.evaluate(() => window.__updates[1])).patch.duration_minutes === 45, 'duración 45 min aplicada');
  // fiscal: solo A es elegible (B sin clave SAT, C sin clave SAT? C tiene claves completas)
  await page.click('[data-bulk-all]'); await page.click('[data-bulk-do="fiscal"]');
  await page.waitForFunction(() => window.__updates.length >= 3);
  u = await page.evaluate(() => window.__updates[2]);
  check(u.ids.sort().join() === 'a,c' && u.patch.fiscal_status === 'reviewed' && u.patch.fiscal_reviewed_by === 'u1', 'fiscal: solo los servicios con claves completas (A y C), con revisor');
  check(/omitió|omitieron/.test(await page.textContent('.catalog-notice')), 'avisa cuántos se omitieron');
  // desactivar
  await page.click('[data-bulk-all]'); await page.click('[data-bulk-do="off"]');
  await page.waitForFunction(() => window.__updates.length >= 4);
  check((await page.evaluate(() => window.__updates[3])).patch.active === false, 'desactivar aplica active=false');
  // salir
  await page.click('#catalog-bulk-toggle');
  check(await page.locator('[data-bulk-id]').count() === 0 && !(await page.isVisible('#catalog-bulkbar')), 'salir del modo quita casillas y barra');
  check(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
