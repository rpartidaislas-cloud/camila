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
    window.__profs = [{ id: 'p1', display_name: 'Dra. Ana', active: true }, { id: 'p2', display_name: 'Dr. Luis', active: true }];
    window.__ps = [{ professional_id: 'p1', service_id: 'a' }]; window.__ai = { a: true }; window.__calls = [];
    const builder = (table) => {
      const q = { table, filters: {}, op: 'select', patch: null, rows: null };
      const api = { select() { return api; }, eq(k, v) { q.filters[k] = v; return api; }, in(k, v) { q.filters[k] = v; return api; }, order() { return api; },
        update(p) { q.op = 'update'; q.patch = p; return api; }, upsert(r) { q.op = 'upsert'; q.rows = r; return api; }, delete() { q.op = 'delete'; return api; },
        then(ok, ko) { try {
          if (table === 'smyl_professional_services') {
            if (q.op === 'upsert') { window.__calls.push({ t: table, op: 'upsert', rows: q.rows }); q.rows.forEach(r => { if (!window.__ps.some(x => x.professional_id === r.professional_id && x.service_id === r.service_id)) window.__ps.push({ professional_id: r.professional_id, service_id: r.service_id }); }); return Promise.resolve({ data: [], error: null }).then(ok, ko); }
            if (q.op === 'delete') { window.__calls.push({ t: table, op: 'delete', filters: q.filters }); window.__ps = window.__ps.filter(x => !([].concat(q.filters.service_id).indexOf(x.service_id) >= 0 && [].concat(q.filters.professional_id).indexOf(x.professional_id) >= 0)); return Promise.resolve({ data: [], error: null }).then(ok, ko); }
            return Promise.resolve({ data: window.__ps, error: null }).then(ok, ko);
          }
          if (table === 'smyl_professionals') return Promise.resolve({ data: window.__profs, error: null }).then(ok, ko);
          if (table === 'smyl_ai_scheduling_services') return Promise.resolve({ data: Object.keys(window.__ai).filter(k => window.__ai[k]).map(k => ({ service_id: k })), error: null }).then(ok, ko);
          if (q.op === 'update') { const ids = [].concat(q.filters.id); window.__updates.push({ ids, patch: q.patch }); rows = rows.map(r => ids.indexOf(r.id) >= 0 ? Object.assign({}, r, q.patch) : r); return Promise.resolve({ data: [], error: null }).then(ok, ko); }
          if (q.op === 'insert') return Promise.resolve({ data: [], error: null }).then(ok, ko);
          return Promise.resolve({ data: table === 'smyl_services' ? rows : [], error: null }).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); } } };
      return api;
    };
    window.sb = { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: builder, rpc: async (name, args) => { window.__calls.push({ t: 'rpc', name, args }); if (name === 'smyl_set_ai_services') { args.p_service_ids.forEach(id => { window.__ai[id] = args.p_allowed; }); return { data: { allowed: args.p_allowed, count: args.p_service_ids.length, turned_off: false }, error: null }; } return { data: null, error: null }; },
      functions: { invoke: async (fn, o) => ({ data: o.body.action === 'suggest_service' ? { fields: { category: 'diagnostic', duration_minutes: 40, description: 'Primera revisión.', tax_treatment: 'exempt' }, sat: { suggestions: [{ key: '85121800', description: 'Servicios odontológicos' }], candidates: [] } } : { error: 'no' }, error: null }) } };
  });
  for (const f of ['smyl-service-catalog-model.js', 'smyl-service-catalog.js']) await page.addScriptTag({ url: '/' + f });
  await page.evaluate(() => window.SmylServiceCatalog.reload()); await page.waitForSelector('.catalog-service', { state: 'attached' });
  check(await page.isVisible('#catalog-bulk-toggle'), 'quien administra ve «Editar varios»');
  check(await page.locator('[data-bulk-id]').count() === 0, 'sin modo bloque no hay casillas');
  // Nombre repetido: aviso claro y sin escribir en la base
  await page.click('#catalog-custom'); await page.waitForSelector('#catalog-dialog[open]');
  await page.fill('#catalog-dialog [name="patient_name"]', 'servicio a'); await page.fill('#catalog-dialog [name="duration_minutes"]', '30');
  await page.evaluate(() => { window.__before = window.__updates.length + window.__calls.length; });
  await page.click('#catalog-dialog [type=submit]');
  check(/Ya hay un servicio activo llamado «Servicio A»/.test(await page.textContent('#catalog-dialog .catalog-form-error')), 'un nombre repetido (aunque cambien las mayúsculas) avisa en español');
  check(await page.evaluate(() => window.__updates.length + window.__calls.length === window.__before), '…y no intenta guardar');
  await page.click('#catalog-dialog [data-close]');
  // Tarjetas: avisos de profesional y de IA, y diálogo con disponibilidad
  await page.evaluate(() => document.querySelectorAll('#catalog-list details').forEach(d => d.open = true));
  const flags = await page.evaluate(() => [...document.querySelectorAll('.catalog-service')].filter(a => a.querySelector('[data-bulk-id],[data-edit]') && /Servicio [ABC]/.test(a.textContent)).map(a => ({ n: a.querySelector('h3').textContent.trim(), t: a.querySelector('.catalog-flags').textContent })));
  const fa = flags.find(x => x.n === 'Servicio A'), fb = flags.find(x => x.n === 'Servicio B');
  check(fa && /La IA lo ofrece/.test(fa.t) && !/Sin profesional/.test(fa.t), 'A: tiene profesional y la IA lo ofrece');
  check(fb && /Sin profesional/.test(fb.t), 'B: activo y sin profesional muestra «Sin profesional»');
  await page.evaluate(() => [...document.querySelectorAll('.catalog-service')].find(a => a.querySelector('h3') && a.querySelector('h3').textContent.trim() === 'Servicio B').querySelector('[data-edit]').click());
  await page.waitForSelector('#catalog-dialog[open] .catalog-who');
  check(await page.locator('#catalog-dialog [name="who"]').count() === 2, 'el diálogo muestra «Quién lo realiza» con los 2 profesionales');
  check(await page.locator('#catalog-dialog [name="ai_offer"]').count() === 1 && !(await page.locator('#catalog-dialog [name="ai_offer"]').isChecked()), 'el diálogo muestra «La IA puede ofrecerlo» sin marcar');
  check(await page.locator('#catalog-dialog [data-sat-ai]').count() === 0 && await page.locator('#catalog-dialog [data-ai-all]').count() === 1, 'hay una sola IA (sin botón separado en lo fiscal)');
  check(!(await page.locator('#catalog-dialog .catalog-more').evaluate(d => d.open)) && await page.locator('#catalog-dialog .catalog-more [name="scope_type"]').count() === 1, '«Se aplica a» y «Cómo se cobra» están en «Más opciones», plegado');
  // IA todo-en-uno: llena también la parte fiscal, sin marcar «Revisada» ni tocar el precio
  await page.click('#catalog-dialog [data-ai-all]');
  await page.waitForFunction(() => document.querySelector('#catalog-dialog [name="sat_product_service_code"]').value === '85121800');
  const fis = await page.evaluate(() => { const f = document.querySelector('#catalog-dialog form').elements; return { code: f.sat_product_service_code.value, unit: f.sat_unit_code.value, obj: f.tax_object_code.value, tax: f.tax_treatment.value, rev: f.fiscal_reviewed.checked, dur: f.duration_minutes.value, price: f.reference_price.value }; });
  check(fis.code === '85121800' && fis.unit === 'E48' && fis.obj === '02' && fis.tax === 'exempt', 'la IA llenó clave SAT, unidad, objeto de impuesto e IVA (' + [fis.code, fis.unit, fis.obj, fis.tax].join(' · ') + ')');
  check(fis.rev === false && fis.dur === '40' && fis.price === '', 'no marcó «Revisada», puso la duración y no tocó el precio');
  if (process.env.SHOT_DIALOG) { await page.evaluate(() => { document.querySelector('#catalog-dialog .catalog-fiscal').open = true; }); await page.locator('#catalog-dialog').screenshot({ path: process.env.SHOT_DIALOG }); }
  // Guardar con profesional e IA
  await page.check('#catalog-dialog [name="who"][value="p2"]'); await page.check('#catalog-dialog [name="ai_offer"]');
  await page.click('#catalog-dialog [type=submit]');
  await page.waitForFunction(() => window.__calls.some(c => c.t === 'rpc'));
  const calls = await page.evaluate(() => window.__calls);
  check(calls.some(c => c.t === 'smyl_professional_services' && c.op === 'upsert' && c.rows.length === 1 && c.rows[0].professional_id === 'p2' && c.rows[0].service_id === 'b'), 'guardar agrega a Dr. Luis a ese servicio');
  check(calls.some(c => c.t === 'rpc' && c.name === 'smyl_set_ai_services' && c.args.p_allowed === true && c.args.p_service_ids.join() === 'b'), 'guardar marca «La IA puede ofrecerlo» con la función del servidor');
  await page.waitForSelector('.catalog-notice');
  await page.evaluate(() => document.querySelectorAll('#catalog-list details').forEach(d => d.open = true));
  const fb2 = await page.evaluate(() => [...document.querySelectorAll('.catalog-service')].find(a => a.querySelector('h3') && a.querySelector('h3').textContent.trim() === 'Servicio B').querySelector('.catalog-flags').textContent);
  check(!/Sin profesional/.test(fb2) && /La IA lo ofrece/.test(fb2), 'la tarjeta de B ya no dice «Sin profesional» y muestra «La IA lo ofrece»');
  await page.evaluate(() => { window.__updates = []; });
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
  check(u.ids.sort().join() === 'a,b,c' && u.patch.fiscal_status === 'reviewed' && u.patch.fiscal_reviewed_by === 'u1', 'fiscal: solo servicios con claves completas (A, C y B, que la IA acaba de llenar), con revisor');
  check(/3 servicios marcados como revisados/.test(await page.textContent('.catalog-notice')), 'avisa cuántos se marcaron');
  // IA en bloque y quién lo realiza en bloque
  await page.click('[data-bulk-all]'); await page.click('[data-bulk-do="aioff"]');
  await page.waitForFunction(() => window.__calls.filter(c => c.t === 'rpc').length >= 2);
  check(await page.evaluate(() => { const c = window.__calls.filter(x => x.t === 'rpc').pop(); return c.args.p_allowed === false && c.args.p_service_ids.length === 3; }), 'bloque: «Quitar de la IA» manda los 3 servicios');
  await page.click('[data-bulk-all]'); await page.click('[data-bulk-do="aion"]');
  await page.waitForFunction(() => window.__calls.filter(c => c.t === 'rpc').length >= 3);
  check(await page.evaluate(() => { const c = window.__calls.filter(x => x.t === 'rpc').pop(); return c.args.p_allowed === true && c.args.p_service_ids.sort().join() === 'a,b'; }), 'bloque: «La IA lo ofrece» omite el servicio desactivado (solo A y B)');
  await page.click('[data-bulk-all]'); await page.click('[data-bulk-do="who"]');
  await page.waitForSelector('#catalog-bulk-dialog[open] [name="who"]');
  await page.click('#catalog-bulk-dialog [type=submit]');
  check(await page.isVisible('#catalog-bulk-dialog .catalog-form-error'), 'bloque: «Quién lo realiza» exige elegir al menos un profesional');
  await page.check('#catalog-bulk-dialog [name="who"][value="p1"]'); await page.click('#catalog-bulk-dialog [type=submit]');
  await page.waitForFunction(() => window.__calls.some(c => c.t === 'smyl_professional_services' && c.op === 'upsert' && c.rows.length === 3));
  check(await page.evaluate(() => window.__calls.filter(c => c.t === 'smyl_professional_services' && c.op === 'upsert').pop().rows.every(r => r.professional_id === 'p1')), 'bloque: agrega a Dra. Ana a los 3 servicios en una sola escritura');
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
