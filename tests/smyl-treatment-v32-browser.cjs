const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Visual smoke test for the current clinical fixture.
 * The evaluation deliberately has three responsibilities:
 * Contexto -> Revisión profesional -> Conclusión.
 */
(async () => {
  const chrome = process.env.SMYL_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-clinical-flow-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'evaluation-separation-v79');
  fs.mkdirSync(output, { recursive: true });

  const cases = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 834, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 760 }
  ];
  const report = [];

  for (const viewport of cases) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(fixture);

    const inspect = async () => page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector))
        .filter(element => element.getClientRects().length > 0);
      // Tooth cells are intentionally compact; evaluate only ordinary actions.
      const buttons = visible('button:not(.dr-tooth)');
      return {
        activeTask: document.querySelector('[data-task-target][aria-current="step"] strong')?.textContent.trim(),
        visiblePanels: visible('.cw-evaluation-panel').length,
        visibleFiles: visible('.cw-clinical-files-source').length,
        visibleMaps: visible('.cw-clinical-map').length,
        progress: document.querySelector('.cw-evaluation-mobile-progress')?.textContent.trim(),
        taskTitles: Array.from(document.querySelectorAll('[data-task-target] strong')).map(node => node.textContent.trim()),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        minButtonHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height).concat([44]))
      };
    });

    const context = await inspect();
    await page.screenshot({ path: path.join(output, `${viewport.name}-context.png`), fullPage: true });

    await page.evaluate(() => showTask('findings'));
    const review = await inspect();
    await page.screenshot({ path: path.join(output, `${viewport.name}-review.png`), fullPage: true });

    await page.evaluate(() => showTask('closure'));
    const conclusion = await inspect();
    await page.screenshot({ path: path.join(output, `${viewport.name}-conclusion.png`), fullPage: true });

    report.push({ name: viewport.name, context, review, conclusion });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));

  const expectedTitles = JSON.stringify(['Contexto', 'Revisión profesional', 'Conclusión']);
  const failed = report.some(item => {
    const common = [item.context, item.review, item.conclusion];
    return common.some(state =>
      state.visiblePanels !== 1 ||
      state.overflow ||
      state.minButtonHeight < 40 ||
      JSON.stringify(state.taskTitles) !== expectedTitles
    ) ||
      item.context.activeTask !== 'Contexto' ||
      item.context.progress !== 'Paso 1 de 3 · Contexto' ||
      item.context.visibleFiles !== 0 ||
      item.context.visibleMaps !== 0 ||
      item.review.activeTask !== 'Revisión profesional' ||
      item.review.visibleFiles !== 1 ||
      item.review.visibleMaps !== 0 ||
      item.conclusion.activeTask !== 'Conclusión' ||
      item.conclusion.visibleFiles !== 0 ||
      item.conclusion.visibleMaps !== 1;
  });

  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
