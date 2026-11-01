const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

function loadPlaywright() {
  const workspace = path.resolve(__dirname, '..', '..');
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    ...['promodesk-smyl-stage4', 'promodesk-smyl-meta-bridge', 'promodesk-chat-mobile', 'promodesk-lana-logo-smyl', 'promodesk-pagos-ux-lana']
      .map((project) => path.join(workspace, project, 'node_modules', 'playwright')),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error('No se encontró Playwright en el workspace.');
}

const { chromium } = loadPlaywright();
const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'smyl-operations-v33-preview.html');
const output = path.join(root, 'artifacts', 'clinical-workspace-operations-v33');
const viewports = [
  { name: '1440', width: 1440, height: 960 },
  { name: '1024', width: 1024, height: 900 },
  { name: '390', width: 390, height: 844, mobile: true },
];
const surfaces = ['inventory', 'consumption'];

async function inspect(page, viewport) {
  return page.evaluate(({ mobile }) => {
    const visible = (element) => {
      if (!(element instanceof Element) || element.hidden || element.closest('[hidden],.qa-hidden')) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const selector = (element) => element.id ? `#${element.id}` : `${element.localName}.${Array.from(element.classList).slice(0, 2).join('.')}`;
    const textIssues = [];
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element)) continue;
      const ownText = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).join(' ');
      if (!ownText) continue;
      const px = Number.parseFloat(getComputedStyle(element).fontSize);
      const before = getComputedStyle(element, '::before').content;
      if (px < 12 && (!before || before === 'none' || before === 'normal')) textIssues.push({ selector: selector(element), px, text: ownText.slice(0, 50) });
    }
    const minimum = mobile ? 44 : 42;
    const targetIssues = [];
    for (const element of document.querySelectorAll('button,input,select,textarea,a[href]')) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width + .5 < minimum || rect.height + .5 < minimum) targetIssues.push({ selector: selector(element), width: Math.round(rect.width), height: Math.round(rect.height) });
    }
    const focusTarget = Array.from(document.querySelectorAll('button,input,select')).find(visible);
    let focusIssue = null;
    if (focusTarget) {
      focusTarget.focus();
      const style = getComputedStyle(focusTarget);
      if (parseFloat(style.outlineWidth) < 2) focusIssue = { selector: selector(focusTarget), outlineWidth: style.outlineWidth };
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      bodyOverflow: document.body.scrollWidth > innerWidth + 1,
      textIssues,
      targetIssues,
      focusIssue,
    };
  }, { mobile: Boolean(viewport.mobile) });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--allow-file-access-from-files'],
  });
  const report = [];
  try {
    for (const surface of surfaces) {
      for (const viewport of viewports) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const url = `${pathToFileURL(fixture).href}?surface=${surface}`;
        await page.goto(url, { waitUntil: 'load' });
        await page.screenshot({ path: path.join(output, `${surface}-${viewport.name}.png`), fullPage: true });
        const result = await inspect(page, viewport);
        report.push({ surface, size: viewport.name, ...result });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const failures = report.filter((item) => item.documentOverflow || item.bodyOverflow || item.textIssues.length || item.targetIssues.length || item.focusIssue);
  fs.writeFileSync(path.join(output, 'qa-report.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)}\n`);
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`QA v3.3 aprobado: ${report.length}/${report.length} vistas sin overflow, microtexto ni objetivos pequeños.`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
