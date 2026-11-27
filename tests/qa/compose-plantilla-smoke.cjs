// Humo de navegador: SmylInbox.compose decide entre texto libre y plantilla aprobada según la ventana de 24 h de WhatsApp.
//   NODE_PATH=$(npm root -g) node tests/qa/compose-plantilla-smoke.cjs      (requiere Playwright y Chromium)
// Usa tests/fixtures/smyl-inbox-stage7-preview.html (la conversación de WhatsApp de ejemplo trae la ventana vencida).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch(); let fails = 0; const errs = [];
  const check = (ok, msg) => { console.log((ok ? 'ok · ' : 'FALLA · ') + msg); if (!ok) fails++; };
  const open = async (query, withTemplate) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, locale: 'es-MX' });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message.slice(0, 160))); page.__alerts = [];
    page.on('dialog', d => { page.__alerts.push(d.message()); d.accept(); });
    await page.route('**/*', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/smyl-inbox-stage7-preview.html${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('html[data-preview-ready=true]'); await page.waitForTimeout(900);
    if (withTemplate) await page.evaluate(() => {
      const base = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.searchParams.get('action') === 'templates') return Promise.resolve(new Response(JSON.stringify({ templates: [
          { id: 't1', name: 'recordatorio_valoracion', display_name: 'Recordatorio', language: 'es_MX', body: 'Hola {{1}}, te recordamos tu valoración el {{2}}.', variable_count: 2 },
          { id: 't2', name: 'cita_lista_espera_v1', display_name: 'Se liberó un horario', language: 'es_MX', body: 'Hola {{1}}, se liberó un horario en {{2}} para el {{3}} a las {{4}}. Si te interesa, responde a este mensaje en las próximas horas para reservarlo.', variable_count: 4 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return base(input, init);
      };
    });
    const id = await page.evaluate(() => { const c = document.querySelector('[data-list-conversation-id]'); return c ? c.dataset.listConversationId : ''; });
    return { ctx, page, id };
  };
  const offer = { template: { names: ['cita_lista_espera_v1'], variables: ['Ana', 'Clínica Centro', 'lunes 23 de noviembre', '4:00 p.m.'], missingText: 'Falta la plantilla «Se liberó un horario».' } };

  // 1) WhatsApp con la ventana vencida y plantilla aprobada → abre la plantilla con las variables llenas
  let { ctx, page, id } = await open('?chat-ux', true);
  check(!!id, 'hay una conversación de WhatsApp de ejemplo');
  let sent = 0;
  const r1 = await page.evaluate(({ id, offer }) => { window.__sent = 0; return window.SmylInbox.compose(id, 'texto libre', Object.assign({}, offer, { onSent: () => { window.__sent += 1; } })); }, { id, offer });
  await page.waitForTimeout(700);
  check(r1 === 'template', 'ventana vencida + plantilla aprobada → devuelve «template»');
  check(await page.isVisible('[data-template-dialog][open]'), 'se abre el diálogo de plantillas');
  const picked = await page.evaluate(() => { const d = document.querySelector('[data-template-dialog]'); const s = d.querySelector('[data-template-select]'); return { name: s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : '', values: [...d.querySelectorAll('[data-variable-index]')].map(i => i.value) }; });
  check(/cita_lista_espera_v1/.test(picked.name), 'viene elegida la plantilla cita_lista_espera_v1 (' + picked.name + ')');
  check(JSON.stringify(picked.values) === JSON.stringify(offer.template.variables), 'las 4 variables vienen llenas: ' + picked.values.join(' | '));
  const composerText = await page.evaluate(() => (document.querySelector('#smyl-inbox-message') || {}).value || '');
  check(!/texto libre/.test(composerText), 'no escribe texto libre cuando la ventana está cerrada');
  check(await page.evaluate(() => window.__sent) === 0, 'onSent NO se llama solo por abrir la plantilla');
  await ctx.close();

  // 2) Ventana vencida y SIN la plantilla aprobada → avisa y no abre nada
  ({ ctx, page, id } = await open('?chat-ux', false));
  const r2 = await page.evaluate(({ id, offer }) => window.SmylInbox.compose(id, 'texto libre', offer), { id, offer });
  await page.waitForTimeout(500);
  check(r2 === false, 'sin plantilla aprobada → devuelve false');
  check(page.__alerts.some(t => /Falta la plantilla/.test(t)), 'avisa con el texto indicado (' + (page.__alerts[0] || 'sin aviso') + ')');
  check(!(await page.isVisible('[data-template-dialog][open]')), 'no abre el diálogo de plantillas');
  await ctx.close();

  // 3) Sin opciones de plantilla (comportamiento anterior): deja el texto en el compositor
  ({ ctx, page, id } = await open('?chat-ux', true));
  const r3 = await page.evaluate(({ id }) => window.SmylInbox.compose(id, 'Hola, texto libre de prueba'), { id });
  await page.waitForTimeout(500);
  check(r3 === true, 'sin `template` deja el texto escrito y devuelve true');
  check(/Hola, texto libre de prueba/.test(await page.evaluate(() => (document.querySelector('#smyl-inbox-message') || {}).value || '')), 'el texto quedó en el compositor');
  await ctx.close();

  // 4) Otro canal (Instagram, sin ventana de 24 h de WhatsApp): texto libre aunque se pida plantilla
  ({ ctx, page, id } = await open('?chat-ux&mobile-layout', true));
  const r4 = await page.evaluate(({ id, offer }) => window.SmylInbox.compose(id, 'Oferta por Instagram', offer), { id, offer });
  await page.waitForTimeout(500);
  check(r4 === true && /Oferta por Instagram/.test(await page.evaluate(() => (document.querySelector('#smyl-inbox-message') || {}).value || '')), 'en un canal sin ventana de WhatsApp usa texto libre');
  await ctx.close();

  check(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
