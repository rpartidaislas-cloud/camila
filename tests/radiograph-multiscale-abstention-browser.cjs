const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = path.resolve(__dirname, 'fixtures/smyl-radiograph-workbench-preview.html').replace(/\\/g, '/');
  const base = process.env.SMYL_PREVIEW_URL || `file:///${fixture}?quality=unusable`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'radiograph-multiscale-abstention-v16');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop', width: 1280, height: 820 },
    { name: 'tablet', width: 820, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 700 }
  ];
  const report = [];
  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('#open').click();
    await page.locator('.rr-dialog[open] .rr-image-check-workspace').waitFor();
    const continueButton = page.getByRole('button', { name: 'Continuar sin evaluación de IA', exact: true });
    const closeButton = page.getByRole('button', { name: 'Cerrar para cambiar imagen', exact: true });
    if (!await continueButton.isVisible() || !await closeButton.isVisible()) throw new Error(`No-evaluation actions are not visible at ${item.width}px`);
    await continueButton.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({
      rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      dialogOverflow: document.querySelector('.rr-dialog').scrollWidth > document.querySelector('.rr-dialog').clientWidth + 1,
      saves: window.__reviewSaves.length,
      note: document.querySelector('.rr-check-note')?.textContent || '',
      primaryHeight: document.querySelector('.rr-primary')?.getBoundingClientRect().height || 0
    }));
    await page.screenshot({ path: path.join(output, `${item.name}-decision.png`), fullPage: false });
    await continueButton.click();
    await page.locator('.rr-review-summary[data-result="no-evaluation"]').waitFor();
    const after = await page.evaluate(() => ({
      rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      dialogOverflow: document.querySelector('.rr-dialog').scrollWidth > document.querySelector('.rr-dialog').clientWidth + 1,
      saves: window.__reviewSaves.length,
      pending: document.querySelector('.rr-no-evaluation strong')?.textContent || '',
      safety: document.querySelector('.rr-complete-safety')?.textContent || '',
      continueHeight: Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Continuar al expediente')?.getBoundingClientRect().height || 0,
      actionsInside: (() => {
        const dialog = document.querySelector('.rr-dialog').getBoundingClientRect();
        return Array.from(document.querySelectorAll('.rr-review-summary > .rr-actions button')).every(button => {
          const box = button.getBoundingClientRect();
          return box.left >= dialog.left - 1 && box.right <= dialog.right + 1;
        });
      })()
    }));
    await page.screenshot({ path: path.join(output, `${item.name}-summary.png`), fullPage: false });
    report.push({ name: item.name, width: item.width, before, after, errors });
    const minHeight = item.width <= 390 ? 44 : 36;
    if (errors.length || before.rootOverflow || before.dialogOverflow || after.rootOverflow || after.dialogOverflow || before.saves || after.saves || !before.note.includes('no marca el estudio como revisado') || after.pending !== 'Pendiente de revisión profesional' || !after.safety.includes('no se marcó como revisado') || !after.actionsInside || before.primaryHeight < minHeight || after.continueHeight < minHeight) {
      throw new Error(`Invalid no-evaluation flow at ${item.width}px: ${JSON.stringify({ before, after, errors })}`);
    }
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
