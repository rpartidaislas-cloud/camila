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
  const orden = ['smyl-patient-quick.js?v=1', 'smyl-visit-model.js?v=5', 'smyl-privacy-notice.js?v=1', 'smyl-history-interview.js?v=1', 'smyl-consultorio.js?v=7'].map((f) => app.indexOf(f));
  assert.ok(orden[0] > 0 && orden.every((x, i) => !i || orden[i - 1] < x), 'los módulos puros cargan antes que la pantalla');
  assert.match(app, /smyl-consultorio\.css\?v=6/);
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
  for (const f of ['smyl-consultorio.js?v=7', 'smyl-consultorio.css?v=6', 'smyl-patient-quick.js?v=1', 'smyl-visit-model.js?v=5', 'smyl-privacy-notice.js?v=1', 'smyl-history-interview.js?v=1']) assert.ok(sw.includes("'/camila/" + f + "'"), f);
  for (const f of ['smyl-consultorio.js', 'smyl-consultorio.css', 'smyl-patient-quick.js', 'smyl-visit-model.js', 'smyl-privacy-notice.js', 'smyl-history-interview.js', 'smyl-studio.js', 'simulacion-rapida.html', 'manifest-app.json', 'app.html', 'sw.js']) assert.equal(read(f), read('mobile/www/' + f), f);
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

probar('el recorrido muestra los pasos con su estado real y marca el que sigue', async () => {
  const { page, errores } = await visita();
  const p = await pasos(page);
  assert.deepEqual(p.map((x) => [x.k, x.s, x.c]), [['datos', 'done', false], ['privacidad', 'done', false], ['historia', 'todo', true], ['estudios', 'done', false], ['simulacion', 'optional', false]]);
  assert.match(p[2].t, /^1 de 6 confirmadas\. Falta: .+\.$/);
  assert.equal(p[3].t, '1 foto y 2 radiografías.');
  assert.match(p[1].t, /^Firmado el 16 de noviembre de 2026 por Ana López\. Con el texto modelo provisional\.$/);
  assert.equal(await page.textContent('.co-vprogress'), '3 de 4 pasos listos.');
  assert.equal(await page.getAttribute('.co-bar', 'aria-valuenow'), '3');
  assert.deepEqual(errores, []);
  await page.close();
});

probar('sin historia ni estudios y con la historia ilegible, el recorrido no inventa nada', async () => {
  let { page } = await visita('h=ninguna&f=ninguno');
  let p = await pasos(page);
  assert.equal(p[2].t, 'Todavía no se empieza.');
  assert.equal(p[3].t, 'Todavía no hay fotos ni radiografías.');
  await page.close();
  ({ page } = await visita('h=error&f=error'));
  p = await pasos(page);
  assert.equal(p[2].s, 'unknown');
  assert.equal(p[3].s, 'unknown');
  assert.equal(await page.textContent('.co-vprogress'), '2 de 4 pasos listos.');
  await page.close();
  ({ page } = await visita('h=completa&f=algunos'));
  assert.equal(await page.textContent('.co-vprogress'), 'Todo listo para esta visita.');
  await page.close();
});

probar('Historia y Estudios abren el expediente y saltan a su sección (accesos reales del expediente, aunque estén plegados)', async () => {
  const { page } = await visita();
  await page.click('.co-step[data-key=historia] .co-sec');   // «Abrir historia completa»; el botón principal ahora es la entrevista
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
  assert.deepEqual(p[0].a, ['Mostrar código QR', 'Completar datos', 'Enviar enlace']);
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
  await page.click('.co-close');
  await page.click('.co-end');
  assert.equal(await page.isVisible('.co-resume-btn'), false);
  assert.equal(await page.textContent('[data-co-flash]'), 'Visita terminada.');
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

// ── Historia por preguntas ──
const elegir = (page, valor) => page.click('.co-ch[data-value=' + valor + ']');
const titulo = (page) => page.textContent('.co-qtitle');
const siguiente = (page) => page.click('[data-co-next]');
async function entrevista(query = '', preparar) {
  const r = await abrir(query, preparar);
  await r.page.click('.co-person >> nth=0');
  await r.page.waitForSelector('.co-step');
  await r.page.click('.co-step[data-key=historia] .co-sgo');
  await r.page.waitForSelector('.co-qtitle');
  return r;
}

probar('solo se preguntan las secciones pendientes y «Siguiente» espera a que se responda', async () => {
  const { page, errores } = await entrevista();
  assert.equal(await titulo(page), '¿Hay algo que deba saberse antes de atender?', 'las alergias ya estaban confirmadas, empieza por las alertas');
  assert.equal(await page.textContent('[data-co-interview] .co-vprogress'), 'Pregunta 1 de 6');
  assert.equal(await page.isDisabled('[data-co-next]'), true);
  await elegir(page, 'yes');
  assert.equal(await page.isDisabled('[data-co-next]'), true, '«Sí» sin decir cuál no basta');
  await page.fill('.co-field input', 'toma anticoagulantes');
  assert.equal(await page.isDisabled('[data-co-next]'), false);
  assert.deepEqual(errores, []);
  await page.close();
});

probar('la pregunta de alergias va primero, lleva la advertencia de seguridad y no deja posponerla con «No lo sé» suelto', async () => {
  const { page } = await entrevista('h=ninguna');
  assert.match(await titulo(page), /alérgico/);
  assert.equal(await page.getAttribute('.co-hint', 'data-safety'), 'true');
  assert.deepEqual(await page.$$eval('.co-ch', (n) => n.map((x) => x.textContent)), ['No', 'Sí']);
  assert.equal(await page.locator('text=No lo sé, confirmarlo después').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'co-qtitle', 'el foco pasa al título de cada pregunta');
  await page.close();
});

probar('contestar todo y guardar envía UN solo guardado con el documento del editor y la revisión vigente', async () => {
  const { page } = await entrevista();
  await elegir(page, 'yes'); await page.fill('.co-field input', 'toma anticoagulantes'); await siguiente(page);   // alertas
  await elegir(page, 'no'); await siguiente(page);                                                                  // condiciones
  await elegir(page, 'yes');                                                                                         // medicamentos
  const campos = await page.$$('.co-field input');
  await campos[0].fill('losartán'); await campos[1].fill('50 mg'); await siguiente(page);
  await elegir(page, 'no'); await siguiente(page);                                                                  // cirugías
  await elegir(page, 'yes'); await page.fill('.co-field textarea', 'ortodoncia hace 5 años'); await siguiente(page);   // dental
  await elegir(page, 'no');                                                                                          // hábitos
  assert.equal(await page.textContent('[data-co-next]'), 'Revisar');
  await siguiente(page);
  assert.equal(await titulo(page), 'Revisa y guarda');
  assert.match(await page.textContent('.co-review'), /Alertas médicas\s*toma anticoagulantes/);
  assert.match(await page.textContent('.co-review'), /Medicamentos\s*losartán, 50 mg/);
  assert.equal((await page.evaluate(() => window.__guardados || [])).length, 0, 'nada se guarda antes de confirmar');
  await page.click('[data-co-save]');
  await page.waitForSelector('.co-success');
  const guardados = await page.evaluate(() => window.__guardados);
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0].p_patient_id, 'p1');
  assert.equal(guardados[0].p_expected_revision, 3);
  const doc = guardados[0].p_document;
  assert.deepEqual(doc.alerts, ['toma anticoagulantes']);
  assert.equal(doc.medication_records[0].name, 'losartán');
  assert.equal(doc.medication_records[0].dose, '50 mg');
  assert.equal(doc.allergies_status, 'no', 'lo que ya estaba confirmado se conserva');
  assert.equal(doc.habits_status, 'no');
  assert.equal(doc.dental_history, 'ortodoncia hace 5 años');
  assert.equal(await page.textContent('.co-success'), 'Historia guardada.');
  await page.close();
});

probar('una alergia con detalle y gravedad queda como en el editor', async () => {
  const { page } = await entrevista('h=ninguna');
  await elegir(page, 'yes');
  await page.fill('.co-field >> nth=0 >> input', 'penicilina'); await page.fill('.co-field >> nth=1 >> input', 'urticaria');
  await page.click('.co-chipbtn >> text=Alta');
  await page.click('text=+ Agregar otra alergia');
  const campos = await page.$$('.co-field input');
  await campos[2].fill('látex');
  for (let i = 0; i < 6; i++) { await siguiente(page); await elegir(page, 'no'); }   // el resto: «No»
  await siguiente(page);
  await page.click('[data-co-save]');
  await page.waitForSelector('.co-success');
  const doc = (await page.evaluate(() => window.__guardados))[0].p_document;
  assert.deepEqual(doc.allergy_records, [{ substance: 'penicilina', reaction: 'urticaria', severity: 'high' }, { substance: 'látex', reaction: '', severity: '' }]);
  assert.equal((await page.evaluate(() => window.__guardados))[0].p_expected_revision, 0, 'sin historia previa, revisión 0');
  await page.close();
});

probar('si la historia cambió en otra sesión se avisa, no se pierde lo contestado y se puede reintentar', async () => {
  const { page } = await entrevista('', () => { window.__falla40001 = true; });
  await elegir(page, 'no'); await siguiente(page);
  for (let i = 0; i < 4; i++) { await elegir(page, 'no'); await siguiente(page); }
  await elegir(page, 'no'); await siguiente(page);
  await page.click('[data-co-save]');
  await page.waitForSelector('.co-error-box:not([hidden])');
  assert.match(await page.textContent('.co-error-box'), /cambió en otra sesión y tus respuestas no se guardaron/);
  assert.equal(await page.isDisabled('[data-co-save]'), false);
  assert.equal(await page.locator('.co-success').count(), 0);
  await page.close();
});

probar('«Salir» pide confirmación solo si hay respuestas sin guardar', async () => {
  let { page } = await entrevista();
  let preguntas = 0; page.on('dialog', (d) => { preguntas++; d.dismiss(); });
  await elegir(page, 'no');
  await page.click('text=‹ Salir');
  assert.equal(preguntas, 1);
  assert.equal(await page.isVisible('.co-qtitle'), true, 'al cancelar se queda');
  page.removeAllListeners('dialog'); page.on('dialog', (d) => { preguntas++; d.accept(); });
  await page.click('text=‹ Salir');
  await page.waitForSelector('.co-step');
  assert.equal(await page.isVisible('.co-step[data-key=historia]'), true);
  await page.close();
  ({ page } = await entrevista());
  let sinPregunta = 0; page.on('dialog', (d) => { sinPregunta++; d.accept(); });
  await page.click('text=‹ Salir');
  await page.waitForSelector('.co-step');
  assert.equal(sinPregunta, 0, 'sin cambios no pregunta');
  await page.close();
});

probar('sin permiso de escritura clínica, o con la historia ilegible, no se ofrece la entrevista', async () => {
  let { page } = await visita('rol=staff');
  assert.deepEqual((await pasos(page))[2].a, ['Abrir historia clínica']);
  await page.close();
  ({ page } = await visita('h=error'));
  assert.deepEqual((await pasos(page))[2].a, ['Abrir historia clínica']);
  await page.close();
});

probar('ninguna respuesta se guarda en el navegador', async () => {
  const { page } = await entrevista();
  await elegir(page, 'yes'); await page.fill('.co-field input', 'dato clínico confidencial');
  const guardado = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  assert.doesNotMatch(guardado, /confidencial|anticoagulantes/);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), ['smyl_visit']);
  await page.close();
});

probar('las preguntas y la revisión caben en 390 px y los botones son táctiles', async () => {
  const { page } = await entrevista();
  await elegir(page, 'yes');
  const medidas = await page.$$eval('.co-ch, .co-ivnav button, .co-field input', (n) => n.map((x) => Math.round(x.getBoundingClientRect().height)));
  assert.ok(medidas.every((h) => h >= 44), 'objetivos táctiles de 44 px o más: ' + medidas);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: process.env.SMYL_CAPTURA_PREGUNTA || '/tmp/consultorio-pregunta.png', fullPage: true });
  await page.fill('.co-field input', 'toma anticoagulantes');
  for (let i = 0; i < 6; i++) { await siguiente(page); if (i < 5) await elegir(page, 'no'); }
  await page.waitForSelector('[data-co-save]');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: process.env.SMYL_CAPTURA_REVISION || '/tmp/consultorio-revision.png', fullPage: true });
  await page.close();
});

// ── Cierre de la visita ──
async function cierre(query = '', quien = 0) {
  const r = await visita(query, quien);
  await r.page.click('.co-close');
  await r.page.waitForSelector('[data-co-close] .co-qtitle');
  return r;
}

probar('el cierre resume lo hecho y lo que falta, sin bloquear nada', async () => {
  const { page, errores } = await cierre();
  assert.equal(await page.textContent('[data-co-close] .co-qtitle'), 'Cerrar la visita');
  const filas = await page.$$eval('.co-closing li', (n) => n.map((x) => [x.dataset.state, x.querySelector('b').textContent]));
  assert.deepEqual(filas, [['done', 'Datos del paciente'], ['done', 'Aviso de privacidad'], ['todo', 'Historia clínica'], ['done', 'Fotos y radiografía']]);
  assert.match(await page.textContent('[data-co-close] .co-hint'), /Quedó pendiente 1 cosa\. Puedes terminar la visita igual/);
  assert.equal(await page.isEnabled('.co-end'), true, 'terminar siempre se puede');
  assert.deepEqual(errores, []);
  await page.close();
});

probar('cierre con todo listo, o con lo que no se pudo comprobar, lo dice sin inventar', async () => {
  let { page } = await cierre('h=completa&f=algunos');
  assert.match(await page.textContent('[data-co-close] .co-hint'), /Todo lo de esta visita quedó listo/);
  await page.close();
  ({ page } = await cierre('h=error&f=error'));
  assert.match(await page.textContent('[data-co-close] .co-hint'), /No pude comprobar todo/);
  assert.deepEqual(await page.$$eval('.co-closing li', (n) => n.map((x) => x.dataset.state)), ['done', 'done', 'unknown', 'unknown']);
  await page.close();
});

probar('próxima cita: se muestra la agendada, o se ofrece agendar con el paciente ya puesto', async () => {
  let { page } = await cierre('prox=si');
  assert.match(await page.textContent('[data-co-close] .co-csec'), /Próxima cita[\s\S]*\d+ de \w+ a las \d+:\d\d [ap]m/);
  assert.equal(await page.textContent('[data-co-book]'), 'Agendar otra cita');
  await page.close();
  ({ page } = await cierre('prox=no'));
  assert.match(await page.textContent('[data-co-close] .co-csec'), /Todavía no tiene una agendada/);
  await page.click('[data-co-book]');
  assert.deepEqual(await registro(page, 'bookFor'), [['bookFor', 'p1', 'Cristian', '+52 3312345678']]);
  await page.close();
  ({ page } = await cierre('prox=error'));
  assert.match(await page.textContent('[data-co-close] .co-csec'), /No se pudo comprobar/);
  await page.close();
});

probar('Ir a Finanzas abre Finanzas', async () => {
  const { page } = await cierre();
  await page.evaluate(() => document.querySelector('[data-co-pay]').click());
  assert.equal((await page.evaluate(() => window.__rutas)).pop(), 'caja');
  await page.close();
});

probar('la despedida por WhatsApp solo lleva cortesía y la próxima cita, y se abre con el teléfono del paciente', async () => {
  const { page } = await cierre('prox=si');
  const mensaje = await page.textContent('[data-co-msg]');
  assert.match(mensaje, /^Hola Cristian, gracias por tu visita\. Tu próxima cita es el .+\. ¡Hasta pronto!$/);
  assert.doesNotMatch(mensaje, /alerg|diagn|medic|radiograf|saldo|cobro|historia/i);
  await page.click('[data-co-send]');
  const abierto = (await registro(page, 'open'))[0][1];
  assert.ok(abierto.startsWith('https://wa.me/523312345678?text='), abierto);
  assert.equal(decodeURIComponent(abierto.split('?text=')[1]), mensaje);
  await page.close();
});

probar('sin teléfono no se puede enviar y se explica; una ficha por registrar no se saluda con su teléfono', async () => {
  let { page } = await cierre('', 1);   // María: sin teléfono
  assert.equal(await page.isDisabled('[data-co-send]'), true);
  assert.match(await page.textContent('[data-co-close]'), /Falta un teléfono válido/);
  await page.close();
  ({ page } = await cierre('', 3));     // por registrar, con teléfono
  assert.match(await page.textContent('[data-co-msg]'), /^Hola, gracias por tu visita\./);
  assert.equal(await page.isEnabled('[data-co-send]'), true);
  await page.close();
});

probar('sin permiso para agendar ni cobrar esos botones no aparecen, y volver y terminar funcionan', async () => {
  const { page } = await cierre('rol=staff');
  assert.equal(await page.locator('[data-co-book]').count(), 0);
  assert.equal(await page.locator('[data-co-pay]').count(), 0);
  await page.click('text=‹ Volver a la visita');
  await page.waitForSelector('.co-step');
  await page.click('.co-close');
  await page.click('.co-end');
  await page.waitForSelector('[data-co-flash]:not([hidden])');
  assert.equal(await page.textContent('[data-co-flash]'), 'Visita terminada.');
  assert.equal(await page.isVisible('.co-resume-btn'), false);
  await page.close();
});

probar('el cierre cabe en 390 px', async () => {
  const { page } = await cierre('prox=no');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const medidas = await page.$$eval('[data-co-close] .co-sgo, [data-co-close] .co-sec', (n) => n.map((x) => Math.round(x.getBoundingClientRect().height)));
  assert.ok(medidas.every((h) => h >= 44), 'objetivos táctiles: ' + medidas);
  await page.screenshot({ path: process.env.SMYL_CAPTURA_CIERRE || '/tmp/consultorio-cierre.png', fullPage: true });
  await page.close();
});

// ── Código QR de registro ──
const hex64 = 'ab'.repeat(32);
async function conQr(query = '') {
  const r = await visita(query, 3);   // ficha por registrar (p4)
  await r.page.click('.co-step[data-key=datos] >> text=Mostrar código QR');
  await r.page.waitForSelector('.co-qrbox');
  return r;
}

probar('el QR crea un enlace de un solo uso para ese paciente y lo dibuja de verdad', async () => {
  const { page, errores } = await conQr();
  assert.deepEqual(await page.evaluate(() => window.__enlaces), ['p4']);
  const url = await page.inputValue('.co-qrlink');
  assert.match(url, new RegExp('registro-paciente\\.html\\?token=' + hex64 + '$'));
  assert.equal(await page.getAttribute('.co-qrbox', 'role'), 'img');
  // El dibujo es exactamente el QR de ese enlace (mismo generador que usa MILA en el celular).
  const igual = await page.evaluate((u) => {
    const c = window.qrcode(0, 'M'); c.addData(u); c.make();
    const esperado = new DOMParser().parseFromString(c.createSvgTag({ cellSize: 6, margin: 2, scalable: true }), 'image/svg+xml').querySelector('path').getAttribute('d');
    return document.querySelector('.co-qrbox path').getAttribute('d') === esperado && esperado.length > 500;
  }, url);
  assert.equal(igual, true);
  assert.match(await page.textContent('.co-qrhint'), /una sola vez y vence en 7 días/);
  assert.match(await page.textContent('[data-co-qr-status]'), /Esperando a que termine/);
  assert.deepEqual(errores, []);
  await page.close();
});

probar('al terminar el paciente, la pantalla se entera sola y ofrece ver sus datos', async () => {
  const { page } = await conQr();
  await page.evaluate(() => { window.__pac.p4 = { id: 'p4', nombre: 'Luis', apellido: 'Gómez', telefono: '+52 3398765432', registro_estado: 'por_verificar' }; });
  await page.waitForFunction(() => /Ya llenó sus datos/.test(document.querySelector('[data-co-qr-status]').textContent), null, { timeout: 4000 });
  assert.match(await page.textContent('[data-co-qr-status]'), /Falta que los confirmes/);
  await page.click('text=Ver sus datos');
  await page.waitForFunction(() => !document.querySelector('#co-dialog').open);
  await page.waitForFunction(() => /Los llenó el paciente/.test(document.querySelector('.co-step[data-key=datos]').textContent));
  assert.deepEqual((await pasos(page))[0].a, ['Confirmar datos', 'Revisar y editar']);
  await page.close();
});

probar('al cerrar el código se deja de preguntar', async () => {
  const { page } = await conQr();
  await page.waitForTimeout(500);
  const antes = (await registro(page, 'leePaciente')).length;
  assert.ok(antes >= 2, 'mientras está abierto, revisa cada pocos segundos');
  await page.click('#co-dialog .co-ghost');
  await page.waitForTimeout(100);
  const alCerrar = (await registro(page, 'leePaciente')).length;
  await page.waitForTimeout(700);
  assert.equal((await registro(page, 'leePaciente')).length, alCerrar, 'ya no hay más lecturas');
  await page.close();
});

probar('desde el QR se puede mandar el enlace por WhatsApp o copiarlo', async () => {
  const { page } = await conQr();
  const url = await page.inputValue('.co-qrlink');
  await page.click('[data-co-qr-wa]');
  const abierto = (await registro(page, 'open'))[0][1];
  assert.ok(abierto.startsWith('https://wa.me/523398765432?text='), abierto);
  assert.ok(decodeURIComponent(abierto.split('?text=')[1]).includes(url));
  await page.click('text=Copiar enlace');
  await page.waitForSelector('text=Enlace copiado');
  assert.deepEqual(await page.evaluate(() => window.__portapapeles), [url]);
  await page.close();
});

probar('si no se puede crear el enlace se explica y no se dibuja ningún código', async () => {
  for (const [qr, texto] of [['42501', /no permite crear enlaces/], ['falta', /Falta aplicar la migración/]]) {
    const r = await visita('qr=' + qr, 3);
    await r.page.click('.co-step[data-key=datos] >> text=Mostrar código QR');
    await r.page.waitForSelector('#co-dialog .co-error');
    assert.match(await r.page.textContent('#co-dialog .co-error'), texto);
    assert.equal(await r.page.locator('.co-qrbox').count(), 0);
    await r.page.close();
  }
});

probar('sin permiso para gestionar pacientes no hay QR; y el código cabe en 390 px', async () => {
  let { page } = await visita('rol=staff', 3);
  assert.deepEqual((await pasos(page))[0].a, ['Completar datos', 'Enviar enlace']);
  await page.close();
  ({ page } = await conQr());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const caja = await page.$eval('.co-qrbox', (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.ok(caja[0] >= 200 && Math.abs(caja[0] - caja[1]) <= 2, 'el código es cuadrado y de tamaño legible: ' + caja);
  await page.screenshot({ path: process.env.SMYL_CAPTURA_QR || '/tmp/consultorio-qr.png' });
  await page.close();
});

// ── Firma del aviso de privacidad ──
async function abrirFirma(query = 'firma=no', quien = 0) {
  const r = await visita(query, quien);
  await r.page.click('.co-step[data-key=privacidad] .co-sgo');
  await r.page.waitForSelector('[data-co-consent] .co-canvas');
  return r;
}
async function trazar(page, desde = [40, 90]) {
  await page.locator('.co-canvas').scrollIntoViewIfNeeded();
  const caja = await page.$eval('.co-canvas', (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await page.mouse.move(caja.x + desde[0], caja.y + desde[1]);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(caja.x + desde[0] + i * 14, caja.y + desde[1] + Math.sin(i / 2) * 30);
  await page.mouse.up();
}
const leer = (page) => page.$eval('.co-notice', (n) => { n.scrollTop = n.scrollHeight; n.dispatchEvent(new Event('scroll')); });
const textoAviso = (page) => page.$$eval('.co-notice p', (n) => n.map((x) => x.textContent).join('\n\n'));

probar('el paso de privacidad dice si falta, quién y cuándo firmó, o que no se pudo comprobar', async () => {
  let { page } = await visita('firma=no');
  let p = (await pasos(page))[1];
  assert.deepEqual([p.k, p.s, p.t, p.a], ['privacidad', 'todo', 'Falta su firma.', ['Pedir firma']]);
  assert.equal(await page.textContent('.co-vprogress'), '2 de 4 pasos listos.');
  await page.close();
  ({ page } = await visita('firma=si'));
  p = (await pasos(page))[1];
  assert.deepEqual([p.s, p.a], ['done', ['Ver firma']]);
  await page.close();
  ({ page } = await visita('firma=error'));
  p = (await pasos(page))[1];
  assert.deepEqual([p.s, p.t], ['unknown', 'Ábrelo para ver si está firmado.']);
  await page.close();
});

probar('la pantalla de firma muestra el texto con el nombre de la clínica y avisa que es un modelo provisional', async () => {
  const { page, errores } = await abrirFirma();
  assert.equal(await page.isVisible('[data-co-provisional]'), true);
  assert.match(await page.textContent('[data-co-provisional]'), /Texto modelo provisional\. Revísalo con tu asesor legal/);
  assert.match(await textoAviso(page), /^Responsable: Diseño de Sonrisas\./);
  assert.equal(await page.inputValue('[data-co-consent] .co-field input'), 'Cristian Partida', 'propone el nombre del paciente');
  assert.deepEqual(errores, []);
  await page.close();
});

probar('no se puede guardar hasta consentir y firmar de verdad; un toque suelto no es firma', async () => {
  const { page } = await abrirFirma();
  assert.equal(await page.isDisabled('[data-co-consent-save]'), true);
  assert.match(await page.textContent('[data-co-consent-hint]'), /Desliza el aviso hasta el final/);
  assert.equal(await page.isDisabled('[data-co-consent-check]'), true, 'no se puede aceptar sin llegar al final');
  assert.equal(await page.isVisible('[data-co-consent-more]'), true);
  await leer(page);
  assert.equal(await page.isDisabled('[data-co-consent-check]'), false);
  assert.equal(await page.isVisible('[data-co-consent-more]'), false);
  assert.match(await page.textContent('[data-co-consent-hint]'), /Marca que leyó el aviso/);
  await page.check('[data-co-consent-check]');
  assert.match(await page.textContent('[data-co-consent-hint]'), /Falta la firma/);
  await page.locator('.co-canvas').scrollIntoViewIfNeeded();
  const caja = await page.$eval('.co-canvas', (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await page.mouse.click(caja.x + 50, caja.y + 50);   // un toque
  assert.equal(await page.isDisabled('[data-co-consent-save]'), true, 'un punto no es una firma');
  await trazar(page);
  assert.equal(await page.isDisabled('[data-co-consent-save]'), false);
  assert.equal(await page.textContent('[data-co-consent-hint]'), '');
  await page.click('[data-co-consent-clear]');
  assert.equal(await page.isDisabled('[data-co-consent-save]'), true, 'al borrar vuelve a faltar');
  await page.close();
});

probar('guardar envía el texto exacto que se leyó, su versión, la marca provisional y una imagen PNG con trazo', async () => {
  const { page } = await abrirFirma();
  const mostrado = await textoAviso(page);
  await leer(page); await page.check('[data-co-consent-check]'); await trazar(page);
  await page.click('[data-co-consent-save]');
  await page.waitForSelector('.co-success');
  assert.equal(await page.textContent('.co-success'), 'Firma guardada.');
  const [firma] = await page.evaluate(() => window.__firmas);
  assert.equal(firma.p_patient_id, 'p1');
  assert.equal(firma.p_notice_text, mostrado, 'lo que se guardó es lo que la persona vio');
  assert.equal(firma.p_notice_version, 'modelo-provisional-1');
  assert.equal(firma.p_provisional, true);
  assert.equal(firma.p_signer_name, 'Cristian Partida');
  assert.equal(firma.p_signer_relation, 'patient');
  assert.match(firma.p_signature_png, /^data:image\/png;base64,iVBORw0KGgo/);
  assert.ok(firma.p_signature_png.length >= 300 && firma.p_signature_png.length <= 120000, 'cabe en lo que acepta la base: ' + firma.p_signature_png.length);
  const imagen = await page.evaluate((png) => new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let tinta = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 120) tinta++; ok([i.width, i.height, tinta]); }; i.src = png; }), firma.p_signature_png);
  assert.deepEqual(imagen.slice(0, 2), [600, 200]);
  assert.ok(imagen[2] > 200, 'la imagen trae el trazo, no está en blanco: ' + imagen[2]);
  await page.close();
});

probar('firma de un tutor con otro nombre, y ficha por registrar sin nombre propuesto', async () => {
  let { page } = await abrirFirma();
  await page.fill('[data-co-consent] .co-field input', 'Rosa Partida');
  await page.click('.co-ch[data-value=guardian]');
  await leer(page); await page.check('[data-co-consent-check]'); await trazar(page);
  await page.click('[data-co-consent-save]');
  await page.waitForSelector('.co-success');
  const [firma] = await page.evaluate(() => window.__firmas);
  assert.deepEqual([firma.p_signer_name, firma.p_signer_relation], ['Rosa Partida', 'guardian']);
  await page.close();
  ({ page } = await abrirFirma('firma=no', 3));   // por registrar
  assert.equal(await page.inputValue('[data-co-consent] .co-field input'), '');
  assert.match(await page.textContent('[data-co-consent-hint]'), /Escribe el nombre de quien firma/);
  await page.close();
});

probar('si la firma no se guarda se explica y se conserva lo dibujado para reintentar', async () => {
  for (const [err, texto] of [['42501', /no permite registrar firmas/], ['22023', /La firma no es válida/], ['falta', /Falta aplicar la migración de firmas/]]) {
    const { page } = await abrirFirma('firma=no&firmaerr=' + err);
    await leer(page); await page.check('[data-co-consent-check]'); await trazar(page);
    await page.click('[data-co-consent-save]');
    await page.waitForSelector('[data-co-consent-error]:not([hidden])');
    assert.match(await page.textContent('[data-co-consent-error]'), texto);
    assert.equal(await page.isDisabled('[data-co-consent-save]'), false, 'puede reintentar sin volver a firmar');
    assert.equal(await page.locator('.co-success').count(), 0);
    await page.close();
  }
});

probar('salir con una firma dibujada pide confirmación; sin dibujar, no', async () => {
  let { page } = await abrirFirma();
  let preguntas = 0; page.on('dialog', (d) => { preguntas++; d.dismiss(); });
  await trazar(page);
  await page.click('text=‹ Volver a la visita');
  assert.equal(preguntas, 1);
  assert.equal(await page.isVisible('.co-canvas'), true);
  await page.close();
  ({ page } = await abrirFirma());
  let sin = 0; page.on('dialog', (d) => { sin++; d.accept(); });
  await page.click('text=‹ Volver a la visita');
  await page.waitForSelector('.co-step');
  assert.equal(sin, 0);
  await page.close();
});

probar('la firma no se guarda en el navegador', async () => {
  const { page } = await abrirFirma();
  await leer(page); await page.check('[data-co-consent-check]'); await trazar(page);
  const guardado = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  assert.doesNotMatch(guardado, /iVBOR|data:image/);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), ['smyl_visit']);
  await page.close();
});

probar('Ver firma muestra la imagen, quién y cuándo firmó y el texto exacto; sin acceso clínico no aparece', async () => {
  let { page } = await visita('firma=si');
  await page.click('.co-step[data-key=privacidad] >> text=Ver firma');
  await page.waitForSelector('.co-sigimg');
  assert.match(await page.getAttribute('.co-sigimg', 'src'), /^data:image\/png;base64,/);
  assert.equal(await page.getAttribute('.co-sigimg', 'alt'), 'Firma de Ana López');
  assert.match(await page.textContent('.co-sigview .co-ok'), /Ana López.*16 de noviembre de 2026\. Versión modelo-provisional-1, texto modelo provisional\./);
  await page.click('.co-sigtext summary');
  assert.match(await page.textContent('.co-sigtext'), /Párrafo uno del aviso\.[\s\S]*Huella del texto: abababababababab/);
  assert.deepEqual(await registro(page, 'verFirma'), [['verFirma', 'c1']]);
  await page.close();
  ({ page } = await visita('firma=si&rol=staff'));
  assert.deepEqual((await pasos(page))[1].a, [], 'sin clinical.read no se ve la firma');
  await page.close();
});

probar('sin permiso para registrar firmas no hay botón de pedirla', async () => {
  const { page } = await visita('firma=no&rol=staff');
  assert.deepEqual((await pasos(page))[1].a, []);
  await page.close();
});

probar('la pantalla de firma cabe en 390 px, con objetivos táctiles y lienzo de 180 px', async () => {
  const { page } = await abrirFirma();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const medidas = await page.$$eval('[data-co-consent] .co-ch, [data-co-consent] .co-sgo, [data-co-consent] .co-check, [data-co-consent] .co-field input', (n) => n.map((x) => Math.round(x.getBoundingClientRect().height)));
  assert.ok(medidas.every((h) => h >= 44), 'objetivos táctiles: ' + medidas);
  assert.equal(await page.$eval('.co-canvas', (n) => Math.round(n.getBoundingClientRect().height)), 180);
  await leer(page); await page.check('[data-co-consent-check]'); await trazar(page);
  await page.screenshot({ path: process.env.SMYL_CAPTURA_FIRMA || '/tmp/consultorio-firma.png', fullPage: true });
  await page.close();
});
