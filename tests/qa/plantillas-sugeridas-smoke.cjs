// Humo de navegador de «Plantillas sugeridas»: tarjeta en Agenda, Finanzas, Cotizaciones y Pacientes, solicitud en bloque y permisos.
//   NODE_PATH=$(npm root -g) node tests/qa/plantillas-sugeridas-smoke.cjs      (requiere Playwright y Chromium; SHOT_DIR=carpeta guarda capturas)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const S = process.env.SHOT_DIR || require('os').tmpdir();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const REMOTE = (owner) => ({ can_request: owner, templates: [
  { id: 'a1000000-0000-4000-8000-000000000001', name: 'recordatorio_cita_confirmar_v1', language: 'es_MX', category: 'UTILITY', status: 'APPROVED', body: 'x', variable_count: 3 },
  { id: 'a1000000-0000-4000-8000-000000000002', name: 'cita_confirmada_v1', language: 'es_MX', category: 'UTILITY', status: 'APPROVED', body: 'x', variable_count: 3 },
  { id: 'a1000000-0000-4000-8000-000000000003', name: 'cita_cancelada_clinica_v1', language: 'es_MX', category: 'UTILITY', status: 'PENDING', body: 'x', variable_count: 3 },
  { id: 'a1000000-0000-4000-8000-000000000004', name: 'pago_recibido_v1', language: 'es_MX', category: 'UTILITY', status: 'APPROVED', body: 'x', variable_count: 3 }
] });
server.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch();
  let failures = 0;
  const check = (c, m) => { console.log((c ? 'ok · ' : 'FALLA · ') + m); if (!c) failures += 1; };
  for (const [name, w, h, owner] of [['escritorio', 1440, 1000, true], ['celular', 390, 900, true], ['sin-permiso', 1280, 900, false]]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', timezoneId: 'America/Mexico_City', locale: 'es-MX', viewport: { width: w, height: h } });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'tests/qa/fake-supabase-agenda-board.js'), 'utf8') });
      return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate((remote) => {
      window.__req = [];
      const old = window.sb.functions.invoke.bind(window.sb.functions);
      window.sb.functions.invoke = async (fn, opts) => {
        if (fn === 'whatsapp-templates') {
          if (opts && opts.body && opts.body.action === 'request') { window.__req.push(opts.body.template_id); return { data: { ok: true, status: 'PENDING' }, error: null }; }
          return { data: remote, error: null };
        }
        if (fn === 'appointment-reminders') return { data: { settings: { enabled: false }, can_configure: true, templates: [], overview: {} }, error: null };
        return old(fn, opts);
      };
    }, REMOTE(owner));
    await page.evaluate(() => ir('agenda')); await page.waitForTimeout(2200);
    await page.evaluate(() => document.querySelector('[data-schedule-tab="settings"]').click()); await page.waitForTimeout(1800);
    const ag = await page.evaluate(() => { const c = document.querySelector('[data-tpl-suggest="agenda"]'); return c ? { texto: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 260), progreso: c.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), boton: (c.querySelector('.tpl-suggest-ask') || {}).textContent, deshabilitado: (c.querySelector('.tpl-suggest-ask') || { disabled: false }).disabled, filas: c.querySelectorAll('.tpl-suggest-row').length, alto: Math.round(c.getBoundingClientRect().height) } : null; });
    console.log(name, 'agenda:', JSON.stringify(ag), 'errores:', errs.filter(e => !/ERR_FAILED/.test(e)));
    check(ag && ag.progreso === '2' && (!owner || /Solicitar \(5\)/.test(ag.boton || '')), `${name}: Agenda muestra 2 de 8 esenciales y ${owner ? 'el botón «Solicitar (5)»' : 'sin botón para quien no es propietario'}`);
    check(ag && ag.alto <= 120, `${name}: la sugerencia es una franja (${ag && ag.alto} px de alto)`);
    check(ag && ag.deshabilitado === false, `${name}: el botón ${owner ? 'está activo' : 'no aparece'}`);
    if (!owner) check(/pídeselo/.test(ag.texto + (await page.locator('[data-tpl-suggest="agenda"]').innerText())), `${name}: dice a quién pedirlo`);
    await page.locator('[data-tpl-suggest="agenda"]').scrollIntoViewIfNeeded();
    await page.locator('[data-tpl-suggest="agenda"] .tpl-suggest-toggle').click(); await page.waitForTimeout(200);
    check((await page.locator('[data-tpl-suggest="agenda"] .tpl-suggest-row').count()) === 19, `${name}: el detalle lista las 8 esenciales y las 11 recomendadas`);
    await page.locator('[data-tpl-suggest="agenda"]').screenshot({ path: `${S}/plantillas-agenda-${name}.png` });
    // estable: no se vuelve a pintar en bucle
    const sameNode = await page.evaluate(async () => { const a = document.querySelector('[data-tpl-suggest="agenda"]'); await new Promise(r => setTimeout(r, 900)); return a === document.querySelector('[data-tpl-suggest="agenda"]'); });
    check(sameNode, `${name}: la tarjeta no se repinta sola (sin bucle)`);
    if (owner && name === 'escritorio') {
      await page.locator('[data-tpl-suggest="agenda"] .tpl-suggest-ask').click(); await page.waitForTimeout(400);
      const dlg = await page.evaluate(() => ({ abierto: !!document.querySelector('dialog.tpl-dialog[open]'), items: [...document.querySelectorAll('dialog.tpl-dialog[open] .tpl-many-list li')].map(l => l.textContent) }));
      check(dlg.abierto && dlg.items.length === 5, `${name}: pide UNA confirmación con las 5 que faltan: ${JSON.stringify(dlg.items)}`);
      await page.evaluate(() => document.querySelector('dialog.tpl-dialog[open] .btn-primary').click());
      await page.waitForFunction(() => window.__req.length === 5, null, { timeout: 20000 }).catch(() => {});
      const sent = await page.evaluate(() => window.__req.length);
      check(sent === 5, `${name}: se solicitaron las 5, una tras otra (${sent})`);
    }
    for (const [route, section, label] of [['caja', 'finanzas', 'Finanzas'], ['propuestas', 'cotizaciones', 'Cotizaciones'], ['pacientes', 'pacientes', 'Pacientes']]) {
      await page.evaluate((r) => ir(r), route); await page.waitForTimeout(2000);
      const info = await page.evaluate((s) => { const c = document.querySelector(`[data-tpl-suggest="${s}"]`); return c ? { visible: c.getClientRects().length > 0, texto: c.querySelector('.tpl-suggest-text').textContent, progreso: c.querySelector('[role=progressbar]').getAttribute('aria-valuenow') + '/' + c.querySelector('[role=progressbar]').getAttribute('aria-valuemax') } : null; }, section);
      check(info && info.visible, `${name}: ${label} muestra su tarjeta ${JSON.stringify(info)}`);
      if (info && name === 'escritorio') await page.locator(`[data-tpl-suggest="${section}"]`).screenshot({ path: `${S}/plantillas-${section}-${name}.png` });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflow, `${name}: sin scroll horizontal`);
    await ctx.close();
  }
  await b.close(); server.close();
  console.log(failures ? failures + ' falla(s)' : 'Todo bien');
  process.exit(failures ? 1 : 0);
});
