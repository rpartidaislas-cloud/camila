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
    ['mobile-360', 360, 800],
    ['mobile-320', 320, 568]
  ];
  const report = [];
  for (const [name, width, height] of cases) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(fixture);
    await page.click('.sec-primary');
    await page.waitForTimeout(240);
    const snapshot = await page.evaluate(() => {
      const dialog = document.querySelector('.sec-dialog');
      const dialogRect = dialog?.getBoundingClientRect();
      const isSheet = innerWidth <= 820;
      const interactive = [...dialog.querySelectorAll('button,input')].filter(node => node.getClientRects().length);
      const shortTargets = interactive.filter(node => node.getBoundingClientRect().height < (isSheet ? 44 : 34));
      return {
        categories: document.querySelectorAll('.sec-category').length,
        unavailableCategories: document.querySelectorAll('.sec-category[aria-disabled="true"]').length,
        studies: document.querySelectorAll('.sec-study').length,
        dialogOpen: dialog?.open === true,
        labelled: dialog?.getAttribute('aria-labelledby') === 'sec-dialog-title' && !!document.getElementById('sec-dialog-title'),
        focusInside: !!dialog?.contains(document.activeElement),
        centered: isSheet || (Math.abs((dialogRect.left + dialogRect.right) / 2 - innerWidth / 2) <= 3
          && Math.abs((dialogRect.top + dialogRect.bottom) / 2 - innerHeight / 2) <= 6
          && dialogRect.left >= 16 && innerWidth - dialogRect.right >= 16),
        sheetAnchored: !isSheet || (Math.abs(dialogRect.left) <= 1
          && Math.abs(innerWidth - dialogRect.right) <= 1
          && Math.abs(innerHeight - dialogRect.bottom) <= 1),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        shortTargets: shortTargets.map(node => node.className || node.type)
      };
    });
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await page.getByRole('button', { name: 'Tomar fotografías' }).click();
    const photoVisuals = await page.evaluate(() => {
      const visuals = [...document.querySelectorAll('.sec-type-visual')].filter(node => node.getClientRects().length);
      return {
        count: visuals.length,
        distinct: new Set(visuals.map(node => node.dataset.visual)).size,
        allDecorative: visuals.every(node => node.getAttribute('aria-hidden') === 'true')
      };
    });
    await page.screenshot({ path: path.join(output, `${name}-photo-types.png`) });
    await page.click('.sec-selected-category-change .sec-text-action');
    await page.getByRole('button', { name: 'Subir radiografía' }).click();
    const xrayVisuals = await page.evaluate(() => {
      const visuals = [...document.querySelectorAll('.sec-type-visual')].filter(node => node.getClientRects().length);
      const grid = document.querySelector('.sec-type-grid');
      return {
        visible: visuals.map(node => node.dataset.visual),
        distinct: new Set(visuals.map(node => node.dataset.visual)).size,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
      };
    });
    if (name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-xray-types.png') });
    await page.click('.sec-selected-category-change .sec-text-action');
    await page.getByRole('button', { name: 'Agregar documento' }).click();
    const documentVisuals = await page.evaluate(() => {
      const visuals = [...document.querySelectorAll('.sec-type-visual')].filter(node => node.getClientRects().length);
      return {
        distinct: new Set(visuals.map(node => node.dataset.visual)).size,
        groups: [...document.querySelectorAll('.sec-type-group h3')].map(node => node.textContent.trim())
      };
    });
    if (name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-document-types.png') });
    await page.click('.sec-selected-category-change .sec-text-action');
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
          .filter(node => node.type !== 'file' && node.getBoundingClientRect().height < (innerWidth <= 820 ? 44 : 34))
          .map(node => node.className || node.type)
      };
    });
    await page.screenshot({ path: path.join(output, `${name}-details.png`) });
    await page.keyboard.press('Escape');
    const closeState = await page.evaluate(() => ({
      closed: !document.querySelector('.sec-dialog')?.open,
      focusReturned: document.activeElement?.classList.contains('sec-primary') === true
    }));
    report.push({ name, ...snapshot, photoVisuals, xrayVisuals, documentVisuals, details, closeState });
    await page.close();
  }
  await browser.close();
  const failures = report.filter(item => item.categories !== 6
    || item.unavailableCategories !== 3
    || item.studies !== 4
    || !item.dialogOpen
    || !item.labelled
    || !item.focusInside
    || !item.centered
    || !item.sheetAnchored
    || item.overflow
    || item.shortTargets.length
    || item.photoVisuals.count < 9
    || item.photoVisuals.distinct < 9
    || !item.photoVisuals.allDecorative
    || item.xrayVisuals.visible.length < 3
    || item.xrayVisuals.distinct < 3
    || item.xrayVisuals.columns !== (item.name === 'desktop' ? 3 : item.name === 'tablet' ? 2 : 1)
    || item.documentVisuals.distinct < 7
    || !item.documentVisuals.groups.includes('Informes clínicos')
    || !item.documentVisuals.groups.includes('Coordinación y laboratorio')
    || !item.documentVisuals.groups.includes('Consentimientos y otros')
    || item.details.progressBars !== 2
    || !item.details.hasPreview
    || !item.details.hasStructuredRegion
    || !item.details.hasCameraAction
    || !item.details.hasFileAction
    || item.details.overflow
    || item.details.shortTargets.length
    || !item.closeState.closed
    || !item.closeState.focusReturned);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
