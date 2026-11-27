const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  const candidates = [
    'playwright',
    path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error('No se encontró Playwright.');
}

(async () => {
  const { chromium } = loadPlaywright();
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = 'file:///' + path.resolve(__dirname, 'fixtures', 'smyl-finance-stage5-preview.html').replace(/\\/g, '/');
  const output = path.resolve(__dirname, '..', 'artifacts', 'finanzas-v5');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.goto(fixture, { waitUntil: 'load' });
      const result = await page.evaluate(() => {
        const root = document.documentElement;
        const tabbar = document.querySelector('.finance-tabs');
        const priorities = [...document.querySelectorAll('.finance-priority-list article')];
        return {
          bodyOverflow: root.scrollWidth - root.clientWidth,
          tabOverflow: tabbar ? tabbar.scrollWidth > tabbar.clientWidth : false,
          priorityWidths: priorities.map((item) => item.getBoundingClientRect().width),
          title: document.querySelector('.preview-topbar h1')?.textContent,
          flowCount: document.querySelectorAll('.finance-flow button').length
        };
      });
      assert.equal(result.title, 'Cobros y caja');
      assert.equal(result.flowCount, 4);
      assert.ok(result.bodyOverflow <= 1, `${label}: desborde horizontal de ${result.bodyOverflow}px`);
      assert.ok(result.priorityWidths.every((value) => value > 0), `${label}: prioridades sin ancho`);
      if (width <= 720) assert.equal(result.tabOverflow, true, `${label}: las pestañas deben desplazarse dentro de su propia fila`);
      await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('Finanzas v5: escritorio, tableta y PWA sin desborde horizontal.');
})().catch((error) => { console.error(error); process.exit(1); });
