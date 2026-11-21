const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const fixture = pathToFileURL(path.join(__dirname, 'fixtures/smyl-evidence-center-integration-preview.html')).href;
const output = path.join(__dirname, '..', 'output', 'clinical-files-inset');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cases = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 820, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 568 }
];

async function checkState(page, viewport, empty) {
  const state = empty ? 'empty' : 'populated';
  const label = `${viewport.name} ${state}`;
  const card = page.locator('.cw-clinical-files-source');
  const archive = card.locator(`.seci-center.sec-root[data-empty="${empty}"]`);
  await archive.waitFor();
  const content = archive.locator(empty ? '.sec-empty' : '.sec-study').first();
  const add = archive.getByRole('button', { name: 'Agregar archivo', exact: true });
  await content.waitFor();
  assert.equal(await add.count(), 1, `${label}: un solo acceso para agregar archivos`);
  assert.equal(await card.locator('.seci-feedback[data-tone="error"]').count(), 0, `${label}: carga de categorías`);
  const [frame, kicker, heading, action, row] = await Promise.all([
    card.boundingBox(), archive.locator('.sec-head .sec-kicker').boundingBox(),
    archive.getByRole('heading', { name: 'Archivos clínicos', exact: true }).boundingBox(),
    add.boundingBox(), content.boundingBox()
  ]);
  const left = kicker.x - frame.x;
  const top = kicker.y - frame.y;
  const right = frame.x + frame.width;
  assert.ok(left >= (viewport.name === 'desktop' ? 17 : 12), `${label}: margen izquierdo de ${left}px`);
  assert.ok(top >= 12, `${label}: margen superior de ${top}px`);
  assert.ok(Math.abs(heading.x - kicker.x) <= 1, `${label}: título y etiqueta alineados`);
  for (const box of [action, row]) {
    assert.ok(box.x >= frame.x && box.x + box.width <= right + 1, `${label}: contenido dentro de la tarjeta`);
  }
  assert.ok(frame.x >= 0 && right <= viewport.width + 1, `${label}: tarjeta dentro de la pantalla`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: ancho de página`);
  await page.screenshot({ path: path.join(output, `${viewport.name}-${state}.png`), fullPage: true });
  await add.click();
  await page.locator('.sec-dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.sec-dialog[open]').waitFor({ state: 'hidden' });
  console.log(`${label}: ${left}px a la izquierda, ${top}px arriba`);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const executablePath = process.env.SMYL_CHROMIUM || (fs.existsSync(chrome) ? chrome : undefined);
  const browser = await chromium.launch({ executablePath });
  try {
    for (const viewport of cases) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.addInitScript(() => {
        const emptyCategories = {
          data: [],
          select() { return this; },
          eq() { return this; },
          order() { return this; }
        };
        window.sb = { from: () => emptyCategories, rpc: async () => ({ data: [] }) };
      });
      await page.goto(fixture);
      await checkState(page, viewport, false);
      await page.evaluate(() => {
        window.SmylPatient360.files = () => ({ items: [] });
        window.SmylDentalProgress.status = () => ({ studyItems: [] });
        window.dispatchEvent(new Event('smyl:patient-summary'));
      });
      await checkState(page, viewport, true);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
