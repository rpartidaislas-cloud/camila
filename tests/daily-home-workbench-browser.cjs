const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'inicio');
const origin = 'http://smyl.test';
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/smyl-daily-home-stage4-preview.html'), 'utf8');
const data = fixture.match(/<script id="dashboard-qa-data">([\s\S]*?)<\/script>/)[1];

// Las reglas globales y el espacio que deja el menú provienen de la página publicada.
const head = app.split('</head>')[0].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const shellStart = app.indexOf('<div class="layout">');
const content = '<div class="contenido">';
const shellEnd = app.indexOf(content, shellStart);
assert(shellStart >= 0 && shellEnd > shellStart, 'Debe existir la estructura de Inicio en app.html');
const bodyClass = app.match(/<body class="([^"]+)"/)[1];
const shell = app.slice(shellStart, shellEnd).replace('class="layout"', 'class="layout is-visible"');
const mobileNav = app.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)[0];
const pageHTML = head + '</head><body class="' + bodyClass + '">' + shell
  + content + '<div class="pantalla activa" id="p-dashboard"></div></div></div></div>'
  + mobileNav + '<script>' + data + '</script>'
  + '<script src="smyl-daily-home.js"></script><script src="smyl-clinic-setup.js"></script>'
  + '<script src="smyl-navigation.js"></script><script src="smyl-professional-v3.js"></script></body></html>';

async function open(browser, width, scenario = 'work') {
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 960 }, isMobile: width <= 820, hasTouch: width <= 820, timezoneId: 'America/Mexico_City', locale: 'es-MX' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(6000);
  await page.clock.setFixedTime(new Date('2026-11-19T16:00:00Z'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/app.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: pageHTML });
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    return route.fulfill({ path: file });
  });
  await page.goto(origin + '/app.html?scenario=' + scenario);
  const home = page.locator('#smyl-daily-home');
  if (scenario === 'empty') await home.locator('.daily-home-next-empty').waitFor();
  else if (scenario === 'chat-only') await home.locator('.daily-home-chat').first().waitFor();
  else await home.locator('[data-home-next] button[data-status]').first().waitFor();
  if (scenario !== 'clinician' && scenario !== 'chat-only') await home.locator('#smyl-clinic-setup .clinic-setup-toggle').waitFor();
  assert.deepEqual(errors, []);
  return {page, home, errors};
}

async function checkLayout(page, home, width) {
  const rect = selector => home.locator(selector).boundingBox();
  const [agenda, priorities, chats, month, setup] = await Promise.all([
    rect('.daily-home-now-card'), rect('.daily-home-priorities'), rect('.daily-home-chats'), rect('.daily-home-month'), rect('#smyl-clinic-setup'),
  ]);
  for (const box of [agenda, priorities, chats, month, setup]) {
    assert(box && box.x >= -1 && box.x + box.width <= width + 1, 'Tarjeta visible dentro del ancho de ' + width + 'px: ' + JSON.stringify(box));
  }
  if (width >= 1400) {
    assert(Math.abs(agenda.y - priorities.y) < 2 && priorities.x >= agenda.x + agenda.width - 1, 'Pendientes a la derecha de la jornada');
    assert(Math.abs(agenda.x - chats.x) < 2 && chats.y >= agenda.y + agenda.height - 1, 'Mensajes debajo de la jornada');
  } else if (width <= 390) {
    assert(agenda.y + agenda.height <= priorities.y + 1 && priorities.y + priorities.height <= chats.y + 1, 'Orden móvil: jornada, atención y mensajes');
  }
  if (width >= 1400) {
    assert(Math.abs(month.x - priorities.x) < 2 && month.y >= priorities.y + priorities.height - 1, 'Resumen mensual debajo de los pendientes');
  } else if (width <= 390) {
    assert(month.y >= chats.y + chats.height - 1, 'Resumen del mes después de los mensajes en móvil');
  }
  assert(setup.y >= Math.max(month.y + month.height, chats.y + chats.height) - 1, 'Configuración al final');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sin desplazamiento horizontal a ' + width + 'px');
  const overlap = await home.locator('button:visible').evaluateAll(buttons => buttons.filter(button => {
    const bounds = button.getBoundingClientRect();
    return bounds.left < -1 || bounds.right > innerWidth + 1;
  }).map(button => button.textContent.trim()));
  assert.deepEqual(overlap, [], 'Controles a la vista a ' + width + 'px');
  if (width <= 820) {
    assert(await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
    const small = await home.locator('button:visible').evaluateAll(buttons => buttons
      .filter(button => button.getBoundingClientRect().height < 43.9)
      .map(button => [button.textContent.trim(), button.getBoundingClientRect().height]));
    assert.deepEqual(small, [], 'Objetivos táctiles de 44px a ' + width + 'px');
  }
}

async function activate(locator, page, key, expected) {
  await locator.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('body').getAttribute('data-' + key), expected);
}

async function run() {
  const chrome = process.env.CHROME_PATH || process.env.SMYL_CHROMIUM || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [1440, 820, 390, 320]) {
      const {page, home, errors} = await open(browser, width);
      await home.getByRole('button', {name: /Conversación resuelta/i}).waitFor();
      await home.getByText('Cobrado este mes').waitFor();
      assert.equal(await home.locator('[data-home-next] button[data-status]').count(), 3);
      assert.equal(await home.locator('[data-home-priorities] article').count(), 2);
      await checkLayout(page, home, width);
      if (width === 390) await page.screenshot({ path: path.join(output, 'dashboard-mobile-viewport.png') });
      await page.screenshot({ path: path.join(output, 'dashboard-' + width + '.png'), fullPage: true });
      await home.locator('[data-home-new-appointment]').focus();
      await page.keyboard.press('Enter');
      const appointment = page.getByRole('dialog', { name: 'Agendar cita' });
      await activate(appointment.getByRole('button', { name: /Paciente Prueba/ }), page, 'appointment-patient', 'p1');
      await activate(home.locator('[data-home-open-agenda]'), page, 'route', 'agenda');
      await activate(home.locator('[data-home-chats] button').first(), page, 'chat', 'c1');
      const toggle = home.locator('.clinic-setup-toggle');
      await toggle.focus();
      await page.keyboard.press('Space');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert(await home.locator('.clinic-setup-details').isVisible());
      assert.deepEqual(errors, []);
      await page.close();
    }

    const { page, home } = await open(browser, 1440, 'empty');
    assert.equal(await home.locator('[data-home-next] button').count(), 0, 'La jornada vacía conserva una sola acción de alta en la cabecera');
    assert.equal(await home.locator('[data-home-priorities] article').count(), 0);
    assert(await home.getByText('Sin conversaciones recientes').isVisible());
    await checkLayout(page, home, 1440);
    await page.screenshot({ path: path.join(output, 'dashboard-empty-1440.png'), fullPage: true });
    await page.close();

    const restricted = await open(browser, 390, 'clinician');
    assert(await restricted.home.locator('[data-home-new-appointment]').isHidden());
    assert(await restricted.home.locator('.daily-home-chats').isHidden());
    assert(await restricted.home.locator('#smyl-clinic-setup').isHidden());
    assert(await restricted.home.getByText('Cobrado este mes').isHidden());
    assert.equal(await restricted.home.locator('[data-home-next] button[data-status]').count(), 1);
    assert.match(await restricted.home.locator('[data-home-next]').textContent(), /Paciente Prueba/);
    await restricted.page.close();

    const agent = await open(browser, 1440, 'chat-only');
    assert(await agent.home.locator('.daily-home-now-card').isHidden());
    assert(await agent.home.locator('[data-home-new-appointment]').isHidden());
    assert(await agent.home.locator('#smyl-clinic-setup').isHidden());
    await activate(agent.home.locator('[data-home-chats] button').first(), agent.page, 'chat', 'c1');
    await agent.page.close();

    const failed = await open(browser, 390, 'chat-error');
    assert(await failed.home.getByRole('button', { name: 'Reintentar' }).isVisible());
    await failed.page.evaluate(() => { window.SmylInbox.fetchRecent = async () => []; });
    await failed.home.getByRole('button', { name: 'Reintentar' }).click();
    await failed.home.getByText('Sin conversaciones recientes').waitFor();
    await failed.page.close();
  } finally {
    await browser.close();
  }
  console.log('Inicio verificado a 1440, 820, 390 y 320 px. Capturas en ' + output);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
