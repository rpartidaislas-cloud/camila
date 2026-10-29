// Flujo v1 de punta a punta en navegador real con el visor, el store, el modelo y el cliente de análisis reales:
// (1) la IA responde el JSON envuelto en ```json → se interpreta y se guardan las observaciones como pendientes;
// (2) la IA responde algo no interpretable → "sin confirmar", sin guardar nada;
// (3) "Volver a intentar" con confirmación reinicia la revisión (la anterior queda en el historial) y un nuevo intento funciona.
// Servidor falso con la misma máquina de estados que las funciones SQL. Datos sintéticos.
const { chromium } = require('playwright');
const path = require('node:path');
let browser = null;
(async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const fail = (m) => { throw new Error(m); };
  const report = { schema: 1, quality: 'usable', qualityNote: 'Imagen utilizable.', observations: [
    { id: 'r1', category: 'density', tooth: '46', observation: 'Zona radiolúcida aparente por comprobar.', evidence: 'Región posterior inferior derecha.' },
    { id: 'r2', category: 'restoration', tooth: null, observation: 'Material radiopaco visible.', evidence: 'Corona de una pieza posterior.' }], limitations: ['Panorámica: no sirve para confirmar detalles finos.'] };
  const replies = [];
  let analyses = 0;
  await page.route('**/functions/v1/claude', async (route) => {
    analyses += 1;
    const text = replies.shift();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'msg_test' + analyses, stop_reason: 'end_turn', content: [{ type: 'text', text }] }) });
  });
  await page.goto(`file://${path.resolve(__dirname, 'fixtures/smyl-radiograph-v1-flow-preview.html')}`);
  const start = async () => { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Iniciar revisión' }).click(); };

  // 1) JSON envuelto en bloque de código → se interpreta
  replies.push('```json\n' + JSON.stringify(report) + '\n```');
  await page.locator('#open').click();
  await page.locator('.rr-intro').waitFor();
  await start();
  await page.waitForFunction(() => window.__rows.row?.document.workflow.state === 'completed');
  const done = await page.evaluate(() => ({ state: window.__rows.row.document.workflow.state, items: window.__rows.row.document.items.map((i) => [i.sourceId, i.state]), model: window.__rows.row.document.analysis.model }));
  if (done.items.length !== 2 || done.items.some(([, s]) => s !== 'pending')) fail('observations not saved as pending: ' + JSON.stringify(done));
  await page.getByRole('button', { name: 'Volver al expediente' }).click();

  // reiniciamos el servidor falso para el escenario de fallo
  await page.evaluate(() => { window.__rows.row = null; window.__rows.versions = []; });

  // 2) respuesta no interpretable → sin confirmar, nada guardado
  replies.push('Lo siento, no puedo ayudar con eso.');
  await page.locator('#open').click();
  await page.locator('.rr-intro').waitFor();
  await start();
  await page.waitForFunction(() => window.__rows.row?.document.workflow.state === 'unconfirmed');
  await page.getByRole('heading', { name: 'Revisión sin resultado confirmado' }).waitFor();
  const unconfirmed = await page.evaluate(() => ({ items: window.__rows.row.document.items.length, analysis: window.__rows.row.document.analysis, retry: !!document.querySelector('.rr-retry') }));
  if (unconfirmed.items !== 0 || unconfirmed.analysis !== null || !unconfirmed.retry) fail('unconfirmed state wrong: ' + JSON.stringify(unconfirmed));
  // diagnóstico plegado: muestra lo recibido, y nunca se guardó en la revisión
  const diag = await page.locator('details.rr-diagnostic').first().evaluate((e) => e.textContent);
  if (!diag.includes('Lo siento, no puedo ayudar')) fail('diagnostic missing: ' + diag);
  if ((await page.evaluate(() => JSON.stringify(window.__rows.row))).includes('Lo siento')) fail('diagnostic text must not be stored');
  if (analyses !== 2) fail('no automatic retry expected, analyses=' + analyses);

  // 3) volver a intentar: pide confirmación, cancelar no hace nada
  await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
  const dialogText = await page.locator('dialog.rr-confirm-dialog[open]').textContent();
  if (!dialogText.includes('otro consumo')) fail('retry warning missing: ' + dialogText);
  await page.locator('dialog.rr-confirm-dialog[open]').getByRole('button', { name: 'Cancelar' }).click();
  if ((await page.evaluate(() => window.__rows.row.document.workflow.state)) !== 'unconfirmed') fail('cancel changed state');
  await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
  await page.locator('dialog.rr-confirm-dialog[open]').getByRole('button', { name: 'Volver a intentar' }).click();
  await page.locator('.rr-intro').waitFor();
  const reset = await page.evaluate(() => ({ state: window.__rows.row.document.workflow.state, revision: window.__rows.row.revision, versions: window.__rows.versions.map((v) => v.document.workflow.state) }));
  if (reset.state !== 'ready' || reset.versions.join() !== 'ready,requested,unconfirmed,ready') fail('reset wrong: ' + JSON.stringify(reset));

  // 4) nuevo intento con JSON limpio → completa
  replies.push(JSON.stringify(report));
  await start();
  await page.waitForFunction(() => window.__rows.row?.document.workflow.state === 'completed');
  if (analyses !== 3) fail('exactly one new analysis expected, analyses=' + analyses);
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  await page.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'radiograph-v1-flow.png') }).catch(() => {});
  console.log(JSON.stringify({ ok: true, analyses, versions: reset.versions }));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
