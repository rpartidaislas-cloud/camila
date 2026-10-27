const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-history-v32-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'history-v32');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'read-desktop', width: 1280, height: 900, query: '' },
    { name: 'edit-desktop', width: 1280, height: 1000, query: '?mode=edit' },
    { name: 'read-mobile', width: 390, height: 844, query: '' },
    { name: 'edit-mobile', width: 390, height: 900, query: '?mode=edit' },
    { name: 'read-320', width: 320, height: 700, query: '' }
  ];
  const report = [];
  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    await page.goto(fixture + item.query);
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      primaryActions: Array.from(document.querySelectorAll('.btn-primary')).filter(element => element.getClientRects().length).length,
      minFieldHeight: Math.min(...Array.from(document.querySelectorAll('input,textarea')).filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect().height).concat([48]))
    }));
    report.push({ name: item.name, ...metrics, horizontalOverflow: metrics.scrollWidth > metrics.viewport + 1 });
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.horizontalOverflow || item.primaryActions !== 1 || item.minFieldHeight < 48)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
