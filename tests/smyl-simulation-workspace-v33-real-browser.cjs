const { pathToFileURL } = require('node:url');
const path = require('node:path');

function loadPlaywright() {
  const workspace = path.resolve(__dirname, '..', '..');
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(workspace, 'promodesk-smyl-stage4', 'node_modules', 'playwright')].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error('No se encontró Playwright en el workspace.');
}

const { chromium } = loadPlaywright();
const root = path.resolve(__dirname, '..');
const pages = ['simulacion.html', 'simulacion-rapida.html'];
const surfaces = ['s-intro', 's-vita', 's-proc', 's-res', 's-editor'];
const viewports = [{ name: '1440', width: 1440, height: 960 }, { name: '390', width: 390, height: 844, mobile: true }];

async function inspect(page, target, mobile) {
  return page.evaluate(({ target, mobile }) => {
    document.querySelectorAll('.screen,.ed-screen').forEach((element) => element.classList.remove('active'));
    document.querySelectorAll('[role="alertdialog"],#dentist-login-overlay,#resume-overlay,#install-banner,.install-banner,.ios-install').forEach((element) => { element.style.setProperty('display', 'none', 'important'); });
    const surface = document.getElementById(target);
    if (!surface) return { missing: true, textIssues: [], targetIssues: [], outsideRoot: [] };
    surface.classList.add('active');
    const visible = (element) => {
      if (!(element instanceof Element) || element.hidden || element.closest('[hidden],[aria-hidden="true"],.vita-photo-brand,.vita-handle')) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const selector = (element) => element.id ? `#${element.id}` : `${element.localName}.${Array.from(element.classList).slice(0, 2).join('.')}`;
    const textIssues = [];
    for (const element of surface.querySelectorAll('*')) {
      if (!visible(element)) continue;
      const ownText = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).join(' ');
      if (!ownText) continue;
      const px = Number.parseFloat(getComputedStyle(element).fontSize);
      if (px < 12) textIssues.push({ selector: selector(element), px, text: ownText.slice(0, 70) });
    }
    const minimum = mobile ? 44 : 42;
    const targetIssues = [];
    for (const element of surface.querySelectorAll('button,input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),select,textarea,a[href],summary')) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width + .5 < minimum || rect.height + .5 < minimum) targetIssues.push({ selector: selector(element), width: Math.round(rect.width), height: Math.round(rect.height) });
    }
    const outsideRoot = Array.from(surface.querySelectorAll('*')).filter(visible).filter((element) => {
      const rect = element.getBoundingClientRect();
      const intentionalScroller = element.closest('.ed-guides-row,.ed-contour-bar,.ed-toolbar,.ed-canvas-toolbar,.res-header>div:last-child');
      return !intentionalScroller && (rect.left < -2 || rect.right > innerWidth + 2);
    }).slice(0, 12).map(selector);
    return { missing: false, textIssues, targetIssues, outsideRoot };
  }, { target, mobile });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--allow-file-access-from-files'] });
  const report = [];
  try {
    for (const file of pages) {
      for (const viewport of viewports) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, javaScriptEnabled: false });
        const page = await context.newPage();
        await page.goto(pathToFileURL(path.join(root, file)).href, { waitUntil: 'load' });
        for (const surface of surfaces) report.push({ file, size: viewport.name, surface, ...(await inspect(page, surface, viewport.mobile)) });
        await context.close();
      }
    }
  } finally { await browser.close(); }
  const failures = report.filter((item) => item.missing || item.textIssues.length || item.targetIssues.length || item.outsideRoot.length);
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`QA real v3.3 aprobado: ${report.length}/${report.length} superficies de simulación.`);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
