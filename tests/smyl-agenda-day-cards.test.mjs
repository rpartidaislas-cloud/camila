// Vista Día de la agenda: cada tarjeta cabe en su bloque (1 px = 1 minuto) y no tapa su propia hora.
// Antes, una cita de 60 min desbordaba 12 px sobre la siguiente y la de 30 min 38 px, y el padding de "#p-agenda" dejaba la
// hora de inicio debajo del círculo de iniciales. La parte de navegador mide la pantalla real con las hojas de estilo de app.html
// (tests/fixtures/smyl-agenda-day-cards-preview.html) y se omite sola sin Playwright o Chromium.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fixture = pathToFileURL(path.join(root, 'tests/fixtures/smyl-agenda-day-cards-preview.html')).href;
let browser = null, motivo = '';

before(async () => {
  try {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const executablePath = process.env.SMYL_CHROMIUM || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) { motivo = 'Playwright o Chromium no disponibles: ' + String(error.message).split('\n')[0]; }
});
after(async () => { if (browser) await browser.close(); });

test('el JS marca el tamaño de cada cita de la vista Día con el mismo criterio que la semana', () => {
  const js = read('smyl-schedule.js');
  assert.match(js, /data-height="'\+height\+'" data-size="'\+\(window\.SmylScheduleGrid\?window\.SmylScheduleGrid\.size\(height\):'l'\)\+'"/);
});

test('el CSS restituye el hueco del círculo de iniciales y evita el desborde', () => {
  const css = read('smyl-schedule.css');
  assert.match(css, /#p-agenda \.schedule-timeline-event>\.schedule-appointment\{box-sizing:border-box;height:100%;min-height:0;padding:7px 10px 7px 44px/);
  assert.match(css, /schedule-timeline-event\[data-size=s\]>\.schedule-appointment\{display:flex/);
  // El contenedor no recorta (la burbuja de arrastre sale por arriba); recorta solo la tarjeta.
  assert.doesNotMatch(css, /\.schedule-timeline-event\{[^}]*overflow:hidden/);
});

test('las copias móviles son idénticas', () => {
  for (const file of ['smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) assert.equal(read(file), read('mobile/www/' + file), file);
});

test('en pantalla ninguna tarjeta desborda su bloque ni tapa su hora', async (t) => {
  if (!browser) return t.skip(motivo);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(fixture);
  const filas = await page.evaluate(() => [...document.querySelectorAll('.schedule-timeline-event')].map((evento) => {
    const tarjeta = evento.querySelector('.schedule-appointment'), caja = tarjeta.getBoundingClientRect();
    const circulo = tarjeta.querySelector('b').getBoundingClientRect(), hora = tarjeta.querySelector('span').getBoundingClientRect();
    const visibles = [...tarjeta.children].filter((x) => getComputedStyle(x).display !== 'none');
    return {
      cita: tarjeta.querySelector('strong').textContent, tamano: evento.dataset.size,
      altoBloque: Math.round(evento.getBoundingClientRect().height), altoTarjeta: Math.round(caja.height),
      contenidoFuera: visibles.some((x) => x.getBoundingClientRect().bottom > caja.bottom + 0.5),
      horaTapada: hora.left < circulo.right - 1 && hora.top < circulo.bottom && hora.bottom > circulo.top,
    };
  }));
  await page.close();
  assert.equal(filas.length, 7);
  for (const f of filas) {
    assert.equal(f.altoTarjeta, f.altoBloque, `${f.cita}: la tarjeta mide lo mismo que su bloque`);
    assert.equal(f.contenidoFuera, false, `${f.cita}: todo el contenido visible queda dentro`);
    assert.equal(f.horaTapada, false, `${f.cita}: el círculo de iniciales no tapa la hora`);
  }
  assert.deepEqual(filas.map((f) => f.tamano), ['m', 'm', 'm', 'm', 's', 's', 'l']);
});
