import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
