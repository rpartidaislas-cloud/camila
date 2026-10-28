const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-patient-summary-v44-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'patient-summary-v44');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop-1440', width: 1440, height: 1000 },
    { name: 'desktop-1024', width: 1024, height: 1000 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'mobile-390', width: 390, height: 900, touch: true },
    { name: 'mobile-320', width: 320, height: 760, touch: true },
    { name: 'zoom-200-equivalent', width: 600, height: 900, touch: true, zoomEquivalent: true }
  ];
  const report = [];
  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: Boolean(item.touch) });
    const page = await context.newPage();
    await page.goto(fixture);
    const metrics = await page.evaluate(({ enforceTargets }) => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const targets = visible('.p360-domain-card,.p360-timeline-row,.p360-timeline-filters button,.p360-priority-actions button,.p360-section-head button');
      const rects = targets.map(element => element.getBoundingClientRect());
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        primaryActions: visible('.btn-primary').length,
        areas: visible('.p360-domain-card').length,
        timelineRows: visible('.p360-timeline-row').length,
        filters: visible('.p360-timeline-filters button').length,
        minTargetHeight: Math.min(...rects.map(rect => rect.height).concat([44])),
        minTargetWidth: enforceTargets ? Math.min(...rects.map(rect => rect.width).concat([44])) : 44,
        recordMap: visible('.p360-record-map').length,
        overviewColumns: getComputedStyle(document.querySelector('.p360-overview-grid')).gridTemplateColumns
      };
    }, { enforceTargets: item.touch || item.zoomEquivalent });
    await page.locator('[data-filter="files"]').click();
    const filteredRows = await page.locator('.p360-timeline-row:visible').count();
    const pressedFilter = await page.locator('[data-filter="files"]').getAttribute('aria-pressed');
    const rowFocus = await page.locator('.p360-timeline-row:visible').first().evaluate(element => {
      element.focus();
      return document.activeElement === element;
    });
    const result = {
      name: item.name,
      ...metrics,
      filteredRows,
      pressedFilter,
      rowFocus,
      horizontalOverflow: metrics.scrollWidth > metrics.viewport + 1,
      targetThreshold: item.touch || item.zoomEquivalent ? 44 : 0
    };
    report.push(result);
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: true });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item =>
    item.horizontalOverflow ||
    item.primaryActions !== 1 ||
    item.areas !== 6 ||
    item.timelineRows !== 7 ||
    item.filters !== 7 ||
    item.recordMap !== 1 ||
    item.filteredRows !== 1 ||
    item.pressedFilter !== 'true' ||
    !item.rowFocus ||
    item.minTargetHeight < item.targetThreshold ||
    item.minTargetWidth < item.targetThreshold
  )) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
