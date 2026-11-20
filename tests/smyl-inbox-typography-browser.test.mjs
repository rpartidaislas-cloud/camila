import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';

const shell = new URL('../app.html', import.meta.url);
const shellHead = readFileSync(shell, 'utf8').split('</head>')[0];
const preview = new URL('./fixtures/smyl-inbox-stage7-preview.html?pipeline-preview&care-history=several', import.meta.url);
let browser;

before(async () => {
  try {
    browser = await createRequire(import.meta.url)('playwright').chromium.launch({
      executablePath: process.env.SMYL_CHROMIUM,
      args: ['--allow-file-access-from-files'],
    });
  } catch (error) {
    if (process.env.SMYL_CHROMIUM) throw error;
  }
});
after(async () => browser?.close());

// The standalone fixture supplies mock conversations. Use the app's own style
// order so a global form rule can reproduce the desktop/mobile regression.
async function loadAppStyles(page) {
  await page.evaluate(async ({ html, base }) => {
    const shell = new DOMParser().parseFromString(html, 'text/html');
    document.head.querySelectorAll('link[rel=stylesheet]').forEach(link => link.remove());
    const loads = [];
    for (const el of shell.head.querySelectorAll('style, link[rel=stylesheet]')) {
      const copy = document.importNode(el, true);
      if (copy.tagName === 'LINK') {
        const target = new URL(el.getAttribute('href'), base);
        if (target.protocol !== 'file:') continue;
        copy.href = target.href;
        loads.push(new Promise((resolve, reject) => {
          copy.onload = resolve;
          copy.onerror = () => reject(new Error('No se pudo cargar ' + target.pathname));
        }));
      }
      document.head.append(copy);
    }
    await Promise.all(loads);
  }, { html: shellHead, base: shell.href });
}

async function checkText(scope, selector, px) {
  const el = scope.locator(selector).first();
  await el.waitFor({ state: 'visible' });
  assert.equal(await el.evaluate(node => getComputedStyle(node).fontSize), px + 'px', selector);
}

async function openThreadPreview(t, width, query) {
  const page = await browser.newPage({
    viewport: {width, height: 844}, hasTouch: width <= 820, isMobile: width <= 430,
    locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce',
  });
  t.after(() => page.close());
  page.setDefaultTimeout(6000);
  await page.route(/^https?:/, route => route.abort());
  const url = new URL(preview);
  url.search = query;
  await page.goto(url.href);
  await page.locator('html[data-preview-ready=true]').waitFor();
  await loadAppStyles(page);
  return page;
}

async function capture(page, name) {
  const folder = process.env.SMYL_QA_SHOTS;
  if (!folder) return;
  mkdirSync(folder, {recursive: true});
  await page.screenshot({path:path.join(folder, name + '.png')});
}

async function bounds(page, selector) {
  const el = page.locator(selector);
  await el.waitFor({state:'visible'});
  return el.boundingBox();
}

for (const width of [320, 390, 820, 1440]) {
  test('Espacio para los mensajes y controles accesibles del hilo a ' + width + ' px', async t => {
    if (!browser) return t.skip('Se necesita Chromium con Playwright.');
    const page = await openThreadPreview(t, width, 'focus&mobile-layout');
    const header = await bounds(page, '.smyl-inbox-thread-head');
    const history = await bounds(page, '[data-thread-body]');
    const composer = await bounds(page, '[data-inbox-composer]');
    const options = page.getByRole('button', {name:'Opciones del chat',exact:true});
    const narrow = header.width <= 700;
    assert.equal(await options.isVisible(), narrow, 'Las opciones responden al ancho del hilo');
    assert.ok(header.y + header.height <= history.y + 1 && history.y + history.height <= composer.y + 1, 'El historial ocupa su propio espacio');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    t.diagnostic(JSON.stringify({viewport:width, panel:header.width, encabezado:header.height, editor:composer.height, historial:history.height}));
    if (narrow) {
      assert.ok(header.height <= 76, 'Encabezado de una fila: ' + header.height);
      assert.equal(await page.locator('[data-thread-owner]').isVisible(), false);
      assert.equal(await page.locator('[data-thread-mode]').isVisible(), false);
      assert.equal(await options.getAttribute('aria-expanded'), 'false');
    }
    const schedule = page.locator('[data-thread-primary-action=schedule]');
    assert.equal(await schedule.isVisible(), true, 'La cita conserva acceso directo');
    if (width <= 430) {
      assert.ok(composer.height <= 86, 'Altura del editor en reposo: ' + composer.height);
      assert.ok(Math.abs(composer.y + composer.height - 844) <= 2, 'El editor ocupa hasta el límite visible');
      for (const selector of ['[data-inbox-back]', '[data-inbox-context]', '[data-thread-options]', '[data-thread-primary-action=schedule]', '[data-compose-more]', '[data-compose-copilot]', '[data-compose-send]']) {
        const box = await bounds(page, selector);
        assert.ok(box.width >= 44 && box.height >= 44, selector + ': ' + JSON.stringify(box));
      }
    }
    await capture(page, 'conversacion-' + width);
    if (narrow) {
      await options.click();
      assert.equal(await options.getAttribute('aria-expanded'), 'true');
      const panel = page.locator('[data-thread-options-panel]');
      await panel.locator('[data-thread-owner]').waitFor();
      await panel.locator('[data-thread-branch-chip]').waitFor();
      await panel.locator('[data-thread-mode]').waitFor();
      if (width === 390) await capture(page, 'opciones-390');
      const branch = panel.locator('[data-thread-branch-chip]');
      await branch.click();
      await panel.getByRole('menuitemradio', {name:/Centro/}).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await branch.getAttribute('aria-expanded'), 'false');
      assert.equal(await options.getAttribute('aria-expanded'), 'true', 'Cerrar el selector de sucursal conserva las opciones');
      await page.keyboard.press('Escape');
      assert.equal(await options.getAttribute('aria-expanded'), 'false');
      assert.equal(await options.evaluate(el => el === document.activeElement), true);
    }
    if (width === 1440) {
      const ficha = page.locator('[data-inbox-context-panel]');
      if (await ficha.getAttribute('aria-hidden') === 'false') await ficha.getByRole('button', {name:/cerrar.*ficha/i}).click();
      await page.waitForFunction(() => document.querySelector('.smyl-inbox-thread-head').clientWidth > 700);
      await options.waitFor({state:'hidden'});
      assert.equal(await page.locator('[data-thread-owner]').isVisible(), true);
      assert.equal(await page.locator('[data-thread-mode]').isVisible(), true);
    }
    if (width !== 390) return;
    const input = page.locator('#smyl-inbox-message');
    await checkText(page, '#smyl-inbox-message', 16);
    await input.fill('Confirmamos la cita.\nJueves a las 16:30.\nTe esperamos en la sucursal Centro.');
    const expanded = await bounds(page, '[data-inbox-composer]');
    assert.ok(expanded.height >= composer.height + 16, 'El editor crece al escribir varias líneas');
    await page.setViewportSize({width, height:510});
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-inbox-composer]').getBoundingClientRect().bottom - 510) <= 2);
    const keyboardLayout = await bounds(page, '[data-compose-send]');
    const bottomGap = 510 - keyboardLayout.y - keyboardLayout.height;
    assert.ok(bottomGap >= -1 && bottomGap <= 16, 'Distancia entre Enviar y el borde visible: ' + bottomGap);
    t.diagnostic('Enviar queda a ' + bottomGap + ' px del borde en una ventana de 510 px');
    await capture(page, 'redaccion-390');
    await input.fill('');
    await page.setViewportSize({width, height:844});
    const collapsed = await bounds(page, '[data-inbox-composer]');
    assert.ok(Math.abs(collapsed.height - composer.height) < 2, 'El editor vacío vuelve a su altura inicial');
    await page.locator('[data-compose-more]').click();
    await page.getByRole('menuitem', {name:'Respuesta rápida'}).click();
    await page.locator('[data-quick-dialog][open] [data-quick-close]').click();
    await schedule.click();
    await page.locator('[data-availability-dialog][open] [data-availability-close]').click();
    await page.locator('[data-inbox-back]').click();
    await page.locator('[data-inbox-search]').waitFor({state:'visible'});
    await page.waitForFunction(() => !document.querySelector('#p-inbox').style.getPropertyValue('--smyl-thread-available-height'));
  });
}

test('WhatsApp conserva la acción de plantilla en el editor móvil', async t => {
  if (!browser) return t.skip('Se necesita Chromium con Playwright.');
  const page = await openThreadPreview(t, 390, 'focus');
  const form = page.locator('[data-inbox-composer]');
  assert.equal(await form.getAttribute('data-mode'), 'template');
  await form.getByRole('button', {name:'Elegir plantilla aprobada'}).click();
  await page.locator('[data-template-dialog][open]').waitFor();
});

for (const [width, touch] of [[390, true], [820, true], [1440, false]]) {
  test('Jerarquía de texto del chat con la cascada de la aplicación a ' + width + ' px', async t => {
    if (!browser) return t.skip('Se necesita Chromium con Playwright.');
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: touch });
    t.after(() => page.close());
    page.setDefaultTimeout(5000);
    await page.route(/^https?:/, route => route.abort());
    await page.goto(preview.href);
    await page.locator('html[data-preview-ready=true]').waitFor();
    await loadAppStyles(page);

    const boardCard = page.locator('[data-pipeline-board] [data-conversation-id=c-preview]');
    await checkText(boardCard, '.smyl-inbox-pipeline-card-top strong', 14);
    await checkText(boardCard, '.smyl-inbox-pipeline-preview', 13);
    await checkText(boardCard, 'time', 12);

    await page.locator('[data-inbox-view=list]').click();
    const card = page.locator('[data-list-conversation-id=c-preview]');
    await checkText(card, '.smyl-inbox-row-top strong', 14);
    await checkText(card, '.smyl-inbox-preview', 13);
    await checkText(card, 'time', 12);
    await checkText(card, '[data-list-stage]', 13);
    assert.equal(await card.getByText('Etapa', { exact: true }).count(), 0, 'Sin rótulo redundante');
    const stage = card.getByRole('combobox', { name: 'Cambiar etapa de Ana López' });
    assert.equal(await stage.inputValue(), 'smyl:confirmed');
    if (touch) {
      const { height } = await stage.boundingBox();
      assert.ok(height >= 44, 'Altura táctil del estado: ' + height);
    }
    await checkText(page, '[data-inbox-search]', touch ? 16 : 13);

    await card.locator('button.smyl-inbox-row').click();
    await checkText(page, '[data-thread-name]', 14);
    await checkText(page, '[data-thread-messages] .smyl-inbox-bubble p', 14);
    await checkText(page, '.smyl-inbox-message-status', 12);
    await checkText(page, '#smyl-inbox-message', touch ? 16 : 14);

    const panel = page.locator('[data-inbox-context-panel]');
    if (await panel.getAttribute('aria-hidden') === 'true') await page.locator('[data-inbox-context]').click();
    await checkText(panel, '.smyl-f360-section-title', 13);
    const appointments = panel.locator('[data-f360-section=citas]');
    if (await appointments.getAttribute('aria-expanded') !== 'true') await appointments.click();
    await checkText(panel, '[data-section=f360-citas] .smyl-f360-group', 12);
  });
}
