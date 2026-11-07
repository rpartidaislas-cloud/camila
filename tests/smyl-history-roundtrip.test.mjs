// Prueba de navegador del editor REAL de la Historia clínica (smyl-patient-360.js + modelo + vista) sobre datos sintéticos, sin red ni sesión
// (tests/fixtures/smyl-history-read-preview.html simula Supabase). Verifica lo que ninguna prueba de texto puede: que llenar todos los
// campos en la pantalla, guardar y reabrir conserve cada dato, y que Guardar, los atajos y Cancelar se comporten.
// Se omite sola si no hay Playwright o Chromium (así no rompe la CI normal); el trabajo "navegador" de pruebas.yml sí los instala.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = pathToFileURL(path.join(root, 'tests/fixtures/smyl-history-read-preview.html')).href;
let browser = null, motivo = '';

before(async () => {
  try {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const executablePath = process.env.SMYL_CHROMIUM || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) { motivo = 'Playwright o Chromium no disponibles: ' + String(error.message).split('\n')[0]; }
});
after(async () => { if (browser) await browser.close(); });

async function abrir(caso) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto(fixture + '?caso=' + caso);
  await page.waitForSelector('.p360-hc-band', { timeout: 8000 });
  await page.evaluate(() => {
    window.__guardados = []; let revision = 3;
    window.sb.rpc = (name, args) => {
      if (name !== 'smyl_save_patient_history') return Promise.resolve({ data: [], error: null });
      window.__guardados.push(JSON.parse(JSON.stringify(args))); revision += 1;
      return Promise.resolve({ data: { revision, updated_at: new Date().toISOString(), document: args.p_document }, error: null });
    };
  });
  return { page, errores };
}
const guardados = (page) => page.evaluate(() => window.__guardados);
const ultimaFila = (kind) => `[data-history-repeater="${kind}"] [data-history-entry]:last-child`;
const estado = (page, bloque, valor) => page.click(`label[for="p360-history-${bloque}-${valor}"]`);

function probar(nombre, fn) {
  test(nombre, async (t) => {
    if (!browser) return t.skip(motivo);
    await fn();
  });
}

probar('la lectura muestra cinco bloques numerados con índice y progreso', async () => {
  const { page, errores } = await abrir('completo');
  try {
    assert.equal(await page.locator('.p360-hc-band').count(), 5);
    assert.equal(await page.locator('.p360-hc-index button').count(), 5);
    assert.match(await page.locator('.p360-hc-progress').innerText(), /5 de 6/);
    assert.equal(await page.locator('.p360-hc-row[data-state="pending"]').count(), 1, 'solo cirugías queda por confirmar');
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('IDA Y VUELTA por la pantalla: todos los campos se guardan y reabrir sin tocar nada no cambia ninguno', async () => {
  const { page, errores } = await abrir('vacio');
  try {
    await page.click('[data-history-edit]');
    await estado(page, 'alerts', 'yes'); await page.fill('input[name="alerts"]', 'Marcapasos, Anticoagulantes');
    await estado(page, 'allergies', 'yes');
    await page.fill(ultimaFila('allergy') + ' input[name="allergy_substance[]"]', 'Penicilina');
    await page.fill(ultimaFila('allergy') + ' input[name="allergy_reaction[]"]', 'Urticaria');
    await page.selectOption(ultimaFila('allergy') + ' select[name="allergy_severity[]"]', 'high');
    await page.click('[data-history-next]');
    await estado(page, 'conditions', 'yes');
    await page.fill(ultimaFila('condition') + ' input[name="condition_name[]"]', 'Hipertensión');
    await page.fill(ultimaFila('condition') + ' input[name="condition_diagnosed_at[]"]', '2019-03');
    await page.selectOption(ultimaFila('condition') + ' select[name="condition_status[]"]', 'controlled');
    await estado(page, 'medications', 'yes');
    await page.fill(ultimaFila('medication') + ' input[name="medication_name[]"]', 'Warfarina');
    await page.fill(ultimaFila('medication') + ' input[name="medication_dose[]"]', '5 mg');
    await page.fill(ultimaFila('medication') + ' input[name="medication_frequency[]"]', 'Diaria');
    await page.fill(ultimaFila('medication') + ' input[name="medication_changed_at[]"]', '2025-01-10');
    await estado(page, 'surgeries', 'yes');
    await page.fill(ultimaFila('surgery') + ' input[name="surgery_procedure[]"]', 'Apendicectomía');
    await page.fill(ultimaFila('surgery') + ' input[name="surgery_date[]"]', '2015-06-01');
    await page.click('[data-history-next]');
    await estado(page, 'dental', 'yes');
    await page.fill('textarea[name="dental_history"]', 'Endodoncia en 36');
    await page.fill('input[name="last_dental_visit"]', '2026-03-12');
    await page.click('[data-history-next]');
    await estado(page, 'habits', 'yes'); await page.fill('input[name="habits"]', 'Bruxismo');
    await page.click('[data-history-next]');
    await page.fill('input[name="emergency_contact"]', 'María Pérez 3312345678');
    await page.fill('textarea[name="notes"]', 'Prefiere tardes');
    await page.click('[data-history-save]');
    await page.waitForSelector('.p360-hc-band');
    const [primero] = await guardados(page);
    const doc = primero.p_document;
    assert.deepEqual(doc.allergy_records, [{ substance: 'Penicilina', reaction: 'Urticaria', severity: 'high' }]);
    assert.deepEqual(doc.condition_records, [{ name: 'Hipertensión', diagnosed_at: '2019-03', status: 'controlled' }]);
    assert.deepEqual(doc.medication_records, [{ name: 'Warfarina', dose: '5 mg', frequency: 'Diaria', changed_at: '2025-01-10' }]);
    assert.deepEqual(doc.surgery_records, [{ procedure: 'Apendicectomía', date: '2015-06-01' }], 'la fecha de la cirugía debe guardarse');
    assert.equal(doc.dental_history + '|' + doc.last_dental_visit + '|' + doc.habits, 'Endodoncia en 36|2026-03-12|Bruxismo');
    assert.equal(doc.emergency_contact + '|' + doc.notes, 'María Pérez 3312345678|Prefiere tardes');
    assert.match(await page.locator('.p360-hc-progress').innerText(), /6 de 6/);
    // Reabrir y guardar sin tocar nada
    await page.click('[data-history-edit]');
    await page.click('[data-history-save]');
    await page.waitForSelector('.p360-hc-band');
    const lista = await guardados(page);
    assert.equal(lista.length, 2);
    assert.deepEqual(lista[1].p_document, doc, 'reabrir y guardar sin tocar no debe cambiar nada');
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('"+ Alergia" abre el editor listo y se puede guardar desde el primer paso', async () => {
  const { page, errores } = await abrir('completo');
  try {
    await page.click('[data-hc-add="allergy"]');
    assert.ok(await page.locator('[data-history-save]').isVisible(), 'Guardar historia debe verse en el paso 1');
    await page.fill(ultimaFila('allergy') + ' input[name="allergy_substance[]"]', 'Látex');
    await page.click('[data-history-save]');
    await page.waitForSelector('.p360-hc-band');
    const [guardado] = await guardados(page);
    assert.deepEqual(guardado.p_document.allergy_records.map((r) => r.substance), ['Penicilina', 'Látex']);
    assert.match(await page.locator('#p360-hc-safety').innerText(), /Látex/);
    assert.match(await page.locator('.p360-notice').innerText(), /actualizada/i);
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('editar una sección abre su paso, y Cancelar pide confirmar solo si hay cambios', async () => {
  const { page, errores } = await abrir('completo');
  try {
    let dialogos = 0; page.on('dialog', (d) => { dialogos += 1; d.dismiss(); });
    await page.click('[data-hc-edit="medical"]');
    assert.match(await page.locator('[data-history-progress]').innerText(), /Sección 2 de 5/);
    await page.click('[data-history-cancel]');
    assert.equal(dialogos, 0, 'sin cambios no debe preguntar');
    assert.equal(await page.locator('.p360-hc-band').count(), 5);
    await page.click('[data-history-edit]');
    await page.fill('input[name="alerts"]', 'Cambio sin guardar');
    await page.click('[data-history-cancel]');
    assert.equal(dialogos, 1, 'con cambios debe preguntar');
    assert.equal(await page.locator('#p360-history-form').count(), 1, 'al no confirmar sigue en el editor');
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('sin permiso de escritura no hay botones de edición', async () => {
  const { page, errores } = await abrir('solo-lectura');
  try {
    assert.equal(await page.locator('[data-hc-edit],[data-hc-add],[data-history-edit]').count(), 0);
    assert.equal(await page.locator('.p360-hc-band').count(), 5);
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

/* ── Historial de cambios (diálogo real) ── */
probar('el historial de cambios lista las versiones con quién y qué cambió, y se cierra', async () => {
  const { page, errores } = await abrir('completo');
  try {
    await page.click('[data-hc-versions]');
    await page.waitForSelector('.p360-hv-item');
    assert.equal(await page.locator('.p360-hv-item').count(), 3);
    const [v3, v2, v1] = await page.locator('.p360-hv-item').allInnerTexts();
    assert.match(v3, /Versión 3/); assert.match(v3, /Tú/); assert.match(v3, /Alerta agregada: Anticoagulantes/);
    assert.match(v3, /Penicilina: gravedad Moderada → Alta/); assert.match(v3, /Alerta quitada: Marcapasos/);
    assert.match(v2, /Versión 2/); assert.match(v2, /Dra\. Ruiz/);
    assert.match(v1, /Versión 1/); assert.match(v1, /Miembro del equipo/); assert.match(v1, /Historia creada sin datos\./);
    await page.click('.p360-hv [data-close]');
    assert.equal(await page.locator('dialog.p360-dialog[open]').count(), 0, 'Cerrar debe cerrar el diálogo');
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('quien solo puede leer también ve el historial de cambios', async () => {
  const { page, errores } = await abrir('solo-lectura');
  try {
    assert.equal(await page.locator('[data-history-edit]').count(), 0);
    await page.click('[data-hc-versions]');
    await page.waitForSelector('.p360-hv-item');
    assert.equal(await page.locator('.p360-hv-item').count(), 3);
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('con más de 30 versiones muestra las últimas 30 y lo avisa', async () => {
  const { page, errores } = await abrir('muchas');
  try {
    await page.click('[data-hc-versions]');
    await page.waitForSelector('.p360-hv-item');
    assert.equal(await page.locator('.p360-hv-item').count(), 30);
    assert.match(await page.locator('.p360-hv-more').innerText(), /últimas 30 versiones/);
    assert.match(await page.locator('.p360-hv-item').first().innerText(), /Versión 35/);
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('si no se pueden leer las versiones se muestra el motivo, sin romper la ficha', async () => {
  const { page, errores } = await abrir('completo');
  try {
    await page.evaluate(() => {
      const original = window.sb.from;
      window.sb.from = (tabla) => {
        if (tabla !== 'smyl_patient_history_versions') return original(tabla);
        const p = new Proxy(function () {}, { get: (_, prop) => prop === 'then' ? (ok) => Promise.resolve({ data: null, error: { message: 'No tienes permiso para consultar las versiones.' } }).then(ok) : () => p });
        return p;
      };
    });
    await page.click('[data-hc-versions]');
    await page.waitForSelector('.p360-hv-message');
    assert.match(await page.locator('.p360-hv-message').innerText(), /Tu rol no permite realizar esta acción\./, 'usa el mensaje estándar de la ficha para errores de permiso');
    assert.equal(await page.locator('.p360-hv-message[role="alert"]').count(), 1);
    await page.click('.p360-hv [data-close]');
    assert.equal(await page.locator('.p360-hc-band').count(), 5, 'la historia sigue visible');
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});

probar('en pantalla de celular el texto de cada cambio ocupa el ancho disponible (no una columna angosta)', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  try {
    await page.goto(fixture + '?caso=completo');
    await page.waitForSelector('.p360-hc-band');
    await page.click('[data-hc-versions]');
    await page.waitForSelector('.p360-hv-item');
    const medidas = await page.evaluate(() => {
      const dialogo = document.querySelector('.p360-dialog').getBoundingClientRect();
      const cambio = document.querySelector('.p360-hv-changes li[data-kind="added"] > span:last-child').getBoundingClientRect();
      return { dialogo: dialogo.width, texto: cambio.width, desborda: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(medidas.texto > medidas.dialogo * 0.6, `el texto mide ${Math.round(medidas.texto)} px de un diálogo de ${Math.round(medidas.dialogo)} px`);
    assert.equal(medidas.desborda, false, 'sin desplazamiento horizontal');
    assert.deepEqual(errores, []);
  } finally { await page.close(); }
});
