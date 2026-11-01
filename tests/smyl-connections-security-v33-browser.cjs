const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  const candidates = [
    'playwright',
    path.resolve(__dirname, '..', '..', 'promodesk-smyl-stage4', 'node_modules', 'playwright'),
    path.resolve(__dirname, '..', '..', 'camila', 'mobile', 'node_modules', 'playwright')
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('No se encontró Playwright en el repositorio ni en los runtimes hermanos del workspace.');
}

const { chromium } = loadPlaywright();

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures', 'smyl-connections-security-v33-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'connections-security-v33');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop-1440', width: 1440, height: 1000 },
    { name: 'tablet-1024', width: 1024, height: 900 },
    { name: 'mobile-390', width: 390, height: 844, touch: true }
  ];
  const report = [];

  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: Boolean(item.touch) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message || error)));
    await page.goto(fixture);
    await page.waitForFunction(() => document.documentElement.dataset.qaReady === 'true');
    const metrics = await page.evaluate(({ isMobile }) => {
      const visible = element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      };
      const roots = Array.from(document.querySelectorAll('.connections-shell,.security-page'));
      const textUnder12 = roots.flatMap(root => Array.from(root.querySelectorAll('*')))
        .filter(visible)
        .filter(element => Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
        .map(element => ({ text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 72), px: parseFloat(getComputedStyle(element).fontSize), cls: String(element.className || element.tagName) }))
        .filter(item => item.px < 12 - 0.01);
      const requiredHeight = isMobile ? 44 : 42;
      const smallTargets = roots.flatMap(root => Array.from(root.querySelectorAll('button,input:not([type="hidden"]),textarea,select,summary,a[href]')))
        .filter(visible)
        .map(element => { const box = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 64) || element.tagName, width: box.width, height: box.height }; })
        .filter(item => item.height < requiredHeight - .5);
      const cards = Array.from(document.querySelectorAll('.connections-grid>.connections-card,.security-layout>.security-card')).filter(visible).map(element => element.getBoundingClientRect());
      const overlap = cards.some((a, index) => cards.slice(index + 1).some(b => !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)));
      const escapedControls = roots.flatMap(root => Array.from(root.querySelectorAll('button,input,textarea,select,summary'))).filter(visible).filter(element => {
        const box = element.getBoundingClientRect();
        const root = element.closest('.connections-shell,.security-page').getBoundingClientRect();
        return box.left < root.left - 1 || box.right > root.right + 1;
      }).map(element => element.getAttribute('aria-label') || element.textContent.trim().slice(0, 60) || element.tagName);
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        textUnder12,
        smallTargets,
        overlap,
        escapedControls,
        connectionState: document.querySelector('.connections-status-card').getAttribute('aria-label'),
        securityStates: Array.from(document.querySelectorAll('.security-state')).map(element => element.textContent.trim()),
        securityPriorities: Array.from(document.querySelectorAll('.security-severity')).map(element => element.textContent.trim())
      };
    }, { isMobile: Boolean(item.touch) });
    const entry = { name: item.name, ...metrics, horizontalOverflow: metrics.scrollWidth > metrics.viewport + 1, errors };
    report.push(entry);
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: true });
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const failed = report.some(item => item.horizontalOverflow || item.overlap || item.escapedControls.length || item.textUnder12.length || item.smallTargets.length || item.errors.length || item.connectionState !== 'Estado: mensajería activa' || item.securityStates.join('|') !== 'Abierta|En investigación|Resuelta');
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
