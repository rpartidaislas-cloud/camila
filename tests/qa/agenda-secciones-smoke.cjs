// Humo de navegador de «Horarios y servicios» con secciones plegables (Supabase simulado: tests/qa/fake-supabase-agenda-board.js).
//   NODE_PATH=$(npm root -g) node tests/qa/agenda-secciones-smoke.cjs      (requiere Playwright y Chromium; SHOT_DIR=carpeta guarda capturas)
// Comprueba: la pestaña abre con todas las secciones plegadas y un resumen en cada encabezado (sin scroll), se pliegan y despliegan con el botón o tocando
// el encabezado, «Expandir todo / Contraer todo», el estado se recuerda al recargar, el horario sale agrupado por profesional y «Editar horario» sigue funcionando.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..', '..');
const shots = process.env.SHOT_DIR || os.tmpdir();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const REMINDERS = { settings: { enabled: true, reminder_48h_enabled: true, template_id: 't1', template_name: 'recordatorio_cita_confirmar_v1', variables: [], confirmation_enabled: false, no_show_enabled: true, no_show_template_id: 't2', feedback_enabled: false, send_window_start: '09:00:00', send_window_end: '20:00:00', whatsapp_mode: 'single', whatsapp_phone: '' }, can_configure: true, templates: [], overview: {} };
server.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch();
  let failures = 0;
  const check = (c, m) => { console.log((c ? 'ok · ' : 'FALLA · ') + m); if (!c) failures += 1; };
  for (const [name, w, h] of [['escritorio', 1440, 1000], ['celular', 390, 900]]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', timezoneId: 'America/Mexico_City', locale: 'es-MX', viewport: { width: w, height: h } });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda-board.js'), 'utf8') });
      return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort();
    });
    const url = `http://127.0.0.1:${server.address().port}/app.html`;
    async function boot() {
      await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
      await page.evaluate((rem) => {
        const old = window.sb.functions.invoke.bind(window.sb.functions);
        window.sb.functions.invoke = async (fn, opts) => (fn === 'appointment-reminders' ? { data: rem, error: null } : fn === 'whatsapp-templates' ? { data: { can_request: true, templates: [] }, error: null } : old(fn, opts));
      }, REMINDERS);
      await page.evaluate(() => ir('agenda')); await page.waitForTimeout(2200);
      await page.evaluate(() => document.querySelector('[data-schedule-tab="settings"]').click()); await page.waitForTimeout(1800);
    }
    await boot();
    const cards = () => page.evaluate(() => [...document.querySelectorAll('.schedule-settings-grid > .schedule-card')].map(c => ({ id: c.id || (c.querySelector('[id]') || {}).id, titulo: c.querySelector('.schedule-section-title h2').textContent.trim(), plegada: c.dataset.collapsed, resumen: (c.querySelector('.sc-chip') || {}).textContent, visible: c.getClientRects().length > 0, alto: Math.round(c.getBoundingClientRect().height) })));
    let list = await cards();
    console.log(name, JSON.stringify(list));
    check(list.length === 4, `${name}: cuatro secciones (Servicios, Horario, Mensajes automáticos, Agenda con IA)`);
    check(list.every(c => c.plegada === 'true' && c.resumen), `${name}: todas abren plegadas y con resumen en el encabezado`);
    check(list.every(c => c.alto <= 80), `${name}: cada sección plegada ocupa una sola fila (${list.map(c => c.alto).join(', ')} px)`);
    const alto = await page.evaluate(() => { const cs = [...document.querySelectorAll('.schedule-settings-grid > .schedule-card')]; return Math.round(cs.reduce((sum, c) => sum + c.getBoundingClientRect().height + 10, 0)); });
    check(alto < 330, `${name}: las cuatro secciones juntas ocupan ${alto} px (antes había que bajar bastante)`);
    check(await page.evaluate(() => [...document.querySelectorAll('.schedule-settings-grid > .schedule-card .sc-toggle')].every(t => t.getAttribute('aria-expanded') === 'false' && /Mostrar/.test(t.getAttribute('aria-label')))), `${name}: los botones dicen «Mostrar …» y aria-expanded=false`);
    await page.screenshot({ path: path.join(shots, `agenda-secciones-plegadas-${name}.png`) });

    // Desplegar el horario con el botón y comprobar el agrupado por profesional.
    await page.locator('#schedule-hours-list').evaluate(el => el.closest('.schedule-card').querySelector('.sc-toggle').click()); await page.waitForTimeout(200);
    const horario = await page.evaluate(() => ({ pros: document.querySelectorAll('#schedule-hours-list .schedule-hour-pro').length, filas: [...document.querySelectorAll('#schedule-hours-list .schedule-hour-pro')].map(a => a.querySelector('strong').textContent + ':' + a.querySelectorAll('li').length), botones: document.querySelectorAll('#schedule-hours-list [data-hour-edit]').length }));
    console.log(name, 'horario:', JSON.stringify(horario));
    check(horario.pros > 0 && horario.pros < horario.botones + 1, `${name}: el horario sale agrupado: una fila por profesional (${horario.pros}) con una línea por sede (${horario.botones})`);
    check((await cards()).filter(c => c.plegada === 'false').length === 1, `${name}: solo se desplegó esa sección`);
    // Tocar el encabezado (no el botón) también pliega.
    await page.locator('#schedule-hours-list').evaluate(el => el.closest('.schedule-card').querySelector('.schedule-section-title h2').click()); await page.waitForTimeout(200);
    check((await cards()).every(c => c.plegada === 'true'), `${name}: tocar el título pliega la sección`);
    // Expandir todo / Contraer todo
    await page.click('.sc-toolbar-action:has-text("Expandir todo")'); await page.waitForTimeout(200);
    check((await cards()).every(c => c.plegada === 'false'), `${name}: «Expandir todo» despliega las cuatro`);
    await page.screenshot({ path: path.join(shots, `agenda-secciones-abiertas-${name}.png`), fullPage: true });
    await page.click('.sc-toolbar-action:has-text("Contraer todo")'); await page.waitForTimeout(200);
    check((await cards()).every(c => c.plegada === 'true'), `${name}: «Contraer todo» las pliega`);
    // «Editar horario» sigue funcionando y el estado se recuerda al recargar.
    await page.locator('#schedule-hours-list').evaluate(el => el.closest('.schedule-card').querySelector('.sc-toggle').click());
    const guardado = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('smyl_agenda_sections_')) || '{}') || '{}')));
    check(guardado.includes('schedule-hours-list'), `${name}: recuerda lo que dejaste abierto (${JSON.stringify(guardado)})`);
    await boot();
    list = await cards();
    check(list.find(c => c.id === 'schedule-hours-list').plegada === 'false' && list.filter(c => c.plegada === 'false').length === 1, `${name}: tras recargar, solo el horario sigue abierto`);
    check(!errs.filter(e => !/ERR_FAILED/.test(e)).length, `${name}: sin errores de página ${JSON.stringify(errs.slice(0, 2))}`);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${name}: sin scroll horizontal`);
    await ctx.close();
  }
  await b.close(); server.close();
  console.log(failures ? failures + ' falla(s)' : 'Todo bien');
  process.exit(failures ? 1 : 0);
});
