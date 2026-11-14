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
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 700 },
    { name: 'mobile-keyboard', width: 390, height: 620 }
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
      const body = document.querySelector('#modal-paciente .mp-body');
      const input = document.querySelector('#mp-nombre');
      const primary = footer.querySelector('.btn-primary');
      const nav = document.querySelector('.qa-bottom-nav');
      const footerBox = footer.getBoundingClientRect();
      const primaryBox = primary.getBoundingClientRect();
      const navBox = nav.getBoundingClientRect();
      const navVisible = getComputedStyle(nav).display !== 'none';
      return {
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        modalWidth: Math.round(modal.getBoundingClientRect().width),
        modalHeight: Math.round(modal.getBoundingClientRect().height),
        inputHeight: Math.round(input.getBoundingClientRect().height),
        footerVisible: footerBox.top >= -1 && footerBox.bottom <= innerHeight + 1,
        footerPosition: getComputedStyle(footer).position,
        footerAboveNav: !navVisible || footerBox.bottom <= navBox.top + 1,
        navVisible,
        bodyScrolls: body.scrollHeight > body.clientHeight,
        bodyOverflowY: getComputedStyle(body).overflowY,
        primaryId: primary.id,
        primaryType: primary.type,
        primaryTabIndex: primary.tabIndex,
        primaryDisabled: primary.disabled,
        primaryHeight: Math.round(primaryBox.height),
        primaryVisible: primaryBox.top >= -1 && primaryBox.bottom <= innerHeight + 1,
        primaryName: primary.textContent.trim(),
        actions: footer.querySelectorAll('button').length
      };
    });
    const isMobile = size.width <= 768;
    if (metrics.horizontalOverflow || metrics.inputHeight < 44 || !metrics.footerVisible || !metrics.primaryVisible || metrics.actions !== 2 || metrics.primaryId !== 'patient-save-button' || metrics.primaryType !== 'button' || metrics.primaryTabIndex < 0 || metrics.primaryDisabled || metrics.primaryName !== 'Crear paciente' || (isMobile && (metrics.navVisible || !metrics.footerAboveNav || metrics.primaryHeight < 44 || metrics.bodyOverflowY !== 'auto'))) throw new Error(`${size.name}: ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: path.join(output, `${size.name}.png`), fullPage: true });
    report.push({ ...size, ...metrics });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
