const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const fixture = pathToFileURL(path.resolve(__dirname, 'fixtures/smyl-professional-directory-preview.html')).href;
  const output = path.resolve(__dirname, '../artifacts');
  fs.mkdirSync(output, { recursive: true });

  for (const width of [1440, 1024, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1 });
    await page.goto(fixture);
    await page.waitForSelector('.directory-photo-picker');
    await page.locator('[name="display_name"]').fill('Dra. Sofía Herrera');
    await page.locator('[name="headline"]').fill('Sonrisas naturales con planeación digital y atención cercana');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error(`Desbordamiento horizontal detectado a ${width}px`);
    await page.screenshot({ path: path.join(output, `professional-directory-${width}.png`), fullPage: true });
    await page.locator('[data-profile-step="2"]').first().click();
    await page.screenshot({ path: path.join(output, `professional-trust-${width}.png`), fullPage: true });
    await page.locator('[data-directory-area="cases"]').click();
    await page.locator('[data-new-case]').first().click();
    const caseOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (caseOverflow) throw new Error(`Desbordamiento horizontal en Casos a ${width}px`);
    await page.screenshot({ path: path.join(output, `professional-cases-${width}.png`), fullPage: true });
    await page.close();
  }

  await browser.close();
  console.log('QA visual completado: 1440, 1024 y 390 px.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
