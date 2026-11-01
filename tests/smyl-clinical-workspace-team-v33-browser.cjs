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
  const fixture = `file:///${path.resolve(__dirname, 'fixtures', 'smyl-clinical-workspace-team-v33-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'clinical-workspace-team-v33');
  fs.mkdirSync(output, { recursive: true });

  const cases = [
    { name: 'desktop-1440', width: 1440, height: 960 },
    { name: 'tablet-1024', width: 1024, height: 900 },
    { name: 'mobile-390', width: 390, height: 844, touch: true }
  ];
  const report = [];

  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: Boolean(item.touch) });
    const page = await context.newPage();
    await page.goto(fixture);
    const metrics = await page.evaluate(({ isMobile }) => {
      const visible = element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      };
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const keyCards = ['.clinic-admin-people-card', '.clinic-admin-pending-card', '.clinic-admin-role-card'].map(rect);
      const cardsOverlap = keyCards.some((a, index) => keyCards.slice(index + 1).some(b =>
        !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)
      ));
      const descendantsInside = Array.from(document.querySelectorAll('.clinic-admin-member select,.clinic-admin-member button,.clinic-admin-professional>*')).every(element => {
        if (!visible(element)) return true;
        const own = element.getBoundingClientRect();
        const parent = element.closest('.clinic-admin-member,.clinic-admin-professional').getBoundingClientRect();
        return own.left >= parent.left - 1 && own.right <= parent.right + 1;
      });
      const textUnder12 = Array.from(document.querySelectorAll('.clinic-admin-team-panel p,.clinic-admin-team-panel span,.clinic-admin-team-panel small,.clinic-admin-team-panel strong,.clinic-admin-team-panel b,.clinic-admin-team-panel label,.clinic-admin-team-panel button,.clinic-admin-team-panel summary'))
        .filter(visible)
        .filter(element => element.textContent.trim())
        .map(element => ({ text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 70), px: parseFloat(getComputedStyle(element).fontSize), cls: element.className || element.tagName }))
        .filter(item => item.px < 12);
      const requiredHeight = isMobile ? 44 : 42;
      const smallTargets = Array.from(document.querySelectorAll('button,select,summary,a[href],input:not([type="hidden"])'))
        .filter(visible)
        .map(element => {
          const box = element.getBoundingClientRect();
          return { label: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) || element.tagName, width: box.width, height: box.height };
        })
        .filter(item => item.height < requiredHeight - 0.5 || (isMobile && item.width < 44 - 0.5));
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        panelWidth: rect('.clinic-admin-team-panel').width,
        peopleWidth: rect('.clinic-admin-people-card').width,
        pendingWidth: rect('.clinic-admin-pending-card').width,
        cardsOverlap,
        descendantsInside,
        textUnder12,
        smallTargets
      };
    }, { isMobile: Boolean(item.touch) });
    const entry = { name: item.name, ...metrics, horizontalOverflow: metrics.scrollWidth > metrics.viewport + 1 };
    report.push(entry);
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: true });
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.horizontalOverflow || item.cardsOverlap || !item.descendantsInside || item.textUnder12.length || item.smallTargets.length)) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
