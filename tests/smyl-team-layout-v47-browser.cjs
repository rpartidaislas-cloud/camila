const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-team-layout-v47-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'team-layout-v47');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop-1785', width: 1785, height: 980 },
    { name: 'desktop-1280', width: 1280, height: 980 },
    { name: 'tablet-820', width: 820, height: 1080 },
    { name: 'mobile-390', width: 390, height: 1000, touch: true }
  ];
  const report = [];
  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: Boolean(item.touch) });
    const page = await context.newPage();
    await page.goto(fixture);
    const metrics = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const people = box('.clinic-admin-people-card');
      const pending = box('.clinic-admin-pending-card');
      const memberBoxes = Array.from(document.querySelectorAll('.clinic-admin-member')).map(row => row.getBoundingClientRect());
      const selectsInsideRows = Array.from(document.querySelectorAll('.clinic-admin-member select')).every(select => {
        const rect = select.getBoundingClientRect();
        const row = select.closest('.clinic-admin-member').getBoundingClientRect();
        return rect.left >= row.left - 1 && rect.right <= row.right + 1;
      });
      const buttons = Array.from(document.querySelectorAll('button')).map(button => button.getBoundingClientRect());
      const intersects = !(people.right <= pending.left || pending.right <= people.left || people.bottom <= pending.top || pending.bottom <= people.top);
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        panelWidth: box('.clinic-admin-team-panel').width,
        peopleWidth: people.width,
        pendingWidth: pending.width,
        memberWidths: memberBoxes.map(rect => rect.width),
        selectsInsideRows,
        cardsOverlap: intersects,
        minButtonHeight: Math.min(...buttons.map(rect => rect.height))
      };
    });
    report.push({ name: item.name, ...metrics, horizontalOverflow: metrics.scrollWidth > metrics.viewport + 1 });
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: true });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.horizontalOverflow || item.cardsOverlap || !item.selectsInsideRows || item.minButtonHeight < 42)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
