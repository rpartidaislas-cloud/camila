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
const fixture = path.join(__dirname, 'fixtures', 'smyl-radiograph-clinical-workspace-v33.html');
const output = path.join(root, 'artifacts', 'radiograph-clinical-workspace-v33');
const viewports = [
  { name: '1440', width: 1440, height: 960 },
  { name: '1024', width: 1024, height: 900 },
  { name: '390', width: 390, height: 844 },
];
const surfaces = ['assisted', 'manual'];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const report = [];
  for (const surface of surfaces) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${pathToFileURL(fixture).href}?surface=${surface}`);
      const frameHandle = await page.waitForSelector('#surface');
      const frame = await frameHandle.contentFrame();
      if (!frame) throw new Error(`No se cargó la superficie ${surface}`);
      await frame.waitForLoadState('load');
      if (surface === 'assisted') {
        await frame.click('#open');
        await frame.waitForSelector('.rr-dialog[open] .rr-workspace');
      } else {
        await frame.getByText('Radiografías', { exact: true }).click();
        await frame.getByRole('button', { name: 'Abrir y anotar' }).click();
        await frame.waitForSelector('.dr-radiograph-dialog[open] .dr-reading-workspace');
      }
      const focusStart = frame.locator(surface === 'assisted' ? '.rr-view-tools button' : '.dr-radiograph-dialog .dr-tools button').first();
      await focusStart.focus();
      await focusStart.press('Tab');
      const metrics = await frame.evaluate(({ surface, mobile }) => {
        const dialog = document.querySelector(surface === 'assisted' ? '.rr-dialog' : '.dr-radiograph-dialog');
        const visible = (selector) => Array.from(dialog?.querySelectorAll(selector) || []).filter((element) => element.getClientRects().length);
        const workspace = document.querySelector(surface === 'assisted' ? '.rr-workspace' : '.dr-reading-workspace');
        const canvas = document.querySelector(surface === 'assisted' ? '.rr-canvas' : '.dr-viewer-pane');
        const panel = document.querySelector(surface === 'assisted' ? '.rr-signal-panel' : '.dr-signal-pane');
        const rect = (element) => element ? element.getBoundingClientRect().toJSON() : null;
        const textUnder12 = visible('*').filter((element) => {
          if (element.children.length || !element.textContent.trim()) return false;
          return Number.parseFloat(getComputedStyle(element).fontSize) < 12;
        }).map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent.trim().slice(0, 40), size: getComputedStyle(element).fontSize }));
        const targetElements = visible('button,select,textarea,input');
        const smallTargets = targetElements.filter((element) => {
          if (['checkbox', 'radio', 'range'].includes(element.type)) {
            const label = element.closest('label');
            if (label) return label.getBoundingClientRect().height < (mobile ? 44 : 42);
          }
          return element.getBoundingClientRect().height < (mobile ? 44 : 42);
        }).map((element) => ({ tag: element.tagName, type: element.type, className: element.className, height: Math.round(element.getBoundingClientRect().height) }));
        const focusTarget = document.activeElement;
        const focusStyle = focusTarget ? getComputedStyle(focusTarget) : null;
        return {
          surface,
          documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          dialogOverflow: dialog ? dialog.scrollWidth > dialog.clientWidth + 1 : true,
          textUnder12,
          smallTargets,
          workspace: rect(workspace),
          canvas: rect(canvas),
          panel: rect(panel),
          canvasPanelOverlap: (() => { const a = canvas?.getBoundingClientRect(); const b = panel?.getBoundingClientRect(); return Boolean(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1); })(),
          canvasRatio: workspace && canvas ? canvas.getBoundingClientRect().width / workspace.getBoundingClientRect().width : 0,
          focusVisible: Boolean(focusStyle && focusStyle.outlineStyle !== 'none' && Number.parseFloat(focusStyle.outlineWidth) >= 3),
        };
      }, { surface, mobile: viewport.width <= 639 });
      metrics.viewport = viewport.width;
      metrics.errors = errors;
      report.push(metrics);
      await page.screenshot({ path: path.join(output, `${surface}-${viewport.name}.png`), fullPage: true });
      await page.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const failures = report.filter((item) => item.documentOverflow || item.dialogOverflow || item.textUnder12.length || item.smallTargets.length || item.canvasPanelOverlap || !item.focusVisible || item.errors.length || (item.viewport >= 960 && item.canvasRatio < .55));
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log(`QA radiográfica v3.3 aprobada: ${report.length}/${report.length} vistas.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
