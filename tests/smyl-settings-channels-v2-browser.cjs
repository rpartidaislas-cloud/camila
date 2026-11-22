const path = require('node:path');
const assert = require('node:assert/strict');

function loadPlaywright() {
  const candidates = [
    'playwright',
    path.resolve(__dirname, '..', '..', 'promodesk-smyl-stage4', 'node_modules', 'playwright'),
    path.resolve(__dirname, '..', '..', 'camila', 'mobile', 'node_modules', 'playwright')
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { if (error && error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('No se encontró Playwright.');
}

const { chromium } = loadPlaywright();

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures', 'smyl-settings-channels-v2-preview.html').replace(/\\/g, '/')}`;
  const cases = [
    { name: 'desktop', width: 1280, height: 900, min: 42 },
    { name: 'tablet', width: 820, height: 900, min: 42 },
    { name: 'mobile', width: 390, height: 844, min: 44 },
    { name: 'mobile-320', width: 320, height: 760, min: 44 }
  ];
  const report = [];
  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: item.width < 600 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message || error)));
    await page.goto(fixture);
    try {
      await page.waitForSelector('html[data-qa-ready="true"]', { timeout: 5000 });
    } catch (error) {
      console.error(JSON.stringify({ name: item.name, ready: await page.evaluate(() => document.documentElement.dataset.qaReady || ''), errors }, null, 2));
      await context.close();
      throw error;
    }
    await page.waitForFunction(() => document.querySelector('.settings-account-count')?.textContent === '1 de 3 conectadas');
    for (const channel of ['whatsapp','messenger','instagram']) {
      const card = page.locator('[data-account="' + channel + '"]');
      assert.ok(await card.locator('img').evaluate(img => img.complete && img.naturalWidth && img.src.endsWith('/' + img.closest('button').dataset.account + '.svg')));
      assert.equal(await card.locator('.settings-account-action').innerText(), channel === 'instagram' ? 'Administrar' : 'Conectar');
    }
    assert.equal(await page.locator('[data-account="instagram"] .settings-account-name').innerText(),'@smyl.clinic');
    const settings = await page.evaluate(() => ({
      categories: document.querySelectorAll('.settings-hub-nav-item').length,
      rows: document.querySelectorAll('.settings-hub-row').length,
      groups: document.querySelectorAll('.settings-hub-group').length,
      current: document.querySelector('.settings-hub-nav-item[aria-current="true"]')?.textContent.trim(),
      pickerValue: document.querySelector('.settings-hub-picker-select')?.value,
      panelTitle: document.querySelector('.settings-hub-panel-head h1')?.textContent.trim(),
      duplicatedTitle: Array.from(document.querySelectorAll('#p-configuracion h1')).some(node => node.textContent.trim() === 'Configuración'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    }));
    if (process.env.SMYL_QA_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SMYL_QA_SCREENSHOTS, `settings-${item.name}.png`), fullPage: true });
    if (item.name === 'desktop') {
      // Una respuesta tardía de otra clínica jamás debe volver a pintar una cuenta.
      await page.evaluate(() => {
        window.SmylSettingsHub.open('agenda');
        const fetchNormally = window.fetch;
        window.fetch = (url, options) => {
          if (!String(url).includes('/lana-channels')) return fetchNormally(url, options);
          return new Promise(resolve => { window.completePreviousClinic = () => resolve(new Response(JSON.stringify({can_manage:true, channels:[{channel:'instagram',connected:true,display_name:'@anterior'}]}))); });
        };
        window.SmylSettingsHub.open('canales');
      });
      await page.waitForFunction(() => typeof window.completePreviousClinic === 'function');
      await page.evaluate(() => {
        window.tenantId = 'otra-clinica-demo';
        window.fetch = async () => new Response('{}', {status:503});
        window.SmylSettingsHub.open('canales');
      });
      await page.getByRole('button', {name:'Reintentar consulta'}).waitFor();
      await page.evaluate(() => window.completePreviousClinic());
      assert.equal(await page.locator('.settings-account[data-state="unknown"]').count(),3);
      assert.equal(await page.getByText('@anterior').count(),0);
      await page.evaluate(() => {
        window.fetch = async () => new Response(JSON.stringify({can_manage:false,channels:[{channel:'instagram',connected:true,display_name:'@otra'}]}));
      });
      await page.getByRole('button', {name:'Reintentar consulta'}).click();
      await page.getByText('@otra', {exact:true}).waitFor();
      assert.equal(await page.locator('[data-account="instagram"] .settings-account-action').innerText(), 'Ver canal');
      assert.equal(await page.locator('[data-account="messenger"] .settings-account-status').innerText(), 'Sin verificar');
      assert.equal(await page.locator('.settings-account-count').innerText(),'');
      await page.reload();
      await page.waitForSelector('html[data-qa-ready="true"]');
    }
    await page.evaluate(() => window.SmylSettingsHub.open('agenda'));
    await page.waitForFunction(() => document.querySelector('.settings-hub-panel-head h1')?.textContent.trim() === 'Agenda');
    const agenda = await page.evaluate(() => ({
      rows: document.querySelectorAll('.settings-hub-row').length,
      groups: document.querySelectorAll('.settings-hub-group').length,
      current: document.querySelector('.settings-hub-nav-item[aria-current="true"]')?.textContent.trim(),
      pickerValue: document.querySelector('.settings-hub-picker-select')?.value,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    }));
    if (process.env.SMYL_QA_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SMYL_QA_SCREENSHOTS, `agenda-${item.name}.png`), fullPage: true });
    await page.evaluate(() => window.SmylSettingsHub.open('canales'));
    await page.waitForFunction(() => document.querySelector('.settings-hub-panel-head h1')?.textContent.trim() === 'Canales');
    for (const channel of ['messenger','instagram']) {
      await page.locator('[data-account="' + channel + '"]').click();
      await page.locator('#p-conexiones.activa [data-connection-pane="' + channel + '"]:visible').waitFor();
      await page.getByRole('button', {name:'Volver a Configuración'}).click();
    }
    await page.locator('[data-account="whatsapp"]').click();
    await page.waitForFunction(() => document.getElementById('p-conexiones')?.classList.contains('activa') && !document.querySelector('[data-connection-pane="whatsapp"]')?.hidden);
    await page.waitForFunction(() => document.querySelector('[data-lana-status]')?.textContent.trim() === 'Mensajería activa' && document.querySelector('[data-channel-row="whatsapp"]')?.dataset.state === 'pending');
    const whatsapp = await page.evaluate(min => {
      const visible = element => element && getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0;
      const controls = Array.from(document.querySelectorAll('#p-conexiones button,#p-conexiones input,#p-conexiones select,#p-conexiones textarea,#p-conexiones summary')).filter(visible);
      return {
        tabs: document.querySelectorAll('[data-connection-tab]').length,
        visiblePanes: Array.from(document.querySelectorAll('[data-connection-pane]')).filter(visible).length,
        title: document.querySelector('[data-connection-pane="whatsapp"] h2')?.textContent.trim(),
        rows: document.querySelectorAll('[data-connection-pane="whatsapp"] [data-channel-row="whatsapp"]').length,
        tools: document.querySelectorAll('[data-connection-pane="whatsapp"] .connections-tool-card').length,
        modeChoices: document.querySelectorAll('[data-connection-pane="whatsapp"] .connections-whatsapp-mode').length,
        modeButtons: document.querySelectorAll('[data-connection-pane="whatsapp"] [data-connection-mode]').length,
        navGroups: document.querySelectorAll('.connections-tab-group-label').length,
        logo: (() => { const image = document.querySelector('[data-connection-pane="whatsapp"] .connections-channel-brand img[src*="whatsapp.svg"]'); return Boolean(image && image.complete && image.naturalWidth); })(),
        accountLogo: (() => { const image = document.querySelector('[data-connection-pane="whatsapp"] .connections-channel-icon--whatsapp img[src*="whatsapp.svg"]'); return Boolean(image && image.complete && image.naturalWidth); })(),
        scope: document.querySelector('[data-connection-pane="whatsapp"] .connections-channel-scope h3')?.textContent.trim(),
        minControl: Math.min(...controls.map(control => control.getBoundingClientRect().height)),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        expectedMin: min
      };
    }, item.min);
    if (process.env.SMYL_QA_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SMYL_QA_SCREENSHOTS, `whatsapp-${item.name}.png`), fullPage: true });
    await page.locator('[data-connection-tab="automations"]').click();
    const automations = await page.evaluate(() => ({
      visible: !document.querySelector('[data-connection-pane="automations"]').hidden,
      tools: document.querySelectorAll('[data-connection-pane="automations"] .connections-tool-card').length
    }));
    if (process.env.SMYL_QA_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SMYL_QA_SCREENSHOTS, `channels-${item.name}.png`), fullPage: true });
    report.push({ name: item.name, settings, agenda, whatsapp, automations, errors });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  const failed = report.some(item => item.errors.length || item.settings.categories !== 7 || item.settings.rows !== 5 || item.settings.groups !== 3 || item.settings.panelTitle !== 'Canales' || item.settings.pickerValue !== 'canales' || item.settings.duplicatedTitle || !/Canales/.test(item.settings.current || '') || item.settings.overflow || item.agenda.rows !== 5 || item.agenda.groups !== 3 || !/^Agenda/.test(item.agenda.current) || item.agenda.pickerValue !== 'agenda' || item.agenda.overflow || item.whatsapp.tabs !== 8 || item.whatsapp.visiblePanes !== 1 || item.whatsapp.title !== 'WhatsApp Business' || item.whatsapp.rows !== 1 || item.whatsapp.tools !== 4 || item.whatsapp.modeChoices !== 2 || item.whatsapp.modeButtons !== 2 || item.whatsapp.navGroups !== 3 || !item.whatsapp.logo || !item.whatsapp.accountLogo || item.whatsapp.scope !== 'Se configura al conectar' || item.whatsapp.minControl < item.whatsapp.expectedMin - .5 || item.whatsapp.overflow || !item.automations.visible || item.automations.tools !== 3);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(); });
