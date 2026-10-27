const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SMILA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const url = process.env.SMILA_PATIENTS_PREVIEW || pathToFileURL(path.join(process.cwd(), 'tests', 'fixtures', 'smyl-patients-v32-preview.html')).href;
  const output = path.join(process.cwd(), 'artifacts', 'patients-v32');
  fs.mkdirSync(output, { recursive: true });
  const sizes = [
    { name: 'desktop-1440', width: 1440, height: 900 },
    { name: 'tablet-1024', width: 1024, height: 768 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 568 }
  ];
  const report = [];
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      primaryActions: document.querySelectorAll('.patient-directory-v3 .btn-primary').length,
      searchHeight: Math.round(document.querySelector('#buscar-pac').getBoundingClientRect().height),
      rowCount: document.querySelectorAll('.clinic-patient-row').length
    }));
    await page.screenshot({ path: path.join(output, `${size.name}.png`), fullPage: true });
    report.push({ ...size, ...metrics });
    await page.close();
  }
  const zoomPage = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await zoomPage.goto(url, { waitUntil: 'domcontentloaded' });
  await zoomPage.evaluate(() => { document.documentElement.style.zoom = '2'; });
  report.push(await zoomPage.evaluate(() => ({
    name: 'zoom-200',
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  })));
  await zoomPage.screenshot({ path: path.join(output, 'zoom-200.png'), fullPage: true });
  await zoomPage.close();
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
