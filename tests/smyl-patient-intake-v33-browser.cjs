const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SMILA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const url = process.env.SMYL_INTAKE_PREVIEW || 'http://127.0.0.1:8766/tests/fixtures/smyl-patient-intake-v33-preview.html';
  const app = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8');
  const modalMarkup = app.slice(app.indexOf('<div class="modal-bg" id="modal-paciente">'), app.indexOf('<!-- ═══ MODAL CAMBIAR DE PLAN ═══ -->'));
  const output = path.join(process.cwd(), 'artifacts', 'patient-intake-v33');
  fs.mkdirSync(output, { recursive: true });
  const sizes = [
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'tablet-820', width: 820, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 }
  ];
  const report = [];
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });
    await page.goto(url + '?viewport=' + size.name, { waitUntil: 'domcontentloaded' });
    if (!await page.locator('#modal-paciente').count()) await page.evaluate(markup => {
      document.body.insertAdjacentHTML('beforeend', markup);
      const modal = document.querySelector('#modal-paciente');
      modal.dataset.smylLegacyDialog = 'true';
      modal.classList.add('visible');
      modal.querySelector('#patient-clinic-line').textContent = 'Se guardará en Clínica de prueba.';
    }, modalMarkup);
    await page.waitForSelector('#modal-paciente.visible', { timeout: 10000 });
    const metrics = await page.evaluate(() => {
      const modal = document.querySelector('.modal-paciente');
      const footer = document.querySelector('#modal-paciente .modal-footer');
      const input = document.querySelector('#mp-nombre');
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        modalWidth: Math.round(modal.getBoundingClientRect().width),
        modalHeight: Math.round(modal.getBoundingClientRect().height),
        inputHeight: Math.round(input.getBoundingClientRect().height),
        footerVisible: footer.getBoundingClientRect().bottom <= innerHeight + 1,
        actions: footer.querySelectorAll('button').length
      };
    });
    if (metrics.horizontalOverflow || metrics.inputHeight < 44 || !metrics.footerVisible || metrics.actions !== 2) throw new Error(`${size.name}: ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: path.join(output, `${size.name}.png`), fullPage: true });
    report.push({ ...size, ...metrics });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
