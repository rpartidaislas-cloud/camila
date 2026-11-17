// Humo de navegador del tablero de disponibilidad de «Nueva cita» (Agenda), con un Supabase simulado (tests/qa/fake-supabase-agenda-board.js):
// 3 sucursales, 6 dentistas y 12 servicios del equipo de prueba (docs/pruebas/equipo-de-prueba.sql).
//   NODE_PATH=$(npm root -g) node tests/qa/agenda-nueva-cita-smoke.cjs      (requiere Playwright y Chromium)
// Comprueba, en la pantalla real: que los días muestran cuántos horarios libres hay, que el dentista y la sucursal son filtros opcionales
// que enseñan dónde atiende cada uno, que un día sin horarios se explica y ofrece una salida, que el sillón único bloquea a la segunda
// dentista, que al tocar una hora se llenan solos dentista/sucursal/sillón/hora, y que sin hora elegida no se envía. Sale con código 1 si algo falla.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', timezoneId: 'America/Mexico_City', locale: 'es-MX', viewport: { width: 1500, height: 1100 } }); const page = await ctx.newPage(); const errs = []; let failCount = 0;
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); failCount++; } else console.log('ok · ' + msg); };
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda-board.js'), 'utf8') }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.evaluate(() => ir('agenda')); await page.waitForTimeout(2500);
  const form = '#schedule-appointment-form';
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const board = () => page.evaluate(() => {
    const t = s => [...document.querySelectorAll(s)];
    return {
      step3: (t('.schedule-board-step')[2] || {}).textContent || '',
      days: t('.schedule-board-day').map(d => d.getAttribute('aria-label')),
      pressed: (t('.schedule-board-day[aria-pressed=true]')[0] || {}).getAttribute ? t('.schedule-board-day[aria-pressed=true]')[0].getAttribute('aria-label') : '',
      groups: t('.schedule-board-group').map(g => g.querySelector('b').textContent + ' · ' + g.querySelector('small').textContent + ' · ' + [...g.querySelectorAll('.schedule-slot-time')].map(x => x.textContent).join(',')),
      explain: (document.querySelector('.schedule-board-explain') || {}).innerText || '',
      actions: t('.schedule-board-action').map(a => a.textContent),
      proOptions: t('.schedule-board-filters select')[0] ? [...t('.schedule-board-filters select')[0].options].map(o => o.text) : [],
    };
  });
  const fields = () => page.evaluate(f => { const e = document.querySelector(f).elements; return { professional: e.professional.value, branch: e.branch.value, room: e.room.value, starts: e.starts.value, service: e.service.value }; }, form);

  // 1 · se abre en modo tablero, sin hora inventada ni dentista/sucursal por defecto
  await page.click('#schedule-new'); await wait(600);
  check(await page.$(form + '[data-board]') !== null, 'Nueva cita abre en modo tablero');
  { const f0 = await fields(); check(f0.starts === '' && f0.professional === '' && f0.branch === '', 'no trae hora, dentista ni sucursal por defecto: los define la hora que se toque'); }
  check(!/Selecciona un sillón/.test(await page.$eval('[data-booking-check]', e => e.innerText)), 'el resumen no marca errores antes de elegir');
  check(await page.$$eval('.schedule-custom-grid select', s => s.map(x => x.name).sort().join(',')) === 'branch,professional,room', 'dentista, sucursal y sillón quedan en «Elegir a mano»');
  check((await board()).days.length === 0, 'sin tratamiento todavía no se muestran días');

  // 2 · al elegir el tratamiento: días con disponibilidad, solo quienes lo hacen
  await page.selectOption(form + ' select[name=service]', 's10'); await wait(700);
  let s = await board();
  check(s.days.length === 14, 'muestra 14 días');
  check(s.days.some(d => /horarios? libres?/.test(d)) && s.days.some(d => /sin horarios/.test(d)), 'los días traen su número de horarios libres o «sin horarios»');
  check(s.groups.length > 0 && s.groups.every(g => g.startsWith('Dra. Fernanda')), 'Blanqueamiento solo lo hace la Dra. Fernanda');
  check(s.proOptions.length === 2 && /Plaza Sol mar jue sáb/.test(s.proOptions[1]) && /Centro vie/.test(s.proOptions[1]), 'el menú del dentista enseña dónde y cuándo atiende: ' + s.proOptions[1]);
  check(!/Domingo|domingo/.test(s.pressed || '') , 'el día elegido no es domingo');

  // 3 · el caso del viernes: Fernanda + Plaza Sol → explica y ofrece Centro
  await page.selectOption('.schedule-board-filters select >> nth=0', 'd5'); await wait(150);
  await page.selectOption('.schedule-board-filters select >> nth=1', 'p'); await wait(150);
  const friday = await page.evaluate(() => { const i = [...document.querySelectorAll('.schedule-board-day')].findIndex(d => d.getAttribute('aria-label').startsWith('viernes')); document.querySelectorAll('.schedule-board-day')[i].click(); return i; });
  await wait(200); s = await board();
  check(/no atiende en Sucursal Plaza Sol el viernes/.test(s.explain), 'explica por qué no hay horarios: «' + s.explain.split('\n')[0] + '»');
  check(/Sucursal Centro de 3:00 pm a 7:00 pm/.test(s.explain), 'dice dónde sí atiende ese día');
  check(s.actions.includes('Ver Sucursal Centro'), 'ofrece ir a la sucursal donde sí atiende');
  await page.click('text=Ver Sucursal Centro'); await wait(250); s = await board();
  check(s.groups.length === 1 && /Fernanda/.test(s.groups[0]) && /Centro/.test(s.groups[0]) && /3:00 pm/.test(s.groups[0]), 'tras «Ver Sucursal Centro» salen sus horas de 3:00 pm en Centro: ' + (s.groups[0] || ''));

  // 4 · tocar una hora llena dentista, sucursal, sillón y hora
  await page.click('.schedule-board-group .schedule-slot-time >> nth=0'); await wait(400);
  const f = await fields();
  check(f.professional === 'd5' && f.branch === 'c' && /^\d{4}-\d{2}-\d{2}T15:00$/.test(f.starts) && f.room.startsWith('c'), 'al tocar la hora se llenan solos: ' + JSON.stringify(f));
  const summary = await page.$eval('[data-booking-check]', e => e.innerText.replace(/\n+/g, ' | '));
  check(/Dra\. Fernanda/.test(summary) && /Sucursal Centro/.test(summary), 'el resumen muestra quién atiende y la sucursal: ' + summary.slice(0, 160));
  check(await page.$eval('.schedule-board-group .schedule-slot-time[aria-pressed=true]', e => !!e).catch(() => false), 'la hora elegida queda marcada');

  // 5 · el sillón único de Plaza Sol bloquea a la segunda dentista
  await page.selectOption(form + ' select[name=service]', 's1'); await wait(700);
  await page.selectOption('.schedule-board-filters select >> nth=0', ''); await page.selectOption('.schedule-board-filters select >> nth=1', 'p'); await wait(200);
  const tue = await page.evaluate(() => window.__nextTuesday);
  await page.evaluate(t => { const d = [...document.querySelectorAll('.schedule-board-day')].find(x => x.getAttribute('aria-label').startsWith('martes ' + Number(t.slice(8)))); d.click(); }, tue); await wait(250); s = await board();
  const fer = s.groups.find(g => g.startsWith('Dra. Fernanda')), val = s.groups.find(g => g.startsWith('Dra. Valeria'));
  check(fer && val, 'el martes hay horarios de Fernanda y de Valeria en Plaza Sol: ' + s.groups.map(g => g.split(' · ')[0]).join(', '));
  check(fer && /1 solo sillón/.test(fer), 'avisa que la sucursal tiene 1 solo sillón');
  const times = g => g.split(' · ').pop().split(',');
  check(fer && !times(fer).includes('12:00 pm') && !times(fer).includes('12:30 pm') && times(fer).includes('1:00 pm'), 'con la cita de Valeria a las 12:00, Fernanda NO ofrece 12:00 ni 12:30 (sillón ocupado) pero sí 1:00 pm: ' + (fer ? times(fer).slice(0, 5).join(' ') : ''));
  check(val && !times(val).includes('11:30 am') && !times(val).includes('12:00 pm') && times(val).includes('11:00 am') && times(val).includes('1:00 pm'), 'Valeria no ofrece lo que se empalma con su propia cita: ' + (val ? times(val).join(' ') : ''));

  // 6 · sin hora elegida no se envía y lo dice claro
  await page.evaluate(f => { const e = document.querySelector(f).elements; e.patient.value = 'pac1'; const q = document.querySelector('#schedule-patient-search'); if (q) q.value = 'Hernan Partida'; e.professional.value = ''; e.starts.value = ''; }, form);
  await page.evaluate(() => window.__calls.length = 0);
  await page.click('#schedule-dialog button[type=submit], #schedule-dialog [data-save], #schedule-appointment-form button[type=submit]'); await wait(400);
  const errText = await page.$eval('#schedule-dialog', d => d.innerText).catch(() => '');
  check(/Elige una hora disponible de la lista/.test(errText), 'sin hora elegida avisa «Elige una hora disponible de la lista»');
  check(!(await page.evaluate(() => window.__calls.some(c => c[0] === 'rpc' && c[1] === 'smyl_create_appointment'))), 'y no envía la cita');

  // 7 · con una hora elegida, guarda con lo que llenó el tablero
  await page.click('.schedule-board-group .schedule-slot-time >> nth=0'); await wait(400);
  const chosen = await fields();
  await page.click('#schedule-appointment-form button[type=submit]'); await wait(700);
  const call = await page.evaluate(() => (window.__calls.find(c => c[0] === 'rpc' && c[1] === 'smyl_create_appointment') || [])[2]);
  check(call && call.p_professional_id === chosen.professional && call.p_branch_id === chosen.branch && call.p_service_id === 's1' && call.p_patient_id === 'pac1', 'guarda con el dentista y la sucursal que eligió el tablero: ' + JSON.stringify(call && { pro: call.p_professional_id, br: call.p_branch_id, room: call.p_room_id }));

  // 8 · «quién atiende cada día»
  await page.evaluate(() => { const l = document.getElementById('schedule-new'); l.click(); }); await wait(600);
  await page.selectOption(form + ' select[name=service]', 's1'); await wait(700);
  await page.click('.schedule-board-matrix > summary'); await wait(200);
  const cells = await page.$$eval('.schedule-board-cell', c => c.length);
  check(cells > 0, 'la vista «quién atiende cada día» muestra celdas con sucursal y horas (' + cells + ')');
  await page.click('.schedule-board-cell >> nth=0'); await wait(250); s = await board();
  check(s.groups.length <= 1, 'tocar una celda filtra por ese dentista y sucursal');

  console.log('errores de página:', JSON.stringify(errs)); if (errs.length) failCount++;
  await page.screenshot({ path: process.env.SHOT || '/tmp/claude-0/agenda-nueva-cita.png' });
  await b.close(); server.close(); process.exit(failCount ? 1 : 0);
});
