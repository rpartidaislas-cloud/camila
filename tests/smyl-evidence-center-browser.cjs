const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-evidence-center-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'evidence-center-v1');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    ['desktop', 1280, 900],
    ['tablet', 820, 1000],
    ['mobile', 390, 844],
    ['mobile-320', 320, 700]
  ];
  const report = [];
  for (const [name, width, height] of cases) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(fixture);
    await page.click('.sec-primary');
    const snapshot = await page.evaluate(() => {
      const dialog = document.querySelector('.sec-dialog');
      const interactive = [...document.querySelectorAll('button,input')].filter(node => node.getClientRects().length);
      const shortTargets = interactive.filter(node => node.getBoundingClientRect().height < (innerWidth <= 760 ? 40 : 34));
      return {
        categories: document.querySelectorAll('.sec-category').length,
        unavailableCategories: document.querySelectorAll('.sec-category[aria-disabled="true"]').length,
        studies: document.querySelectorAll('.sec-study').length,
        dialogOpen: dialog?.open === true,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        shortTargets: shortTargets.map(node => node.className || node.type)
      };
    });
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Tomar fotografías' }).click();
    await page.getByRole('button', { name: 'Frontal sonriendo' }).click();
    const details = await page.evaluate(() => {
      const visibleControls = [...document.querySelectorAll('.sec-dialog button,.sec-dialog input,.sec-dialog select')]
        .filter(node => node.getClientRects().length);
      return {
        progressBars: document.querySelectorAll('.sec-progress i').length,
        hasPreview: !!document.querySelector('.sec-file-preview'),
        hasStructuredRegion: !!document.querySelector('select[name="regionPreset"]'),
        hasCameraAction: visibleControls.some(node => node.textContent?.trim() === 'Tomar foto'),
        hasFileAction: visibleControls.some(node => node.textContent?.trim() === 'Elegir archivo'),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        shortTargets: visibleControls
          .filter(node => node.type !== 'file' && node.getBoundingClientRect().height < (innerWidth <= 820 ? 40 : 34))
          .map(node => node.className || node.type)
      };
    });
    await page.screenshot({ path: path.join(output, `${name}-details.png`), fullPage: true });
    report.push({ name, ...snapshot, details });
    await page.close();
  }
  await browser.close();
  const failures = report.filter(item => item.categories !== 6
    || item.unavailableCategories !== 3
    || item.studies !== 4
    || !item.dialogOpen
    || item.overflow
    || item.shortTargets.length
    || item.details.progressBars !== 2
    || !item.details.hasPreview
    || !item.details.hasStructuredRegion
    || !item.details.hasCameraAction
    || !item.details.hasFileAction
    || item.details.overflow
    || item.details.shortTargets.length);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
