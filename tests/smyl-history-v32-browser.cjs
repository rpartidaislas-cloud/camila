const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const STATUS_LABELS = ['No', 'Sí', 'No se sabe', 'Pendiente'];

async function editorState(page) {
  return page.evaluate(() => {
    const visible = element => element.getClientRects().length > 0;
    const editor = document.querySelector('.p360-history-edit');
    const visiblePanels = [...document.querySelectorAll('[data-history-panel]')].filter(visible);
    const primaryActions = [...document.querySelectorAll('.p360-history-edit .btn-primary')].filter(visible);
    const currentSteps = [...document.querySelectorAll('.p360-history-stepper [aria-current="step"]')].filter(visible);
    const visibleFields = [...document.querySelectorAll('.p360-history-edit input:not([type="radio"]),.p360-history-edit textarea,.p360-history-edit select')].filter(visible);
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      editorOverflow: editor.scrollWidth > editor.clientWidth + 1,
      visiblePanels: visiblePanels.length,
      visiblePanel: visiblePanels[0] && visiblePanels[0].dataset.historyPanel,
      primaryActions: primaryActions.length,
      primaryAction: primaryActions[0] && primaryActions[0].textContent.trim(),
      currentSteps: currentSteps.length,
      currentStep: currentSteps[0] && currentSteps[0].dataset.historyStep,
      minFieldHeight: visibleFields.length ? Math.min(...visibleFields.map(element => element.getBoundingClientRect().height)) : 48,
      statusLabels: [...document.querySelectorAll('[data-history-panel="attention"] .p360-history-status-options span')].slice(0, 4).map(element => element.textContent.trim()),
    };
  });
}

function validateState(state, width, expectedPanel, expectedAction) {
  if (state.scrollWidth > state.viewport + 1 || state.editorOverflow) throw new Error(`Desbordamiento horizontal a ${width}px`);
  if (state.visiblePanels !== 1 || state.visiblePanel !== expectedPanel) throw new Error(`Panel visible incorrecto a ${width}px: ${JSON.stringify(state)}`);
  if (state.primaryActions !== 1 || state.primaryAction !== expectedAction) throw new Error(`Acción primaria incorrecta a ${width}px: ${JSON.stringify(state)}`);
  if (state.currentSteps !== 1 || state.currentStep !== expectedPanel) throw new Error(`aria-current incorrecto a ${width}px: ${JSON.stringify(state)}`);
  if (STATUS_LABELS.some((label, index) => state.statusLabels[index] !== label)) throw new Error(`Estados clínicos incompletos a ${width}px`);
}

let browser;

(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-history-v32-preview.html').replace(/\\/g, '/')}?mode=edit`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'history-v33');
  fs.mkdirSync(output, { recursive: true });
  const report = [];

  for (const width of [1280, 820, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width <= 390 ? 900 : 1000 }, deviceScaleFactor: 1 });
    await page.goto(fixture);
    await page.waitForSelector('[data-history-panel="attention"]:not([hidden])');

    let state = await editorState(page);
    validateState(state, width, 'attention', 'Continuar');
    await page.screenshot({ path: path.join(output, `history-v33-${width}-attention.png`), fullPage: true });

    const alertInput = page.locator('[data-history-status-block="alerts"] [data-history-status-details] input').first();
    const preservedValue = `Alerta conservada ${width}`;
    await alertInput.fill(preservedValue);
    await page.locator('.p360-history-stepper [data-history-step="medical"]').click();
    state = await editorState(page);
    validateState(state, width, 'medical', 'Continuar');
    await page.locator('.p360-history-stepper [data-history-step="attention"]').click();
    if (await alertInput.inputValue() !== preservedValue) throw new Error(`La navegación perdió valores a ${width}px`);

    const details = page.locator('[data-history-status-block="alerts"] [data-history-status-details]');
    await page.locator('input[name="alerts_status"][value="no"]').click({ force: true });
    if (!(await page.locator('input[name="alerts_status"][value="yes"]').isChecked())) throw new Error(`Una alerta con detalle permitió marcar No a ${width}px`);
    if (!(await details.isVisible())) throw new Error(`La protección ocultó detalles clínicos existentes a ${width}px`);
    if (await alertInput.inputValue() !== preservedValue) throw new Error(`La protección borró el detalle a ${width}px`);
    const alertMessage = (await page.locator('[data-history-status-block="alerts"] [data-history-status-message]').textContent()).trim();
    if (!alertMessage) throw new Error(`Falta explicar por qué la alerta continúa en Sí a ${width}px`);

    await page.locator('.p360-history-stepper [data-history-step="habits"]').click();
    state = await editorState(page);
    validateState(state, width, 'habits', 'Continuar');
    const habitDetails = page.locator('[data-history-status-block="habits"] [data-history-status-details]');
    const habitInput = habitDetails.locator('input').first();
    if (await habitDetails.isVisible()) throw new Error(`Hábitos pendientes muestran detalles a ${width}px`);
    await page.locator('input[name="habits_status"][value="yes"]').click({ force: true });
    if (!(await habitDetails.isVisible())) throw new Error(`Elegir Sí no mostró los detalles de hábitos a ${width}px`);
    const emptyHabitValue = await habitInput.inputValue();
    await page.locator('input[name="habits_status"][value="pending"]').click({ force: true });
    if (await habitDetails.isVisible()) throw new Error(`Elegir Pendiente no ocultó los detalles de hábitos a ${width}px`);
    if (await habitInput.inputValue() !== emptyHabitValue) throw new Error(`Cambiar Hábitos a Pendiente alteró su valor a ${width}px`);

    await page.locator('[data-history-next]:visible').click();
    state = await editorState(page);
    validateState(state, width, 'extra', 'Guardar historia');
    if ((await page.locator('[data-history-progress]').textContent()).trim() !== 'Sección 5 de 5') throw new Error(`Progreso final incorrecto a ${width}px`);
    await page.screenshot({ path: path.join(output, `history-v33-${width}-final.png`), fullPage: true });
    report.push({ width, initialPanel: 'attention', finalPanel: state.visiblePanel, primaryAction: state.primaryAction, valuePreserved: true, statusToggle: true });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(async error => {
  if (browser) await browser.close();
  console.error(error);
  process.exitCode = 1;
});
