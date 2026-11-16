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
  assert.ok(app.indexOf('smyl-patient-quick.js?v=1') > 0 && app.indexOf('smyl-patient-quick.js?v=1') < app.indexOf('smyl-consultorio.js?v=1'));
  assert.match(app, /smyl-consultorio\.css\?v=1/);
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
  for (const f of ['smyl-consultorio.js?v=1', 'smyl-consultorio.css?v=1', 'smyl-patient-quick.js?v=1']) assert.ok(sw.includes("'/camila/" + f + "'"), f);
  for (const f of ['smyl-consultorio.js', 'smyl-consultorio.css', 'smyl-patient-quick.js', 'smyl-studio.js', 'simulacion-rapida.html', 'manifest-app.json', 'app.html', 'sw.js']) assert.equal(read(f), read('mobile/www/' + f), f);
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

probar('tocar a un paciente abre su expediente', async () => {
  const { page } = await abrir();
  await page.click('.co-person >> nth=0');
  assert.deepEqual(await registro(page, 'verPaciente'), [['verPaciente', 'p1']]);
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
  await page.click('text=Abrir expediente');
  assert.deepEqual(await registro(page, 'verPaciente'), [['verPaciente', 'nuevo-1']]);
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
  assert.deepEqual(await registro(page, 'verPaciente'), [['verPaciente', 'p2']]);
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
