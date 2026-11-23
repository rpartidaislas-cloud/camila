// Humo de navegador: Lista de espera (pestaña de Agenda, alta, aviso de hueco liberado y «Ofrecer»).
//   NODE_PATH=$(npm root -g) node tests/qa/lista-espera-smoke.cjs      (requiere Playwright y Chromium)
// Usa tests/qa/fake-supabase-agenda.js y sustituye las funciones de la lista de espera por un simulador en la página.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'app.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch(); let fails = 0; const errs = [];
  const check = (ok, msg) => { console.log((ok ? 'ok · ' : 'FALLA · ') + msg); if (!ok) fails++; };
  for (const [name, w, h] of [['desk', 1440, 900], ['mobile', 390, 844]]) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, timezoneId: 'America/Mexico_City', locale: 'es-MX', hasTouch: w < 500 });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message.slice(0, 160))); page.on('dialog', d => d.accept());
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8') });
      return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
    const P3 = 'p3000000-0000-4000-8000-000000000003';
    await page.evaluate((P3) => {
      const db = window.__db; db.smyl_waitlist_entries = []; db.smyl_professional_services = [{ professional_id: 'pr1', service_id: 's1' }, { professional_id: 'pr1', service_id: 's2' }];
      db.camila_lana_handoffs = [{ tenant_id: db.camila_tenants[0].id, patient_id: P3, lana_conversation_id: 'conv-3', lana_channel: 'whatsapp', updated_at: new Date().toISOString() }];
      db.smyl_branches[0].timezone = 'America/Mexico_City';
      window.__composed = []; window.__composeResult = true; window.SmylInbox = Object.assign(window.SmylInbox || {}, { compose: async (id, text, opts) => { window.__composed.push({ id, text, template: opts && opts.template ? { names: opts.template.names, variables: opts.template.variables, missing: opts.template.missingText } : null }); window.__onSent = opts && opts.onSent; return window.__composeResult; } });
      const rpc = window.sb.rpc.bind(window.sb);
      window.sb.rpc = async (n, a) => {
        const T = db.camila_tenants[0].id;
        if (n === 'smyl_search_patients') return { data: db.camila_pacientes.filter(p => (p.nombre + ' ' + p.apellido).toLowerCase().includes(String(a.p_query).toLowerCase())), error: null };
        if (n === 'smyl_waitlist_add') { const row = { id: 'w' + (db.smyl_waitlist_entries.length + 1), tenant_id: T, patient_id: a.p_patient_id, service_id: a.p_service_id, branch_id: a.p_branch_id, professional_id: a.p_professional_id, daypart: a.p_daypart, not_before: a.p_not_before, not_after: a.p_not_after, priority: a.p_priority, note: a.p_note, status: 'waiting', source: a.p_source, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60 * 864e5).toISOString() }; db.smyl_waitlist_entries.push(row); return { data: row, error: null }; }
        if (n === 'smyl_waitlist_offer') { const row = db.smyl_waitlist_entries.find(x => x.id === a.p_id); row.status = 'offered'; row.offered_at = new Date().toISOString(); row.offered_start = a.p_offered_start; return { data: row, error: null }; }
        if (n === 'smyl_waitlist_set_status') { const i = db.smyl_waitlist_entries.findIndex(x => x.id === a.p_id); const row = db.smyl_waitlist_entries[i]; row.status = a.p_status; if (a.p_status !== 'waiting') db.smyl_waitlist_entries.splice(i, 1); else { row.offered_at = null; } return { data: row, error: null }; }
        return rpc(n, a);
      };
    }, P3);
    await page.evaluate(() => window.ir('agenda')); await page.waitForTimeout(1500);
    check(await page.isVisible('[data-schedule-tab="waitlist"]'), `${name}: Agenda tiene la pestaña «Lista de espera»`);
    await page.click('[data-schedule-tab="waitlist"]'); await page.waitForTimeout(800);
    check(/Nadie está esperando/.test(await page.textContent('#schedule-waitlist')), `${name}: vacía explica qué hacer`);
    // alta
    await page.click('[data-wl-add]'); await page.waitForSelector('#waitlist-dialog[open]');
    await page.click('#waitlist-dialog [type=submit]');
    check(!(await page.$eval('#waitlist-dialog [data-wl-error]', e => e.hidden)), `${name}: sin paciente no deja agregar`);
    await page.fill('#wl-search', 'doña'); await page.waitForSelector('[data-wl-results] button', { timeout: 4000 }); await page.click('[data-wl-results] button');
    await page.selectOption('#waitlist-dialog [name=service]', 's1'); await page.check('#waitlist-dialog [name=daypart][value=afternoon]'); await page.check('#waitlist-dialog [name=urgent]');
    await page.fill('#waitlist-dialog [name=note]', 'Sale del trabajo a las 5.');
    await page.click('#waitlist-dialog [type=submit]'); await page.waitForTimeout(1200);
    const card = await page.textContent('#schedule-waitlist');
    check(/La doña 2/.test(card) && /Urgente/.test(card) && /por la tarde/.test(card) && /Sale del trabajo/.test(card), `${name}: aparece en la lista con urgencia, franja y nota`);
    check(/\(1\)/.test(await page.textContent('#schedule-waitlist-count')), `${name}: la pestaña muestra el contador`);
    await page.screenshot({ path: path.join(os.tmpdir(), `lista-espera-${name}.png`) });
    // hueco liberado
    // Las horas se calculan en la zona de la página (Ciudad de México), no en la del proceso de prueba.
    const slot = (h) => page.evaluate((hour) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hour, 0, 0, 0); return { starts_at: d.toISOString(), ends_at: new Date(d.getTime() + 3600000).toISOString(), branch_id: 'b1', professional_id: 'pr1', service_id: 's1' }; }, h);
    const clearToast = () => page.evaluate(() => { const t = document.getElementById('waitlist-toast'); if (t) t.remove(); });
    await clearToast();
    await page.evaluate((s) => window.SmylWaitlist.onSlotFreed({ canManage: true, slot: s }), await slot(10)); await page.waitForTimeout(900);
    check(!(await page.$('#waitlist-toast')), `${name}: un hueco por la mañana NO avisa (pidió por la tarde)`);
    await page.evaluate((s) => window.SmylWaitlist.onSlotFreed({ canManage: true, slot: s }), await slot(16)); await page.waitForSelector('#waitlist-toast button.btn');
    check(/Se liberó un horario/.test(await page.textContent('#waitlist-toast')) && /1 paciente en espera/.test(await page.textContent('#waitlist-toast')), `${name}: un hueco por la tarde avisa que hay 1 paciente`);
    await page.click('#waitlist-toast button.btn'); await page.waitForSelector('.wl-candidates');
    const cand = await page.textContent('.wl-candidates');
    check(/La doña 2/.test(cand) && /Urgente/.test(cand), `${name}: «Ver quién» lista a la persona con su motivo`);
    await page.screenshot({ path: path.join(os.tmpdir(), `lista-espera-hueco-${name}.png`) });
    check(!(await page.$eval('[data-wl-offer="0"]', b => b.disabled)), `${name}: «Ofrecer» está habilitado (tiene chat de WhatsApp)`);
    await page.click('[data-wl-offer="0"]'); await page.waitForTimeout(1200);
    const composed = await page.evaluate(() => window.__composed);
    check(composed.length === 1 && composed[0].id === 'conv-3', `${name}: el mensaje se escribe en el chat correcto`);
    check(composed[0] && /Hola La, se liberó un horario para Limpieza dental/.test(composed[0].text) && /Respóndeme «sí»/.test(composed[0].text), `${name}: el texto ofrece el horario sin prometerlo`);
    check(!(await page.isVisible('#waitlist-dialog[open]')), `${name}: el diálogo se cierra al ofrecer`);
    await page.click('[data-schedule-tab="calendar"]'); await page.click('[data-schedule-tab="waitlist"]'); await page.waitForTimeout(800);
    check(/Se le ofreció/.test(await page.textContent('#schedule-waitlist')), `${name}: la lista muestra «Se le ofreció…»`);
    await page.click('[data-wl-booked]'); await page.waitForTimeout(900);
    check(/Nadie está esperando/.test(await page.textContent('#schedule-waitlist')), `${name}: «Ya se agendó» lo saca de la lista`);
    // ventana de 24 h cerrada: plantilla con variables llenas; la oferta se registra solo cuando se envía
    const addAgain = () => page.evaluate(async (P3) => { await window.sb.rpc('smyl_waitlist_add', { p_patient_id: P3, p_service_id: 's1', p_branch_id: null, p_professional_id: null, p_daypart: 'afternoon', p_not_before: null, p_not_after: null, p_priority: 'normal', p_note: '', p_source: 'manual' }); await window.SmylWaitlist.reload(); }, P3);
    const offerOnce = async () => { await clearToast(); await page.evaluate((s) => window.SmylWaitlist.onSlotFreed({ canManage: true, slot: s }), await slot(16)); await page.waitForSelector('#waitlist-toast button.btn'); await page.click('#waitlist-toast button.btn'); await page.waitForSelector('[data-wl-offer="0"]'); await page.click('[data-wl-offer="0"]'); await page.waitForTimeout(1000); };
    await addAgain(); await page.evaluate(() => { window.__composeResult = 'template'; window.__composed.length = 0; });
    await offerOnce();
    const viaTemplate = await page.evaluate(() => ({ call: window.__composed[0], status: window.__db.smyl_waitlist_entries[0].status }));
    check(viaTemplate.call && viaTemplate.call.template && viaTemplate.call.template.names[0] === 'cita_lista_espera_v1', `${name}: con la ventana cerrada pide la plantilla «Se liberó un horario»`);
    const vars = viaTemplate.call.template.variables;
    check(vars.length === 4 && vars[0] === 'La' && vars[1] === 'Principal' && /^[a-záéíóú]+ \d{1,2} de [a-z]+$/.test(vars[2]) && /^\d{1,2}:\d{2} [ap]\.m\.$/.test(vars[3]), `${name}: las cuatro variables van llenas (${vars.join(' | ')})`);
    check(viaTemplate.status === 'waiting', `${name}: la oferta NO se registra mientras no se envíe la plantilla`);
    await page.evaluate(() => window.__onSent()); await page.waitForTimeout(800);
    check(await page.evaluate(() => window.__db.smyl_waitlist_entries[0].status) === 'offered', `${name}: al enviarse la plantilla, la oferta queda registrada`);
    // sin plantilla aprobada: el chat avisa y devuelve false; nada se registra
    await page.evaluate(() => { window.__db.smyl_waitlist_entries.length = 0; }); await addAgain(); await page.evaluate(() => { window.__composeResult = false; window.__composed.length = 0; });
    await offerOnce();
    check(await page.evaluate(() => window.__db.smyl_waitlist_entries[0].status) === 'waiting', `${name}: sin plantilla aprobada no se registra ninguna oferta`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(!overflow, `${name}: sin desbordamiento horizontal`);
    await ctx.close();
  }
  check(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
