const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-clinical-flow-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'treatment-v32');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 820, height: 1000 },
    { name: 'mobile', width: 390, height: 900 },
    { name: 'mobile-320', width: 320, height: 700 }
  ];
  const report = [];
  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    await page.goto(fixture);
    const metrics = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const commandButtons = visible('.cw-command .pc-primary');
      const navigation = visible('.cw-nav button');
      const interactive = visible('button');
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        commandActions: commandButtons.length,
        stages: navigation.length,
        minButtonHeight: Math.min(...interactive.map(element => element.getBoundingClientRect().height).concat([44])),
        commandVisible: visible('.cw-command').length === 1,
        safetyVisible: visible('.cw-treatment-safety').length === 1
      };
    });
    const requiredHeight = item.width <= 760 ? 44 : 42;
    report.push({
      name: item.name,
      ...metrics,
      horizontalOverflow: metrics.scrollWidth > metrics.viewport + 1,
      requiredHeight
    });
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.horizontalOverflow || item.commandActions !== 1 || item.stages !== 3 || !item.commandVisible || !item.safetyVisible || item.minButtonHeight < item.requiredHeight)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
