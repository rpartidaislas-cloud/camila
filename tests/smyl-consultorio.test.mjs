// Consultorio (etapa 1): pantalla para cuando el paciente está presente. La parte de navegador ejecuta el módulo REAL
// (smyl-consultorio.js + smyl-patient-quick.js + las hojas de app.html) contra un Supabase simulado
// (tests/fixtures/smyl-consultorio-preview.html) y se omite sola sin Playwright o Chromium.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fixture = pathToFileURL(path.join(root, 'tests/fixtures/smyl-consultorio-preview.html')).href;
let browser = null, motivo = '';

before(async () => {
  try {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const executablePath = process.env.SMYL_CHROMIUM || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) { motivo = 'Playwright o Chromium no disponibles: ' + String(error.message).split('\n')[0]; }
});
after(async () => { if (browser) await browser.close(); });

async function abrir(query = '', preparar) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  if (preparar) await page.addInitScript(preparar);
  await page.goto(fixture + (query ? '?' + query : ''));
  await page.waitForSelector('#p-consultorio.activa [data-co-list] > *', { timeout: 8000 });
  return { page, errores };
}
function probar(nombre, fn) { test(nombre, async (t) => { if (!browser) return t.skip(motivo); await fn(); }); }
const registro = (page, nombre) => page.evaluate((n) => window.__log.filter((x) => x[0] === n), nombre);

// ── Contrato del código (no necesita navegador) ──
test('app.html carga el módulo puro antes que el Consultorio y arranca en él solo en la app instalada', () => {
  const app = read('app.html');
  const orden = ['smyl-patient-quick.js?v=1', 'smyl-visit-model.js?v=1', 'smyl-consultorio.js?v=2'].map((f) => app.indexOf(f));
  assert.ok(orden[0] > 0 && orden[0] < orden[1] && orden[1] < orden[2], 'los módulos puros cargan antes que la pantalla');
  assert.match(app, /smyl-consultorio\.css\?v=2/);
  assert.match(app, /else if \(smylEsAppInstalada\(\) && document\.getElementById\('p-consultorio'\)\) ir\('consultorio'\)/);
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /window\.navigator\.standalone === true/);
  assert.match(app, /Capacitor\.isNativePlatform/);
  // El navegador y la computadora conservan su arranque: el Consultorio nunca es la ruta por omisión fuera de la app instalada.
  assert.doesNotMatch(app, /\n\s*ir\('consultorio'\);\s*\n\s*history/);
});

test('el simulador y el manifiesto llevan al Consultorio y el simulador sigue accesible desde él', () => {
  assert.match(read('smyl-studio.js'), /consultorioLink\.href='app\.html\?ir=consultorio'/);
  assert.match(read('smyl-consultorio.js'), /data-co-sim href="' \+ esc\(simulatorUrl\(\)\)/);
  assert.match(read('smyl-consultorio.js'), /'simulacion-rapida\.html\?workspace=professional'/);
  const manifest = JSON.parse(read('manifest-app.json'));
  assert.equal(manifest.shortcuts[0].url, 'app.html?ir=consultorio');
});

test('se precarga y las copias móviles son idénticas', () => {
  const sw = read('sw.js');
  for (const f of ['smyl-consultorio.js?v=2', 'smyl-consultorio.css?v=2', 'smyl-patient-quick.js?v=1', 'smyl-visit-model.js?v=1']) assert.ok(sw.includes("'/camila/" + f + "'"), f);
  for (const f of ['smyl-consultorio.js', 'smyl-consultorio.css', 'smyl-patient-quick.js', 'smyl-visit-model.js', 'smyl-studio.js', 'simulacion-rapida.html', 'manifest-app.json', 'app.html', 'sw.js']) assert.equal(read(f), read('mobile/www/' + f), f);
});

test('los datos de pacientes se pintan con textContent o escapados', () => {
  const js = read('smyl-consultorio.js');
  assert.match(js, /info\.append\(el\('b', '', name\)/);           // lista de hoy
  assert.match(js, /info\.append\(el\('b', '', Q\.listName\(p\)\)/);   // resultados de búsqueda
  assert.match(js, /esc\(name\)/);                                 // ventana de alta creada
  assert.match(js, /esc\(row\.telefono\)/);
  assert.match(js, /value="' \+ esc\(tel\)/);                       // lo escrito en la búsqueda
  assert.match(js, /value="' \+ esc\(name\)/);
});

// ── Pantalla real ──
probar('la lista muestra quién está hoy, en orden, sin citas terminadas ni canceladas', async () => {
  const { page, errores } = await abrir();
  assert.equal(await page.textContent('[data-co-sub]'), 'Hoy: 5 citas, 1 en consulta.');
  const filas = await page.$$eval('.co-person', (n) => n.map((x) => [x.querySelector('b').textContent, x.querySelector('.co-chip').textContent]));
  assert.deepEqual(filas, [['Cristian Partida', 'En consulta'], ['María Rodríguez de la Garza', 'En sala'], ['Juan Pérez', 'Por llegar'], ['Por registrar', 'Por llegar']]);
  assert.match(await page.textContent('.co-note.co-muted'), /1 cita terminada hoy/);
  assert.match(await page.textContent('.co-people li:last-child small'), /\+52 3398765432/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'sin desborde horizontal a 390 px');
  assert.deepEqual(errores, []);
  await page.close();
});

probar('tocar a un paciente empieza su visita, con su nombre y el estado de la cita arriba', async () => {
  const { page } = await abrir();
  await page.click('.co-person >> nth=0');
  await page.waitForSelector('.co-vname');
  assert.equal(await page.textContent('.co-vname'), 'Cristian Partida');
  assert.match(await page.textContent('.co-vhead small'), /\+52 3312345678.*En consulta, 10:00 am/);
  await page.close();
});

probar('alta con solo el teléfono: ficha por registrar y siguiente paso a la vista', async () => {
  const { page } = await abrir();
  await page.click('[data-co-new]');
  await page.fill('#co-dialog input[name=tel]', '33 9876 5432');
  await page.click('#co-dialog .co-submit');
  await page.waitForSelector('.co-created');
  assert.deepEqual(await page.evaluate(() => window.__inserts), [{ tenant_id: '11111111-1111-4111-8111-111111111111', nombre: 'Por registrar · +52 3398765432', apellido: '', telefono: '+52 3398765432', email: '', registro_estado: 'pendiente' }]);
  assert.match(await page.textContent('.co-ok'), /Por registrar.*\+52 3398765432.*Queda por registrar/s);
  await page.click('text=Enviar enlace para que llene sus datos');
  assert.deepEqual(await registro(page, 'enlace'), [['enlace', 'nuevo-1', '+52 3398765432']]);
  await page.click('text=Empezar la visita');
  await page.waitForSelector('.co-vname');
  assert.equal(await page.textContent('.co-vname'), 'Por registrar');
  assert.equal(await page.getAttribute('.co-step[data-key=datos]', 'data-current'), 'true', 'el primer paso que falta es sus datos');
  await page.close();
});

probar('con nombre no queda pendiente y no ofrece enlace de registro', async () => {
  const { page } = await abrir();
  await page.click('[data-co-new]');
  await page.fill('#co-dialog input[name=nombre]', 'Ana López');
  await page.click('#co-dialog .co-submit');
  await page.waitForSelector('.co-created');
  const fila = (await page.evaluate(() => window.__inserts))[0];
  assert.equal(fila.nombre, 'Ana López');
  assert.equal('registro_estado' in fila, false);
  assert.equal(await page.locator('text=Enviar enlace para que llene sus datos').count(), 0);
  await page.close();
});

probar('sin teléfono ni nombre, o con teléfono inválido, no se crea nada y se explica por qué', async () => {
  const { page } = await abrir();
  await page.click('[data-co-new]');
  await page.click('#co-dialog .co-submit');
  assert.match(await page.textContent('[data-co-error]'), /Escribe el teléfono/);
  await page.fill('#co-dialog input[name=tel]', '123');
  await page.click('#co-dialog .co-submit');
  assert.match(await page.textContent('[data-co-error]'), /Revisa el teléfono/);
  assert.deepEqual(await page.evaluate(() => window.__inserts), []);
  await page.close();
});

probar('un teléfono que ya existe avisa y solo crea si confirmas que es otra persona', async () => {
  const { page } = await abrir();
  await page.click('[data-co-new]');
  await page.fill('#co-dialog input[name=tel]', '33 1234 5678');
  await page.click('#co-dialog .co-submit');
  await page.waitForSelector('.co-dups');
  assert.match(await page.textContent('.co-dups'), /Cristian Partida/);
  assert.deepEqual(await page.evaluate(() => window.__inserts), []);
  await page.click('text=Es otra persona, crear de todos modos');
  await page.waitForSelector('.co-created');
  assert.equal((await page.evaluate(() => window.__inserts)).length, 1);
  await page.close();
});

probar('si la base aún no tiene registro_estado, el alta reintenta sin esa columna', async () => {
  const { page } = await abrir('', () => { window.__fallaColumna = true; });
  await page.click('[data-co-new]');
  await page.fill('#co-dialog input[name=tel]', '33 9876 5432');
  await page.click('#co-dialog .co-submit');
  await page.waitForSelector('.co-created');
  const filas = await page.evaluate(() => window.__inserts);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].registro_estado, 'pendiente');
  assert.equal('registro_estado' in filas[1], false);
  await page.close();
});

probar('buscar encuentra pacientes y, si no hay, ofrece crearlo', async () => {
  const { page } = await abrir();
  await page.fill('[data-co-q]', 'mar');
  await page.waitForSelector('.co-hit');
  assert.match(await page.textContent('.co-hit'), /María Rodríguez/);
  await page.click('.co-hit');
  await page.waitForSelector('.co-vname');
  assert.equal(await page.textContent('.co-vname'), 'María Rodríguez de la Garza');
  await page.click('.co-back');
  await page.fill('[data-co-q]', 'zzz');
  await page.waitForSelector('.co-none');
  await page.click('.co-none >> text=Crear paciente nuevo');
  assert.equal(await page.inputValue('#co-dialog input[name=nombre]'), 'zzz');
  await page.close();
});

probar('el simulador sigue a un toque y Panel completo, Agenda y Cerrar sesión funcionan', async () => {
  const { page } = await abrir();
  assert.equal(await page.getAttribute('[data-co-sim]', 'href'), 'simulacion-rapida.html?workspace=professional');
  // La pantalla se oculta al navegar, así que se pulsa por código en lugar de con el ratón.
  for (const sel of ['[data-co-panel]', '[data-co-agenda]', '[data-co-logout]']) await page.evaluate((x) => document.querySelector(x).click(), sel);
  assert.deepEqual(await page.evaluate(() => window.__rutas.slice(-2)), ['dashboard', 'agenda']);
  assert.deepEqual(await registro(page, 'cerrarSesion'), [['cerrarSesion']]);
  await page.close();
});

probar('un rol sin permiso para gestionar pacientes no ve «Paciente nuevo»', async () => {
  const { page } = await abrir('rol=staff');
  await page.waitForFunction(() => document.querySelector('[data-co-new]').hidden === true);
  await page.close();
});

probar('sin citas, con todo terminado y con error de carga el texto dice qué hacer', async () => {
  let { page } = await abrir('caso=vacio');
  assert.match(await page.textContent('[data-co-list]'), /Nadie por atender ahora/);
  assert.equal(await page.textContent('[data-co-sub]'), 'Hoy no hay citas en la agenda.');
  await page.close();
  ({ page } = await abrir('caso=terminadas'));
  assert.match(await page.textContent('[data-co-list]'), /Ya terminaste las 2 citas de hoy/);
  await page.close();
  ({ page } = await abrir('caso=error'));
  assert.match(await page.textContent('[data-co-list]'), /Sin conexión con el servidor/);
  assert.equal(await page.locator('.co-retry').count(), 1);
  await page.close();
});

// ── Recorrido de la visita ──
const pasos = (page) => page.$$eval('.co-step', (n) => n.map((x) => ({ k: x.dataset.key, s: x.dataset.state, c: x.dataset.current === 'true', t: x.querySelector('small').textContent, a: [...x.querySelectorAll('button')].map((b) => b.textContent) })));
async function visita(query = '', quien = 0) {
  const r = await abrir(query);
  await r.page.click('.co-person >> nth=' + quien);
  await r.page.waitForSelector('.co-step');
  return r;
}

probar('el recorrido muestra los cuatro pasos con su estado real y marca el que sigue', async () => {
  const { page, errores } = await visita();
  const p = await pasos(page);
  assert.deepEqual(p.map((x) => [x.k, x.s, x.c]), [['datos', 'done', false], ['historia', 'todo', true], ['estudios', 'done', false], ['simulacion', 'optional', false]]);
  assert.match(p[1].t, /^1 de 6 confirmadas\. Falta: .+\.$/);
  assert.equal(p[2].t, '1 foto y 2 radiografías.');
  assert.equal(await page.textContent('.co-vprogress'), '2 de 3 pasos listos.');
  assert.equal(await page.getAttribute('.co-bar', 'aria-valuenow'), '2');
  assert.deepEqual(errores, []);
  await page.close();
});

probar('sin historia ni estudios y con la historia ilegible, el recorrido no inventa nada', async () => {
  let { page } = await visita('h=ninguna&f=ninguno');
  let p = await pasos(page);
  assert.equal(p[1].t, 'Todavía no se empieza.');
  assert.equal(p[2].t, 'Todavía no hay fotos ni radiografías.');
  await page.close();
  ({ page } = await visita('h=error&f=error'));
  p = await pasos(page);
  assert.equal(p[1].s, 'unknown');
  assert.equal(p[2].s, 'unknown');
  assert.equal(await page.textContent('.co-vprogress'), '1 de 3 pasos listos.');
  await page.close();
  ({ page } = await visita('h=completa&f=algunos'));
  assert.equal(await page.textContent('.co-vprogress'), 'Todo listo para esta visita.');
  await page.close();
});

probar('Historia y Estudios abren el expediente y saltan a su sección (accesos reales del expediente, aunque estén plegados)', async () => {
  const { page } = await visita();
  await page.click('.co-step[data-key=historia] .co-sgo');
  await page.waitForFunction(() => window.__log.some((x) => x[0] === 'tab'));
  assert.deepEqual(await registro(page, 'tab'), [['tab', 'history', 'p1']]);
  await page.evaluate(() => window.ir('consultorio'));
  await page.click('.co-resume-btn');
  await page.waitForSelector('.co-step');
  await page.click('.co-step[data-key=estudios] .co-sec');
  await page.waitForFunction(() => window.__log.filter((x) => x[0] === 'tab').length === 2);
  assert.deepEqual((await registro(page, 'tab'))[1], ['tab', 'files', 'p1']);
  await page.close();
});

probar('un paciente por registrar ofrece completar sus datos y enviar el enlace; al cerrar el formulario se vuelve a leer', async () => {
  const { page } = await visita('', 3);
  const p = await pasos(page);
  assert.equal(p[0].s, 'todo');
  assert.deepEqual(p[0].a, ['Completar datos', 'Enviar enlace']);
  await page.click('.co-step[data-key=datos] >> text=Enviar enlace');
  assert.deepEqual(await registro(page, 'enlace'), [['enlace', 'p4', '+52 3398765432']]);
  await page.click('.co-step[data-key=datos] >> text=Completar datos');
  assert.deepEqual(await registro(page, 'abrirModal'), [['abrirModal', 'p4']]);
  assert.equal((await registro(page, 'leePaciente')).length, 1);
  await page.waitForTimeout(1000);                       // el formulario sigue abierto: no se vuelve a leer
  assert.equal((await registro(page, 'leePaciente')).length, 1);
  await page.evaluate(() => window.__cerrarModal());     // al cerrarlo, se vuelve a leer al paciente
  await page.waitForFunction(() => window.__log.filter((x) => x[0] === 'leePaciente').length === 2, null, { timeout: 4000 });
  await page.close();
});

probar('datos por verificar: confirmar los marca completos; sin permiso solo se puede revisar', async () => {
  const { page } = await abrir();
  await page.fill('[data-co-q]', 'luis');
  await page.click('.co-hit');
  await page.waitForSelector('.co-step');
  assert.deepEqual((await pasos(page))[0].a, ['Confirmar datos', 'Revisar y editar']);
  await page.click('text=Confirmar datos');
  await page.waitForFunction(() => window.__updates.length === 1);
  const cambio = (await page.evaluate(() => window.__updates))[0];
  assert.equal(cambio.table, 'camila_pacientes');
  assert.equal(cambio.registro_estado, 'completo');
  await page.close();
  const staff = await abrir('rol=staff');
  await staff.page.fill('[data-co-q]', 'luis');
  await staff.page.click('.co-hit');
  await staff.page.waitForSelector('.co-step');
  assert.deepEqual((await pasos(staff.page))[0].a, ['Revisar y editar']);
  await staff.page.close();
});

probar('el simulador sale del recorrido con el paciente ya ligado (solo la cuenta dueña)', async () => {
  let { page } = await visita();
  let pedida = null;
  await page.route('**/simulacion-rapida.html*', (route) => { pedida = route.request().url(); route.abort(); });
  await page.click('.co-step[data-key=simulacion] .co-sec');
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 300));
  assert.match(pedida, /simulacion-rapida\.html\?workspace=professional&patient=p1&clinic=11111111-1111-4111-8111-111111111111$/);
  await page.close();
  ({ page } = await visita('rol=staff'));
  pedida = null;
  await page.route('**/simulacion-rapida.html*', (route) => { pedida = route.request().url(); route.abort(); });
  await page.click('.co-step[data-key=simulacion] .co-sec');
  await new Promise((r) => setTimeout(r, 300));
  assert.match(pedida, /simulacion-rapida\.html\?workspace=professional$/);
  await page.close();
});

probar('la visita en curso se recuerda: aviso al volver, botón fijo en otras pantallas y se quita al terminar', async () => {
  const { page } = await visita();
  await page.evaluate(() => window.ir('pacientes'));
  assert.equal(await page.isVisible('#smyl-co-pill'), true);
  assert.equal(await page.textContent('#smyl-co-pill'), 'Volver a la visita de Cristian Partida');
  await page.click('#smyl-co-pill');
  await page.waitForSelector('.co-step');
  assert.equal(await page.isVisible('#smyl-co-pill'), false, 'en el Consultorio no hace falta');
  await page.click('.co-back');
  assert.match(await page.textContent('.co-resume-btn'), /Visita en curso\s*Cristian Partida/);
  await page.click('.co-resume-btn');
  await page.waitForSelector('.co-step');
  await page.click('.co-end');
  assert.equal(await page.isVisible('.co-resume-btn'), false);
  await page.evaluate(() => window.ir('pacientes'));
  assert.equal(await page.isVisible('#smyl-co-pill'), false);
  await page.close();
});

probar('el recorrido cabe en un celular de 390 px', async () => {
  const { page } = await visita('h=parcial&f=algunos');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: process.env.SMYL_CAPTURA || '/tmp/consultorio-visita.png', fullPage: true });
  await page.close();
});
