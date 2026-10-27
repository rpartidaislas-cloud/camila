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
      const interactive = visible('button:not(.dr-tooth)');
      const odontogram = visible('.cw-clinical-odontogram');
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        commandActions: commandButtons.length,
        stages: navigation.length,
        minButtonHeight: Math.min(...interactive.map(element => element.getBoundingClientRect().height).concat([44])),
        commandVisible: visible('.cw-command').length === 1,
        safetyVisible: visible('.cw-treatment-safety').length === 1,
        odontogramVisible: odontogram.length === 1,
        odontogramTeeth: odontogram[0]?.querySelectorAll('.dr-tooth').length || 0,
        odontogramFilters: visible('.cw-map-filter').length,
        evidenceHistory: visible('.cw-evidence-history').length,
        evidenceMetrics: visible('.cw-evidence-metrics > div').length,
        evidenceAssistant: visible('.cw-evidence-assistant').length,
        evidenceReviewStates: visible('.cw-evidence-review').length,
        evolution: visible('.cw-evolution').length,
        evolutionMetrics: visible('.cw-evolution-metrics > div').length,
        evolutionActions: visible('.cw-evolution-actions button').length
        ,sourceWorkspace: visible('.cw-source-workspace').length
        ,sourceStats: visible('.cw-source-stats > span').length
        ,advancedInitiallyHidden: visible('.cw-advanced-editor').length === 0
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
    await page.locator('[data-filter="photo"]').click();
    const photoMode = await page.evaluate(() => ({
      selected: document.querySelector('[data-filter="photo"]')?.getAttribute('aria-pressed'),
      title: document.querySelector('.cw-source-intro strong')?.textContent,
      actions: Array.from(document.querySelectorAll('.cw-source-actions button')).map(button => button.textContent.trim())
    }));
    report[report.length - 1].photoMode = photoMode;
    if (item.name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-photo.png'), fullPage: true });
    await page.locator('[data-filter="radiograph"]').click();
    await page.locator('.cw-source-actions .pc-primary').click();
    const radiographTask = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      return {
        open: document.querySelector('.cw-advanced-editor')?.open === true,
        title: document.querySelector('.cw-advanced-editor > summary strong')?.textContent,
        steps: visible('.cw-advanced-guide > span').length,
        visibleSections: visible('.cw-advanced-editor .dr-section').length,
        duplicateMaps: visible('.cw-advanced-editor .dr-map').length,
        uploadVisible: visible('.cw-advanced-editor input[type="file"]').length,
        controlHeight: Math.min(...visible('.cw-advanced-editor :is(button,input,select)').map(element => element.getBoundingClientRect().height).concat([44]))
      };
    });
    report[report.length - 1].radiographTask = radiographTask;
    if (item.name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-radiograph.png'), fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.horizontalOverflow || item.commandActions !== 0 || item.stages !== 3 || !item.commandVisible || !item.safetyVisible || !item.odontogramVisible || item.odontogramTeeth !== 32 || item.odontogramFilters !== 4 || item.evidenceHistory !== 1 || item.evidenceMetrics !== 3 || item.evidenceAssistant !== 1 || item.evidenceReviewStates !== 3 || item.evolution !== 1 || item.evolutionMetrics !== 4 || item.evolutionActions !== 3 || item.sourceWorkspace !== 1 || item.sourceStats !== 3 || !item.advancedInitiallyHidden || item.photoMode.selected !== 'true' || item.photoMode.title !== 'Archivo visual y revisión asistida' || !item.photoMode.actions.includes('Agregar fotografías') || item.minButtonHeight < item.requiredHeight || !item.radiographTask.open || item.radiographTask.title !== 'Agregar estudio radiográfico' || item.radiographTask.steps !== 3 || item.radiographTask.visibleSections !== 1 || item.radiographTask.duplicateMaps !== 0 || item.radiographTask.uploadVisible !== 1 || item.radiographTask.controlHeight < item.requiredHeight)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
