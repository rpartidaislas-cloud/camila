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
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures', 'smyl-clinical-workspace-finance-reports-v33-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'clinical-workspace-finance-reports-v33');
  fs.mkdirSync(output, { recursive: true });

  const viewports = [
    { name: 'desktop-1440', width: 1440, height: 960 },
    { name: 'tablet-1024', width: 1024, height: 900 },
    { name: 'mobile-390', width: 390, height: 844, touch: true }
  ];
  const modules = ['finance', 'reports'];
  const report = [];

  for (const moduleName of modules) {
    for (const item of viewports) {
      const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: Boolean(item.touch) });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(`${fixture}?module=${moduleName}`);
      await page.waitForLoadState('domcontentloaded');

      const metrics = await page.evaluate(({ moduleName, isMobile }) => {
        const root = document.querySelector(moduleName === 'finance' ? '.finance-page' : '.reports-page');
        const visible = element => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };
        const compact = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 76);
        const textSelector = 'p,span,small,label,button,a,strong,b,dt,dd,li,h1,h2,h3';
        const textUnder12 = Array.from(root.querySelectorAll(textSelector))
          .filter(visible)
          .filter(element => compact(element.textContent))
          .map(element => ({ text: compact(element.textContent), px: parseFloat(getComputedStyle(element).fontSize), cls: compact(element.className || element.tagName) }))
          .filter(item => item.px < 12 - 0.01);
        const requiredHeight = isMobile ? 44 : 42;
        const smallTargets = Array.from(root.querySelectorAll('button,.btn,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),select,textarea,[role="button"]'))
          .filter(visible)
          .map(element => {
            const box = element.getBoundingClientRect();
            return { label: element.getAttribute('aria-label') || compact(element.textContent) || element.tagName, width: box.width, height: box.height };
          })
          .filter(item => item.height < requiredHeight - 0.5 || (isMobile && item.width < 44 - 0.5));
        const outsideRoot = Array.from(root.querySelectorAll('button,input,select,article,.finance-row,.reports-row'))
          .filter(visible)
          .map(element => {
            const own = element.getBoundingClientRect();
            const host = root.getBoundingClientRect();
            return { label: compact(element.textContent) || element.tagName, left: own.left, right: own.right, hostLeft: host.left, hostRight: host.right };
          })
          .filter(item => item.left < item.hostLeft - 1 || item.right > item.hostRight + 1);
        const pairs = moduleName === 'finance'
          ? [['.finance-head>div:first-child', '.finance-head-actions'], ['.finance-metrics article:nth-child(1)', '.finance-metrics article:nth-child(2)']]
          : [['.reports-head>div:first-child', '.reports-filter-shell'], ['.reports-grid .reports-card', '.reports-grid aside']];
        const overlaps = pairs.flatMap(([aSelector, bSelector]) => {
          const a = root.querySelector(aSelector); const b = root.querySelector(bSelector);
          if (!a || !b || !visible(a) || !visible(b)) return [];
          const x = a.getBoundingClientRect(); const y = b.getBoundingClientRect();
          const overlap = !(x.right <= y.left + 1 || y.right <= x.left + 1 || x.bottom <= y.top + 1 || y.bottom <= x.top + 1);
          return overlap ? [{ a: aSelector, b: bSelector }] : [];
        });
        if (moduleName === 'finance') {
          const tabButtons = Array.from(root.querySelectorAll('.finance-tabs button')).filter(visible);
          tabButtons.forEach((button, index) => {
            const x = button.getBoundingClientRect();
            tabButtons.slice(index + 1).forEach(next => {
              const y = next.getBoundingClientRect();
              if (!(x.right <= y.left + 1 || y.right <= x.left + 1 || x.bottom <= y.top + 1 || y.bottom <= x.top + 1)) overlaps.push({ a: compact(button.textContent), b: compact(next.textContent) });
            });
          });
        }
        const focusTarget = root.querySelector('button');
        focusTarget.focus();
        const focusStyle = getComputedStyle(focusTarget);
        const focusVisible = parseFloat(focusStyle.outlineWidth) >= 2 && focusStyle.outlineStyle !== 'none';
        focusTarget.blur();
        return {
          viewport: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          rootWidth: root.getBoundingClientRect().width,
          textUnder12,
          smallTargets,
          outsideRoot,
          overlaps,
          focusVisible
        };
      }, { moduleName, isMobile: Boolean(item.touch) });

      const entry = {
        module: moduleName,
        viewport: item.name,
        ...metrics,
        pageErrors,
        horizontalOverflow: metrics.scrollWidth > metrics.viewport + 1
      };
      report.push(entry);
      await page.screenshot({ path: path.join(output, `${moduleName}-${item.name}.png`), fullPage: true });
      await context.close();
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.horizontalOverflow || item.textUnder12.length || item.smallTargets.length || item.outsideRoot.length || item.overlaps.length || !item.focusVisible || item.pageErrors.length)) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
