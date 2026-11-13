// Recorre el workspace real en Chromium. Evita que una refactorización mueva el editor a un panel
// y deje openRadiographIntake buscándolo en otro. Se omite sola cuando Playwright no está instalado.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = pathToFileURL(path.join(root, 'tests/fixtures/smyl-radiograph-intake-runtime-preview.html')).href;
let browser = null, reason = '';

before(async () => {
  try {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const executablePath = process.env.SMYL_CHROMIUM || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    reason = 'Playwright o Chromium no disponibles: ' + String(error.message).split('\n')[0];
  }
});

after(async () => { if (browser) await browser.close(); });

test('el workspace real abre el editor radiográfico dentro de Revisión profesional', async t => {
  if (!browser) return t.skip(reason);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(fixture);
    await page.waitForSelector('body[data-intake]', { timeout: 8000 });
    const result = await page.evaluate(() => window.__radiographIntake);
    assert.deepEqual(result, {
      ok:true,
      connected:true,
      hidden:false,
      open:true,
      inReview:true,
      containsRecord:true,
      fileTransferred:true,
      dialogClosed:true,
      errorCount:0,
      inlineError:''
    });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
