const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-clinical-flow-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'treatment-simple-v41');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 820, height: 1000 },
    { name: 'mobile', width: 390, height: 900 },
    { name: 'mobile-320', width: 320, height: 700 }
  ];
  const report = [];
  const snapshot = async page => page.evaluate(() => {
    const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
    const buttons = visible('button:not(.dr-tooth)');
    const footer = document.querySelector('.cw-evaluation-footer');
    const panelBody = visible('.cw-evaluation-panel-body')[0];
    const stageStatus = document.querySelector('.cw-stage-status');
    const footerBox = footer?.getBoundingClientRect();
    const panelBox = panelBody?.getBoundingClientRect();
    const stageBox = stageStatus?.getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modules: document.querySelectorAll('.cw-workspace > .cw-module').length,
      moduleBodies: document.querySelectorAll('.cw-workspace > .cw-module > .cw-body').length,
      moduleTitles: Array.from(document.querySelectorAll('.cw-workspace > .cw-module > .cw-summary .cw-module-title > strong')).map(node => node.textContent.trim()),
      visibleModules: visible('.cw-workspace > .cw-module').length,
      openModules: visible('.cw-workspace > .cw-module[open]').length,
      stages: visible('.cw-nav button').length,
      tasks: visible('.cw-evaluation-task').length,
      visiblePanels: visible('.cw-evaluation-panel').length,
      visibleCtas: visible('.cw-evaluation-footer .pc-primary').length,
      activeTask: document.querySelector('.cw-evaluation-task[aria-current="step"] .cw-evaluation-task-copy strong')?.textContent.trim(),
      commandCount: document.querySelectorAll('.cw-command').length,
      stageStatus: document.querySelectorAll('.cw-stage-status').length,
      stageStatusVisuallyHidden: !!(stageBox && stageBox.width <= 1 && stageBox.height <= 1 && getComputedStyle(stageStatus).overflow === 'hidden'),
      summaryNumbers: document.querySelectorAll('.cw-summary > .cw-number').length,
      footerPosition: footer ? getComputedStyle(footer).position : '',
      footerOverlapsPanel: !!(footerBox && panelBox && footerBox.top < panelBox.bottom && footerBox.bottom > panelBox.top),
      minButtonHeight: Math.min(...buttons.map(element => element.getBoundingClientRect().height).concat([44])),
      safetyVisible: visible('.cw-treatment-safety').length === 1
    };
  });

  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    await page.goto(fixture);
    const requiredHeight = item.width <= 760 ? 44 : 42;
    const initial = await snapshot(page);
    await page.screenshot({ path: path.join(output, `${item.name}-context.png`), fullPage: true });

    await page.locator('[data-task-target="evidence"]').click();
    const evidence = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const footer = document.querySelector('.cw-evaluation-footer'), panelBody = visible('.cw-evaluation-panel-body')[0];
      const footerBox = footer?.getBoundingClientRect(), panelBox = panelBody?.getBoundingClientRect();
      return {
        panel: visible('[data-task-panel="evidence"]').length,
        visiblePanels: visible('.cw-evaluation-panel').length,
        visibleCtas: visible('.cw-evaluation-footer .pc-primary').length,
        metrics: visible('.cw-evidence-compact-metrics > span').length,
        items: visible('.cw-evidence-item').length,
        latest: document.querySelector('.cw-evidence-latest > div > span')?.textContent.trim(),
        previous: document.querySelector('.cw-evidence-previous')?.textContent.trim(),
        cta: document.querySelector('.cw-evaluation-cta')?.textContent.trim(),
        footerPosition: footer ? getComputedStyle(footer).position : '',
        footerOverlapsPanel: !!(footerBox && panelBox && footerBox.top < panelBox.bottom && footerBox.bottom > panelBox.top),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    await page.screenshot({ path: path.join(output, `${item.name}-evidence.png`), fullPage: true });

    await page.locator('[data-task-target="findings"]').click();
    const findings = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const odontogram = visible('.cw-clinical-odontogram');
      const footer = document.querySelector('.cw-evaluation-footer'), panelBody = visible('.cw-evaluation-panel-body')[0];
      const footerBox = footer?.getBoundingClientRect(), panelBox = panelBody?.getBoundingClientRect();
      return {
        panel: visible('[data-task-panel="findings"]').length,
        visiblePanels: visible('.cw-evaluation-panel').length,
        visibleCtas: visible('.cw-evaluation-footer .pc-primary').length,
        odontogram: odontogram.length,
        teeth: odontogram[0]?.querySelectorAll('.dr-tooth').length || 0,
        filters: visible('.cw-map-filter').length,
        sourceWorkspace: visible('.cw-source-workspace').length,
        sourceStats: visible('.cw-source-stats > span').length,
        advancedInitiallyHidden: visible('.cw-advanced-editor').length === 0,
        footerPosition: footer ? getComputedStyle(footer).position : '',
        footerOverlapsPanel: !!(footerBox && panelBox && footerBox.top < panelBox.bottom && footerBox.bottom > panelBox.top),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    await page.screenshot({ path: path.join(output, `${item.name}-findings.png`), fullPage: true });

    await page.locator('[data-filter="photo"]').click();
    const photoMode = await page.evaluate(() => ({
      selected: document.querySelector('[data-filter="photo"]')?.getAttribute('aria-pressed'),
      title: document.querySelector('.cw-source-intro strong')?.textContent,
      actions: Array.from(document.querySelectorAll('.cw-source-actions button')).map(button => button.textContent.trim())
    }));
    if (item.name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-photo.png'), fullPage: true });

    await page.locator('[data-filter="radiograph"]').click();
    await page.getByRole('button', { name: 'Agregar radiografía', exact: true }).click();
    const radiographTask = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      return {
        open: document.querySelector('.cw-advanced-editor')?.open === true,
        title: document.querySelector('.cw-advanced-editor > summary strong')?.textContent,
        steps: visible('.cw-advanced-guide > span').length,
        visibleSections: visible('.cw-advanced-editor .dr-section').length,
        duplicateMaps: visible('.cw-advanced-editor .dr-map').length,
        uploadVisible: visible('.cw-advanced-editor input[type="file"]').length,
        controlHeight: Math.min(...visible('.cw-advanced-editor :is(button,input,select)').map(element => element.getBoundingClientRect().height).concat([44])),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    if (item.name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-radiograph.png'), fullPage: true });

    await page.locator('[data-task-target="closure"]').click();
    const closure = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const footer = document.querySelector('.cw-evaluation-footer'), panelBody = visible('.cw-evaluation-panel-body')[0];
      const footerBox = footer?.getBoundingClientRect(), panelBox = panelBody?.getBoundingClientRect();
      return {
        panel: visible('[data-task-panel="closure"]').length,
        visiblePanels: visible('.cw-evaluation-panel').length,
        visibleCtas: visible('.cw-evaluation-footer .pc-primary').length,
        cta: document.querySelector('.cw-evaluation-cta')?.textContent.trim(),
        footerPosition: footer ? getComputedStyle(footer).position : '',
        footerOverlapsPanel: !!(footerBox && panelBox && footerBox.top < panelBox.bottom && footerBox.bottom > panelBox.top)
      };
    });

    await page.locator('[data-module-target="plan"]').click();
    await page.locator('#preview-treatment-draft').fill('Propuesta sin guardar');
    await page.evaluate(() => { window.__previewDraftNode = document.querySelector('#preview-treatment-draft'); });
    const proposal = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      return {
        visibleModules: visible('.cw-workspace > .cw-module').length,
        title: visible('.cw-workspace > .cw-module .cw-module-title > strong')[0]?.textContent.trim(),
        primaryCtas: visible('.cw-workspace > .cw-module .pc-primary').length,
        historyAction: visible('.cw-version-note button')[0]?.textContent.trim(),
        historyCopy: visible('.cw-version-note p')[0]?.textContent.trim()
      };
    });
    if (item.name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-proposal.png'), fullPage: true });
    await page.locator('[data-module-target="approval"]').click();
    const acceptance = await page.evaluate(() => ({
      visibleModules: Array.from(document.querySelectorAll('.cw-workspace > .cw-module')).filter(element => element.getClientRects().length).length,
      title: Array.from(document.querySelectorAll('.cw-workspace > .cw-module .cw-module-title > strong')).find(element => element.getClientRects().length)?.textContent.trim()
    }));
    await page.locator('[data-module-target="plan"]').click();
    const preservedDraft = await page.evaluate(() => ({
      sameNode: window.__previewDraftNode === document.querySelector('#preview-treatment-draft'),
      value: document.querySelector('#preview-treatment-draft')?.value,
      visibleModules: Array.from(document.querySelectorAll('.cw-workspace > .cw-module')).filter(element => element.getClientRects().length).length
    }));

    report.push({
      name: item.name,
      requiredHeight,
      initial: { ...initial, overflow: initial.scrollWidth > initial.viewport + 1 },
      evidence,
      findings,
      photoMode,
      radiographTask,
      closure,
      proposal,
      acceptance,
      preservedDraft
    });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  const titles = ['Evaluación', 'Propuesta', 'Aceptación', 'Seguimiento e historial'];
  const failed = report.some(item =>
    item.initial.overflow || item.initial.modules !== 4 || item.initial.moduleBodies !== 4 ||
    JSON.stringify(item.initial.moduleTitles) !== JSON.stringify(titles) || item.initial.visibleModules !== 1 || item.initial.openModules !== 1 ||
    item.initial.stages !== 4 || item.initial.tasks !== 4 || item.initial.visiblePanels !== 1 ||
    item.initial.visibleCtas !== 1 || item.initial.activeTask !== 'Contexto' ||
    item.initial.commandCount !== 0 || item.initial.stageStatus !== 1 || !item.initial.stageStatusVisuallyHidden ||
    item.initial.summaryNumbers !== 0 || item.initial.footerPosition !== 'static' || item.initial.footerOverlapsPanel ||
    item.initial.minButtonHeight < item.requiredHeight || !item.initial.safetyVisible ||
    item.evidence.panel !== 1 || item.evidence.visiblePanels !== 1 || item.evidence.visibleCtas !== 1 ||
    item.evidence.metrics !== 3 || item.evidence.items !== 1 || item.evidence.latest !== 'REGISTRO MÁS RECIENTE' ||
    item.evidence.previous !== 'Ver 4 anteriores' || item.evidence.cta !== 'Continuar a hallazgos' ||
    item.evidence.footerPosition !== 'static' || item.evidence.footerOverlapsPanel || item.evidence.overflow ||
    item.findings.panel !== 1 || item.findings.visiblePanels !== 1 || item.findings.visibleCtas !== 1 ||
    item.findings.odontogram !== 1 || item.findings.teeth !== 32 || item.findings.filters !== 4 ||
    item.findings.sourceWorkspace !== 1 || item.findings.sourceStats !== 3 || !item.findings.advancedInitiallyHidden ||
    item.findings.footerPosition !== 'static' || item.findings.footerOverlapsPanel || item.findings.overflow ||
    item.photoMode.selected !== 'true' || item.photoMode.title !== 'Archivo visual y revisión asistida' ||
    !item.photoMode.actions.includes('Agregar fotografías') || !item.radiographTask.open ||
    item.radiographTask.title !== 'Agregar estudio radiográfico' || item.radiographTask.steps !== 3 ||
    item.radiographTask.visibleSections !== 1 || item.radiographTask.duplicateMaps !== 0 ||
    item.radiographTask.uploadVisible !== 1 || item.radiographTask.controlHeight < item.requiredHeight || item.radiographTask.overflow ||
    item.closure.panel !== 1 || item.closure.visiblePanels !== 1 || item.closure.visibleCtas !== 1 ||
    item.closure.cta !== 'Continuar a propuesta' || item.closure.footerPosition !== 'static' || item.closure.footerOverlapsPanel ||
    item.proposal.visibleModules !== 1 || item.proposal.title !== 'Propuesta' || item.proposal.primaryCtas !== 1 ||
    item.proposal.historyAction !== 'Ver historial' || !item.proposal.historyCopy.includes('no se reemplaza') ||
    item.acceptance.visibleModules !== 1 || item.acceptance.title !== 'Aceptación' ||
    !item.preservedDraft.sameNode || item.preservedDraft.value !== 'Propuesta sin guardar' || item.preservedDraft.visibleModules !== 1
  );
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
