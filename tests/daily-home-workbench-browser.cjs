const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const fixture = pathToFileURL(path.resolve(__dirname, 'fixtures/smyl-daily-home-stage4-preview.html')).href;
  const output = path.resolve(__dirname, '../artifacts/dashboard-operativo-v2');
  fs.mkdirSync(output, { recursive: true });

  for (const width of [1440, 1024, 820, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width <= 390 ? 844 : 1000 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error.message || error)));
    await page.goto(fixture);
    await page.waitForSelector('[data-home-next] button').catch(error => {
      if (pageErrors.length) throw new Error(`Error JavaScript en Inicio a ${width}px: ${pageErrors.join(' | ')}`);
      throw error;
    });
    await page.waitForSelector('.daily-home-chat');
    const result = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      dashboardOverflow: document.querySelector('#smyl-daily-home').scrollWidth > document.querySelector('#smyl-daily-home').clientWidth + 1,
      operationalMetrics: document.querySelectorAll('.daily-home-kpi-section .daily-home-metric').length,
      attentionMetric: document.querySelectorAll('.daily-home-kpi-section [data-kind="attention"]').length,
      priorityTitle: document.querySelector('[data-home-priority-title]')?.textContent.trim(),
      priorityCount: document.querySelector('[data-home-priority-count]')?.textContent.trim(),
      resolvedCardVisible: document.querySelector('[data-home-chats]').textContent.includes('Conversación resuelta'),
      shortcuts: document.querySelectorAll('.daily-home-shortcuts').length,
      minInteractiveHeight: Math.min(...[...document.querySelectorAll('#smyl-daily-home button')].filter(node => node.offsetParent !== null).map(node => node.getBoundingClientRect().height)),
    }));
    if (result.documentOverflow || result.dashboardOverflow) throw new Error(`Desbordamiento detectado a ${width}px`);
    if (result.operationalMetrics !== 4) throw new Error(`El Inicio no conserva sus cuatro indicadores a ${width}px`);
    if (result.attentionMetric) throw new Error(`El Inicio duplicó la alerta general dentro de los indicadores a ${width}px`);
    if (result.priorityTitle !== 'Atención requerida' || result.priorityCount !== '2') throw new Error(`La jerarquía de pendientes cambió a ${width}px`);
    if (!result.resolvedCardVisible) throw new Error('No se conservaron a la vista los mensajes recientes de Meta');
    if (result.shortcuts) throw new Error('El Inicio duplicó accesos del menú');
    if (width <= 390 && result.minInteractiveHeight < 40) throw new Error(`Hay controles demasiado pequeños a ${width}px`);
    if (pageErrors.length) throw new Error(`Error JavaScript en Inicio a ${width}px: ${pageErrors.join(' | ')}`);
    await page.screenshot({ path: path.join(output, `dashboard-operativo-${width}.png`), fullPage: true });
    await page.close();
  }

  const emptyPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const emptyErrors = [];
  emptyPage.on('pageerror', error => emptyErrors.push(String(error.message || error)));
  await emptyPage.goto(`${fixture}?scenario=empty`);
  await emptyPage.waitForSelector('.daily-home-next-empty');
  await emptyPage.waitForSelector('.daily-home-chats-note');
  const emptyResult = await emptyPage.evaluate(() => ({
    emptyTitle: document.querySelector('.daily-home-next-empty strong')?.textContent.trim(),
    operationalMetrics: document.querySelectorAll('.daily-home-kpi-section .daily-home-metric').length,
    chatError: document.querySelector('.daily-home-chats-note')?.textContent.includes('Mensajes no disponibles'),
    emptyHeight: document.querySelector('.daily-home-next-empty')?.getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  if (emptyResult.emptyTitle !== 'Tu agenda está libre por ahora') throw new Error('La agenda vacía perdió su estado compacto');
  if (emptyResult.operationalMetrics !== 4) throw new Error('El estado vacío ocultó indicadores de la jornada');
  if (!emptyResult.chatError) throw new Error('La falla de mensajes no se presenta como estado recuperable');
  if (emptyResult.emptyHeight > 150) throw new Error('La agenda vacía volvió a ocupar demasiado espacio');
  if (emptyResult.overflow || emptyErrors.length) throw new Error(`Problema en estado vacío: ${emptyErrors.join(' | ')}`);
  await emptyPage.screenshot({ path: path.join(output, 'dashboard-operativo-empty-1440.png'), fullPage: true });
  await emptyPage.close();

  await browser.close();
  console.log('QA visual completado: 1440, 1024, 820, 390, 320 px y estado vacío.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
