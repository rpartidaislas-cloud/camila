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
  const output = path.resolve(__dirname, '../artifacts/dashboard-workbench-v12');
  fs.mkdirSync(output, { recursive: true });

  for (const width of [1440, 820, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1 });
    await page.goto(fixture);
    await page.waitForSelector('[data-home-next] button');
    await page.waitForSelector('.daily-home-chat');
    const result = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      dashboardOverflow: document.querySelector('#smyl-daily-home').scrollWidth > document.querySelector('#smyl-daily-home').clientWidth + 1,
      zeroCards: [...document.querySelectorAll('[data-home-metrics] .daily-home-metric strong')].some(node => node.textContent.trim() === '0'),
      leakedPreview: document.querySelector('[data-home-chats]').textContent.includes('Conversación resuelta'),
      shortcuts: document.querySelectorAll('.daily-home-shortcuts').length,
    }));
    if (result.documentOverflow || result.dashboardOverflow) throw new Error(`Desbordamiento detectado a ${width}px`);
    if (result.zeroCards) throw new Error(`El Inicio muestra indicadores en cero a ${width}px`);
    if (result.leakedPreview) throw new Error('Se mostró una conversación que no requiere atención');
    if (result.shortcuts) throw new Error('El Inicio duplicó accesos del menú');
    await page.screenshot({ path: path.join(output, `dashboard-workbench-${width}.png`), fullPage: true });
    await page.close();
  }

  await browser.close();
  console.log('QA visual completado: 1440, 820 y 390 px.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
