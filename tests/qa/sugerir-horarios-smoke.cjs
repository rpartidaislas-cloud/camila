// Humo de navegador: «Sugerir horarios» en Agendar cita del chat (Mensajes).
//   NODE_PATH=$(npm root -g) node tests/qa/sugerir-horarios-smoke.cjs      (requiere Playwright y Chromium)
// Usa tests/fixtures/smyl-inbox-stage7-preview.html y le sustituye la respuesta de `availability` por horarios futuros.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch(); let fails = 0; const errs = [];
  const check = (ok, msg) => { console.log((ok ? 'ok · ' : 'FALLA · ') + msg); if (!ok) fails++; };
  for (const [name, w, h, q] of [['desk', 1440, 900, '?chat-ux'], ['mobile', 390, 844, '?chat-ux&mobile-layout']]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, timezoneId: 'America/Mexico_City', locale: 'es-MX', hasTouch: w < 500 });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.route('**/*', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/smyl-inbox-stage7-preview.html${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('html[data-preview-ready=true]'); await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__avail = 0; window.__mode = 'normal';
      const base = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.searchParams.get('action') === 'availability') {
          window.__avail += 1;
          if (window.__mode === 'empty') return Promise.resolve(new Response(JSON.stringify({ slots: [], holds_created: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          const from = new Date(url.searchParams.get('from')), to = new Date(url.searchParams.get('to')), slots = [];
          for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d.setDate(d.getDate() + 1)) {
            for (const [hour, pid, pname] of [[9, 'professional-mariana', 'Dra. Mariana Ruiz'], [10, 'professional-diego', 'Dr. Diego Torres'], [16, 'professional-mariana', 'Dra. Mariana Ruiz'], [17, 'professional-diego', 'Dr. Diego Torres']]) {
              const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0);
              if (start < from || start > to) continue;
              slots.push({ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600000).toISOString(), service_id: 'service-valuation', professional_id: pid, professional_name: pname, branch_id: 'branch-centro', branch_name: 'Clínica Centro', timezone: 'America/Mexico_City', duration_minutes: 60 });
            }
          }
          slots.sort((a, c) => new Date(a.starts_at) - new Date(c.starts_at));
          return Promise.resolve(new Response(JSON.stringify({ slots: slots.slice(0, 30), holds_created: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return base(input, init);
      };
    });
    if (!(await page.isVisible('[data-thread-primary-action="schedule"]'))) { const first = await page.$('.smyl-inbox-row'); if (first) await first.click({ force: true }); } await page.waitForTimeout(1500);
    await page.click('[data-thread-primary-action="schedule"]'); await page.waitForSelector('[data-availability-dialog][open]'); await page.waitForTimeout(1500);
    check(await page.isVisible('[data-availability-suggest-run]'), `${name}: aparece «Sugerir 3 horarios»`);
    await page.click('[data-availability-suggest-run]'); await page.waitForSelector('.smyl-suggest-list li', { timeout: 8000 });
    const items = await page.$$eval('.smyl-suggest-list li', n => n.map(x => ({ when: x.querySelector('strong').textContent, who: x.querySelector('small').textContent, tag: x.querySelector('em').textContent })));
    console.log(name, JSON.stringify(items));
    check(items.length === 3, `${name}: ofrece exactamente tres opciones`);
    check(items[0].tag === 'Primer espacio libre', `${name}: la primera es «Primer espacio libre»`);
    check(new Set(items.map(i => i.when.split('·')[0].trim())).size === 3, `${name}: las tres caen en días distintos`);
    check(items.every(i => /Clínica Centro/.test(i.who)), `${name}: todas son de una sola sucursal`);
    await page.screenshot({ path: path.join(os.tmpdir(), `sugerir-horarios-${name}.png`) });
    const shown = items.map(i => i.when);
    await page.click('[data-availability-suggest-more]'); await page.waitForTimeout(1200);
    const more = await page.$$eval('.smyl-suggest-list li strong', n => n.map(x => x.textContent));
    check(more.length === 3 && more.every(x => !shown.includes(x)), `${name}: «Otras opciones» no repite lo ya mostrado`);
    await page.click('[data-availability-suggest-use]'); await page.waitForTimeout(600);
    const text = await page.evaluate(() => (document.querySelector('#smyl-inbox-message') || {}).value || '');
    check(!(await page.isVisible('[data-availability-dialog][open]')), `${name}: «Pasar al mensaje» cierra el diálogo`);
    check(/1\./.test(text) && /2\./.test(text) && /3\./.test(text) && /Responde con el número/.test(text), `${name}: el mensaje queda escrito con tres opciones numeradas`);
    // confirmar una cita: el mensaje del chat queda completo (dónde, mapa, cómo llegar, qué hacer antes, calendario)
    await page.click('[data-thread-primary-action="schedule"]'); await page.waitForSelector('[data-availability-dialog][open]'); await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.tenantId = 'tenant-preview';
      const rows = { smyl_branches: { id: 'branch-centro', name: 'Clínica Centro', address_line: 'Av. Juárez 120', city: 'Zapopan', state: 'Jalisco', postal_code: '45050', phone: '33 1234 5678', arrival_notes: 'Estacionamiento en el sótano; sube al piso 2.', timezone: 'America/Mexico_City' },
        smyl_services: { id: 'service-valuation', name: 'Valoración dental integral', prep_instructions: 'Llega 10 minutos antes y trae tus estudios previos.' } };
      window.sb.from = (table) => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: rows[table] || null, error: null }) }; return q; };
    });
    await page.click('[data-availability-mode="list"]'); await page.waitForSelector('.smyl-inbox-availability-slot', { timeout: 8000 });
    await page.click('.smyl-inbox-availability-slot'); await page.waitForSelector('[data-availability-book]:not([hidden])');
    await page.evaluate(() => { const c = document.querySelector('[data-availability-notify]'); if (c) c.checked = true; });
    const freeform = await page.isVisible('[data-availability-notify-wrap]');
    await page.click('[data-availability-book]'); await page.waitForTimeout(1800);
    const full = await page.evaluate(() => (document.querySelector('#smyl-inbox-message') || {}).value || '');
    console.log(name, JSON.stringify(full.split('\n').slice(0, 12)));
    if (!freeform) check(!/quedó confirmada/.test(full), `${name}: con la ventana de 24 h vencida no se escribe texto libre (solo plantillas)`);
    else {
      check(/quedó confirmada/.test(full), `${name}: el mensaje confirma la cita`);
      check(/Dónde: Clínica Centro · Av\. Juárez 120, Zapopan, Jalisco, 45050/.test(full), `${name}: incluye la dirección completa`);
      check(/Mapa: https:\/\/www\.google\.com\/maps\/search/.test(full), `${name}: incluye el enlace de mapa`);
      check(/Cómo llegar: Estacionamiento en el sótano/.test(full), `${name}: incluye cómo llegar`);
      check(/Antes de tu cita: Llega 10 minutos antes/.test(full), `${name}: incluye las instrucciones previas`);
      check(/Agrégala a tu calendario: https:\/\/calendar\.google\.com/.test(full), `${name}: incluye «Agregar a mi calendario»`);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), `confirmacion-completa-${name}.png`) });
    await page.evaluate(() => { const d = document.querySelector('[data-schedule-dialog][open], [data-availability-dialog][open]'); if (d) d.close(); });
    // sin espacios
    await page.click('[data-thread-primary-action="schedule"]'); await page.waitForSelector('[data-availability-dialog][open]'); await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__mode = 'empty'; });
    await page.click('[data-availability-suggest-run]'); await page.waitForTimeout(1200);
    check(/No hay espacios libres/.test(await page.textContent('[data-availability-suggest-results]')), `${name}: sin horarios lo explica`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(!overflow, `${name}: sin desbordamiento horizontal`);
    await ctx.close();
  }
  check(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
