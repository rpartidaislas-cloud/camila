const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-clinical-flow-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'odontogram-phase1-v44');
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
    const panels = document.querySelector('.cw-evaluation-panels');
    const stageStatus = document.querySelector('.cw-stage-status');
    const footerBox = footer?.getBoundingClientRect();
    const panelBox = panelBody?.getBoundingClientRect();
    const contentBox = panels?.getBoundingClientRect();
    const stageBox = stageStatus?.getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modules: document.querySelectorAll('.cw-workspace > .cw-module').length,
      moduleBodies: document.querySelectorAll('.cw-workspace > .cw-module > .cw-body').length,
      moduleTitles: Array.from(document.querySelectorAll('.cw-workspace > .cw-module > .cw-summary .cw-module-title > strong')).map(node => node.textContent.trim()),
      visibleModules: visible('.cw-workspace > .cw-module').length,
      openModules: visible('.cw-workspace > .cw-module[data-active="true"]').length,
      stages: visible('.cw-nav button').length,
      tasks: visible('.cw-evaluation-task').length,
      visiblePanels: visible('.cw-evaluation-panel').length,
      visibleCtas: visible('.cw-evaluation-footer .pc-primary').length,
      cta: document.querySelector('.cw-evaluation-cta')?.textContent.trim(),
      activeTask: document.querySelector('.cw-evaluation-task[aria-current="step"] .cw-evaluation-task-copy strong')?.textContent.trim(),
      commandCount: document.querySelectorAll('.cw-command').length,
      stageStatus: document.querySelectorAll('.cw-stage-status').length,
      stageStatusText: stageStatus?.textContent.trim(),
      stageStatusVisuallyHidden: !!(stageBox && stageBox.width <= 1 && stageBox.height <= 1 && getComputedStyle(stageStatus).overflow === 'hidden'),
      summaryNumbers: document.querySelectorAll('.cw-summary > .cw-number').length,
      footerPosition: footer ? getComputedStyle(footer).position : '',
      footerOverlapsPanel: !!(footerBox && panelBox && footerBox.top < panelBox.bottom && footerBox.bottom > panelBox.top),
      footerCoversContent: !!(footerBox && contentBox && footerBox.top < contentBox.bottom && footerBox.bottom > contentBox.top),
      minButtonHeight: Math.min(...buttons.map(element => element.getBoundingClientRect().height).concat([44])),
      contextSummary: visible('.cw-context-summary').length,
      contextAlerts: visible('.cw-context-alert').length,
      contextMetrics: visible('.cw-context-grid > div').length,
      adminDisclosure: visible('.cw-context-admin').length,
      legacyContactCards: visible('.clinic-layout.cw-layout > .clinic-patient-card').length,
      mobileProgress: visible('.cw-evaluation-mobile-progress').length,
      mobileProgressText: document.querySelector('.cw-evaluation-mobile-progress')?.textContent.trim()
    };
  });

  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    await page.goto(fixture);
    const requiredHeight = item.width <= 760 ? 44 : 42;
    const initial = await snapshot(page);
    await page.screenshot({ path: path.join(output, `${item.name}-context.png`), fullPage: true });

    await page.locator('[data-open-history]').click();
    const drawer = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      return {
        visible: visible('.cw-history-drawer').length,
        modal: document.querySelector('.cw-history-drawer')?.matches(':modal') || false,
        position: getComputedStyle(document.querySelector('.cw-history-drawer')).position,
        title: document.querySelector('.cw-history-drawer h3')?.textContent.trim(),
        alerts: visible('.cw-history-drawer-group:first-of-type article').length,
        actions: visible('.cw-history-drawer>footer button').map(button => button.textContent.trim()),
        minButtonHeight: Math.min(...visible('.cw-history-drawer button').map(button => button.getBoundingClientRect().height)),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    if (item.name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-context-drawer.png'), fullPage: true });
    await page.locator('[data-close-history]').click();

    await page.evaluate(() => showTask('evidence'));
    const evidence = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const footer = document.querySelector('.cw-evaluation-footer'), panelBody = visible('.cw-evaluation-panel-body')[0], panels = document.querySelector('.cw-evaluation-panels');
      const footerBox = footer?.getBoundingClientRect(), panelBox = panelBody?.getBoundingClientRect();
      const contentBox = panels?.getBoundingClientRect();
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
        footerCoversContent: !!(footerBox && contentBox && footerBox.top < contentBox.bottom && footerBox.bottom > contentBox.top),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    await page.screenshot({ path: path.join(output, `${item.name}-evidence.png`), fullPage: true });

    await page.evaluate(() => showTask('findings'));
    const findings = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const odontogram = visible('.cw-clinical-odontogram');
      const mapStage = visible('.cw-map-stage')[0];
      const mapLayout = visible('.cw-clinical-map-layout')[0];
      const mapContext = visible('.cw-map-context')[0];
      const inspector = visible('.cw-map-inspector')[0];
      const selected = odontogram[0]?.querySelector('.dr-tooth.cw-map-selected');
      const footer = document.querySelector('.cw-evaluation-footer'), panelBody = visible('.cw-evaluation-panel-body')[0], panels = document.querySelector('.cw-evaluation-panels');
      const footerBox = footer?.getBoundingClientRect(), panelBox = panelBody?.getBoundingClientRect();
      const contentBox = panels?.getBoundingClientRect();
      const stageBox = mapStage?.getBoundingClientRect();
      const nestedSelectors = ['.cw-evaluation-flow', '.cw-evaluation-panels', '.cw-evaluation-panel-body', '.cw-clinical-map', '.cw-clinical-map-layout'];
      const nestedOverflow = nestedSelectors.filter(selector => {
        const element = visible(selector)[0];
        if (!element) return false;
        const overflow = getComputedStyle(element).overflowY;
        return (overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight + 1;
      });
      return {
        panel: visible('[data-task-panel="findings"]').length,
        visiblePanels: visible('.cw-evaluation-panel').length,
        visibleCtas: visible('.cw-evaluation-footer .pc-primary').length,
        visiblePrimaryCtas: visible('.cw-workspace > .cw-module:not([hidden]) .pc-primary').length,
        cta: document.querySelector('.cw-evaluation-cta')?.textContent.trim(),
        odontogram: odontogram.length,
        teeth: odontogram[0]?.querySelectorAll('.dr-tooth').length || 0,
        filters: visible('.cw-map-filter').length,
        filterLabels: visible('.cw-map-filter').map(button => button.childNodes[0]?.textContent.trim()),
        filterCounts: visible('.cw-map-filter-count').map(node => Number(node.textContent.trim())),
        legacySourceWorkspace: visible('.cw-source-workspace').length,
        mapWidth: stageBox?.width || 0,
        mapInFirstViewport: !!(stageBox && stageBox.top < innerHeight && stageBox.bottom > 0),
        mapBeforeContext: !!(mapLayout && mapContext && (mapLayout.compareDocumentPosition(mapContext) & Node.DOCUMENT_POSITION_FOLLOWING)),
        inspector: inspector ? 1 : 0,
        inspectorTitle: inspector?.querySelector('strong')?.textContent.trim(),
        inspectorFacts: inspector?.querySelectorAll('.cw-map-inspector-fact').length || 0,
        inspectorEdit: inspector?.querySelector('.cw-map-edit')?.textContent.trim(),
        selectedTooth: selected?.dataset.tooth,
        selectedPressed: selected?.getAttribute('aria-pressed'),
        contextActions: mapContext?.querySelectorAll('button').length || 0,
        contextZeroCards: visible('.cw-map-context-chip').filter(node => Number(node.dataset.value) === 0).length,
        nestedOverflow,
        advancedInitiallyHidden: visible('.cw-advanced-editor').length === 0,
        footerPosition: footer ? getComputedStyle(footer).position : '',
        footerOverlapsPanel: !!(footerBox && panelBox && footerBox.top < panelBox.bottom && footerBox.bottom > panelBox.top),
        footerCoversContent: !!(footerBox && contentBox && footerBox.top < contentBox.bottom && footerBox.bottom > contentBox.top),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    await page.screenshot({ path: path.join(output, `${item.name}-findings.png`), fullPage: true });

    const panels = page.locator('.cw-evaluation-panels');
    await page.evaluate(() => window.scrollTo(0, 0));
    await panels.hover();
    const before = await page.evaluate(() => document.scrollingElement.scrollTop);
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(120);
    const naturalScroll = await page.evaluate(beforeScroll => {
      const root = document.scrollingElement;
      const footer = document.querySelector('.cw-evaluation-footer');
      const last = document.querySelector('.cw-evaluation-panel:not([hidden]) .cw-evaluation-panel-body > :last-child');
      const footerBox = footer?.getBoundingClientRect(), lastBox = last?.getBoundingClientRect();
      return {
        before: beforeScroll,
        after: root.scrollTop,
        maxScroll: root.scrollHeight - root.clientHeight,
        pageCanScroll: root.scrollHeight > root.clientHeight + 1,
        pageMoved: root.scrollTop > beforeScroll,
        panelsOverflowY: getComputedStyle(document.querySelector('.cw-evaluation-panels')).overflowY,
        flowOverflowY: getComputedStyle(document.querySelector('.cw-evaluation-flow')).overflowY,
        lastContentClear: innerWidth > 760 || !!(footerBox && lastBox && lastBox.bottom <= footerBox.top + 1)
      };
    }, before);

    await page.locator('.dr-tooth[data-tooth="16"]').click();
    const selectedPiece = await page.evaluate(() => ({
      selected: document.querySelector('.dr-tooth.cw-map-selected')?.dataset.tooth,
      pressed: document.querySelector('.dr-tooth.cw-map-selected')?.getAttribute('aria-pressed'),
      title: document.querySelector('.cw-map-inspector > strong')?.textContent.trim(),
      inspectorVisible: !!document.querySelector('.cw-map-inspector')?.getClientRects().length
    }));
    const layerSnapshot = () => page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const active = document.querySelector('.cw-map-filter[aria-pressed="true"]');
      return {
        active: active?.dataset.filter,
        title: document.querySelector('.cw-map-context-copy strong')?.textContent.trim(),
        cta: document.querySelector('.cw-evaluation-cta')?.textContent.trim(),
        visiblePrimaryCtas: visible('.cw-workspace > .cw-module:not([hidden]) .pc-primary').length,
        chips: visible('.cw-map-context-chip').length,
        zeroChips: visible('.cw-map-context-chip').filter(node => Number(node.dataset.value) === 0).length,
        contextActions: document.querySelector('.cw-map-context')?.querySelectorAll('button').length || 0
      };
    });

    await page.locator('[data-filter="manual"]').click();
    const manualMode = await layerSnapshot();
    await page.locator('[data-filter="photo"]').click();
    const photoMode = await layerSnapshot();
    if (item.name === 'desktop') await page.screenshot({ path: path.join(output, 'desktop-photo.png'), fullPage: true });
    await page.locator('[data-filter="pending"]').click();
    const pendingMode = await layerSnapshot();
    await page.locator('[data-filter="radiograph"]').click();
    const radiographMode = await layerSnapshot();
    await page.locator('.cw-evaluation-cta').click();
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

    await page.evaluate(() => showTask('closure'));
    const closure = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const footer = document.querySelector('.cw-evaluation-footer'), panelBody = visible('.cw-evaluation-panel-body')[0], panels = document.querySelector('.cw-evaluation-panels');
      const footerBox = footer?.getBoundingClientRect(), panelBox = panelBody?.getBoundingClientRect();
      const contentBox = panels?.getBoundingClientRect();
      return {
        panel: visible('[data-task-panel="closure"]').length,
        visiblePanels: visible('.cw-evaluation-panel').length,
        visibleCtas: visible('.cw-evaluation-footer .pc-primary').length,
        cta: document.querySelector('.cw-evaluation-cta')?.textContent.trim(),
        footerPosition: footer ? getComputedStyle(footer).position : '',
        footerOverlapsPanel: !!(footerBox && panelBox && footerBox.top < panelBox.bottom && footerBox.bottom > panelBox.top),
        footerCoversContent: !!(footerBox && contentBox && footerBox.top < contentBox.bottom && footerBox.bottom > contentBox.top)
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
      drawer,
      evidence,
      findings,
      naturalScroll,
      selectedPiece,
      manualMode,
      photoMode,
      pendingMode,
      radiographMode,
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
    item.initial.stages !== 4 || item.initial.tasks !== (item.name === 'mobile' || item.name === 'mobile-320' ? 0 : 4) || item.initial.visiblePanels !== 1 ||
    item.initial.visibleCtas !== 1 || item.initial.cta !== 'Revisado y continuar' || item.initial.activeTask !== 'Contexto' ||
    item.initial.commandCount !== 0 || item.initial.stageStatus !== 1 || item.initial.stageStatusVisuallyHidden ||
    item.initial.stageStatusText !== 'Siguiente acción · Completa la evaluación.' ||
    item.initial.summaryNumbers !== 0 || item.initial.footerPosition !== (item.requiredHeight === 44 ? 'static' : 'sticky') || item.initial.footerCoversContent ||
    item.initial.minButtonHeight < item.requiredHeight || item.initial.contextSummary !== 1 || item.initial.contextAlerts !== 2 ||
    item.initial.contextMetrics !== 3 || item.initial.adminDisclosure !== 1 || item.initial.legacyContactCards !== 0 ||
    item.initial.mobileProgress !== (item.name === 'mobile' || item.name === 'mobile-320' ? 1 : 0) ||
    item.initial.mobileProgressText !== 'Paso 1 de 4 · Contexto' ||
    item.drawer.visible !== 1 || !item.drawer.modal || item.drawer.position !== 'fixed' || item.drawer.title !== 'Historia para esta evaluación' || item.drawer.alerts !== 2 ||
    item.drawer.actions.join('|') !== 'Abrir historia completa|Marcar como revisado' || item.drawer.minButtonHeight < item.requiredHeight || item.drawer.overflow ||
    item.evidence.panel !== 1 || item.evidence.visiblePanels !== 1 || item.evidence.visibleCtas !== 1 ||
    item.evidence.metrics !== 3 || item.evidence.items !== 1 || item.evidence.latest !== 'REGISTRO MÁS RECIENTE' ||
    item.evidence.previous !== 'Ver 4 anteriores' || item.evidence.cta !== 'Continuar a hallazgos' ||
    item.evidence.footerPosition !== (item.requiredHeight === 44 ? 'static' : 'sticky') || item.evidence.footerCoversContent || item.evidence.overflow ||
    item.findings.panel !== 1 || item.findings.visiblePanels !== 1 || item.findings.visibleCtas !== 1 || item.findings.visiblePrimaryCtas !== 1 ||
    item.findings.cta !== 'Revisar hallazgos' || item.findings.odontogram !== 1 || item.findings.teeth !== 32 || item.findings.filters !== 5 ||
    item.findings.filterLabels.join('|') !== 'Todo|Clínica|Fotografías|Rayos X|Pendientes' || item.findings.filterCounts.join('|') !== '4|2|1|1|2' ||
    item.findings.legacySourceWorkspace !== 0 || !item.findings.mapInFirstViewport || !item.findings.mapBeforeContext ||
    ((item.name === 'desktop' || item.name === 'tablet') && item.findings.mapWidth < 440) ||
    item.findings.inspector !== 1 || item.findings.inspectorTitle !== 'Pieza 11 · Incisivo central superior derecho' ||
    item.findings.inspectorFacts !== 2 || item.findings.inspectorEdit !== 'Editar pieza' || item.findings.selectedTooth !== '11' || item.findings.selectedPressed !== 'true' ||
    item.findings.contextActions !== 0 || item.findings.contextZeroCards !== 0 || item.findings.nestedOverflow.length !== 0 || !item.findings.advancedInitiallyHidden ||
    item.findings.footerPosition !== 'static' || item.findings.footerCoversContent || item.findings.overflow ||
    (item.naturalScroll.pageCanScroll && !item.naturalScroll.pageMoved && item.naturalScroll.before < item.naturalScroll.maxScroll - 1) || !item.naturalScroll.lastContentClear ||
    item.naturalScroll.panelsOverflowY !== 'visible' || item.naturalScroll.flowOverflowY !== 'visible' ||
    item.selectedPiece.selected !== '16' || item.selectedPiece.pressed !== 'true' || item.selectedPiece.title !== 'Pieza 16 · Primer molar superior derecho' || !item.selectedPiece.inspectorVisible ||
    item.manualMode.active !== 'manual' || item.manualMode.title !== 'Valoración profesional' || item.manualMode.cta !== 'Editar pieza seleccionada' ||
    /radiograf|rayos/i.test(item.manualMode.cta) || item.manualMode.visiblePrimaryCtas !== 1 || item.manualMode.zeroChips !== 0 || item.manualMode.contextActions !== 0 ||
    item.photoMode.active !== 'photo' || item.photoMode.title !== 'Fotografías clínicas' || item.photoMode.cta !== 'Agregar fotografías' ||
    item.photoMode.visiblePrimaryCtas !== 1 || item.photoMode.zeroChips !== 0 || item.photoMode.contextActions !== 0 ||
    item.pendingMode.active !== 'pending' || item.pendingMode.title !== 'Pendientes de revisión' || item.pendingMode.cta !== 'Revisar pendientes' ||
    item.pendingMode.visiblePrimaryCtas !== 1 || item.pendingMode.zeroChips !== 0 || item.pendingMode.contextActions !== 0 ||
    item.radiographMode.active !== 'radiograph' || item.radiographMode.title !== 'Estudios radiográficos' || item.radiographMode.cta !== 'Agregar radiografía' ||
    item.radiographMode.visiblePrimaryCtas !== 1 || item.radiographMode.zeroChips !== 0 || item.radiographMode.contextActions !== 0 || !item.radiographTask.open ||
    item.radiographTask.title !== 'Agregar estudio radiográfico' || item.radiographTask.steps !== 3 ||
    item.radiographTask.visibleSections !== 1 || item.radiographTask.duplicateMaps !== 0 ||
    item.radiographTask.uploadVisible !== 1 || item.radiographTask.controlHeight < item.requiredHeight || item.radiographTask.overflow ||
    item.closure.panel !== 1 || item.closure.visiblePanels !== 1 || item.closure.visibleCtas !== 1 ||
    item.closure.cta !== 'Continuar a propuesta' || item.closure.footerPosition !== (item.requiredHeight === 44 ? 'static' : 'sticky') || item.closure.footerCoversContent ||
    item.proposal.visibleModules !== 1 || item.proposal.title !== 'Propuesta' || item.proposal.primaryCtas !== 1 ||
    item.proposal.historyAction !== 'Ver historial' || !item.proposal.historyCopy.includes('no se reemplaza') ||
    item.acceptance.visibleModules !== 1 || item.acceptance.title !== 'Aceptación' ||
    !item.preservedDraft.sameNode || item.preservedDraft.value !== 'Propuesta sin guardar' || item.preservedDraft.visibleModules !== 1
  );
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
