const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function loadPlaywright() {
  const workspace = path.resolve(__dirname, '..', '..');
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    ...['promodesk-smyl-stage4', 'promodesk-smyl-meta-bridge', 'promodesk-chat-mobile', 'camila']
      .map((project) => path.join(workspace, project, 'node_modules', 'playwright')),
    path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node_modules', 'playwright')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('No se encontró Playwright en el workspace.');
}

const { chromium } = loadPlaywright();
const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'smyl-clinical-review-v33-preview.html');
const output = path.join(root, 'artifacts', 'clinical-review-v33');
const viewports = [
  { name: '1440', width: 1440, height: 960 },
  { name: '1024', width: 1024, height: 900 },
  { name: '390', width: 390, height: 844, mobile: true }
];

async function inspect(page, viewport) {
  return page.evaluate(({ mobile }) => {
    const visible = (element) => {
      if (!(element instanceof Element) || element.closest('[hidden]')) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
    };
    const selector = (element) => element.id ? `#${element.id}` : `${element.localName}.${Array.from(element.classList).slice(0, 2).join('.')}`;
    const textUnder12 = [];
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element)) continue;
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(' ');
      if (!ownText) continue;
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (size < 11.99) textUnder12.push({ selector: selector(element), size, text: ownText.slice(0, 64) });
    }

    const minimum = mobile ? 44 : 42;
    const smallTargets = [];
    const controls = document.querySelectorAll('button,input:not([type="hidden"]),textarea,select,summary,[role="button"]');
    for (const element of controls) {
      if (!visible(element)) continue;
      const box = element.getBoundingClientRect();
      const iconOnly = !element.textContent.trim() || element.hasAttribute('aria-label') && element.textContent.trim().length <= 2;
      if (box.height < minimum - .5 || (iconOnly && box.width < minimum - .5)) {
        smallTargets.push({ selector: selector(element), width: Math.round(box.width), height: Math.round(box.height) });
      }
    }

    const focusTarget = Array.from(document.querySelectorAll('button:not([disabled]),input,textarea,[role="button"]')).find(visible);
    let focusIssue = null;
    if (focusTarget) {
      focusTarget.focus();
      const style = getComputedStyle(focusTarget);
      if (Number.parseFloat(style.outlineWidth) < 2) focusIssue = { selector: selector(focusTarget), outlineWidth: style.outlineWidth };
    }

    const evidence = document.querySelector('.canvas-col2').getBoundingClientRect();
    const decision = document.querySelector('.panel-col2').getBoundingClientRect();
    const regionsOverlap = !(evidence.right <= decision.left + 1 || decision.right <= evidence.left + 1 || evidence.bottom <= decision.top + 1 || decision.bottom <= evidence.top + 1);
    const selectedTabs = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).map((tab) => tab.dataset.tab);
    const states = Array.from(document.querySelectorAll('[data-review-state]')).map((element) => element.dataset.reviewState);
    return {
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      textUnder12,
      smallTargets,
      focusIssue,
      regionsOverlap,
      selectedTabs,
      states,
      evidenceRole: document.querySelector('.canvas-col2').getAttribute('role'),
      decisionRole: document.querySelector('.panel-col2').getAttribute('role'),
      ready: document.documentElement.dataset.clinicalReviewReady
    };
  }, { mobile: Boolean(viewport.mobile) });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--allow-file-access-from-files']
  });
  const report = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: Boolean(viewport.mobile),
        deviceScaleFactor: 1
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error.message || error)));
      await page.goto(pathToFileURL(fixture).href, { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.dataset.clinicalReviewReady === 'true');
      const metrics = await inspect(page, viewport);
      await page.locator('[data-tab="color"]').focus();
      await page.keyboard.press('ArrowRight');
      const keyboardTab = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab');
      await page.screenshot({ path: path.join(output, `review-${viewport.name}.png`), fullPage: true });
      report.push({
        name: viewport.name,
        ...metrics,
        keyboardTab,
        horizontalOverflow: metrics.scrollWidth > metrics.viewportWidth + 1,
        errors
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(output, 'qa-report.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)}\n`);
  const failures = report.filter((item) =>
    item.horizontalOverflow || item.textUnder12.length || item.smallTargets.length || item.focusIssue ||
    item.regionsOverlap || item.errors.length || item.ready !== 'true' || item.evidenceRole !== 'region' ||
    item.decisionRole !== 'region' || item.selectedTabs.join('|') !== 'color' || item.keyboardTab !== 'forma' ||
    !['loading', 'empty', 'error'].every((state) => item.states.includes(state))
  );
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`QA revisión clínica v3.3 aprobado: ${report.length}/${report.length} vistas.`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
