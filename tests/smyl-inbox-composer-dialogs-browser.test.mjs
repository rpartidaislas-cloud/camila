import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const fixture = new URL('./fixtures/smyl-inbox-stage7-preview.html?focus=1&composer-tools=1', import.meta.url);
const sizes = [[1440, 960], [1024, 900], [390, 844]];
let browser;
let skipReason;

before(async () => {
  try {
    browser = await require('playwright').chromium.launch({
      executablePath: process.env.SMYL_CHROMIUM,
      args: ['--allow-file-access-from-files'],
    });
  } catch (error) {
    if (process.env.SMYL_CHROMIUM) throw error;
    skipReason = 'Se necesita Playwright con Chromium.';
  }
});
after(async () => { await browser?.close(); });

async function openTool(page, name) {
  await page.locator('[data-compose-more]').click();
  await page.locator('[data-compose-' + name + ']').click();
}

async function checkLayout(page, dialog, name, width) {
  const metrics = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left), y: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height),
      horizontalOverflow: el.scrollWidth - el.clientWidth,
      clipped: r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1,
      offCenter: Math.abs((r.left + r.right) / 2 - innerWidth / 2),
    };
  });
  assert.ok(!metrics.clipped && metrics.horizontalOverflow <= 1 && metrics.offCenter <= 2, JSON.stringify(metrics));
  if (process.env.SMYL_QA_SHOTS) {
    await page.screenshot({path:path.join(process.env.SMYL_QA_SHOTS, name + '-' + width + '.png')});
  }
  return metrics;
}

for (const [width, height] of sizes) {
  test('El equipo puede redactar una respuesta y buscar emoji en el chat a ' + width + ' px', async (t) => {
    if (!browser) return t.skip(skipReason);
    const page = await browser.newPage({viewport:{width, height}, hasTouch:width < 500});
    t.after(() => page.close());
    page.setDefaultTimeout(6500);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(fixture.href + (width < 500 ? '&mobile=1' : ''));
    await page.waitForSelector('html[data-preview-ready="true"]');
    const input = page.locator('#smyl-inbox-message');
    await input.fill('Texto final');
    await input.evaluate((el) => el.setSelectionRange(0, 5));
    await openTool(page, 'emoji');
    const emoji = page.locator('[data-emoji-dialog][open]');
    const next = emoji.getByRole('button', {name:'Siguiente', exact:true});
    await next.waitFor();
    t.diagnostic('Catálogo ' + JSON.stringify(await checkLayout(page, emoji, 'catalogo', width)));
    const first = await emoji.locator('.smyl-emoji-item').first().textContent();
    await next.click();
    assert.notEqual(await emoji.locator('.smyl-emoji-item').first().textContent(), first);
    await emoji.locator('input[type="search"]').fill('diente');
    const tooth = emoji.getByRole('button', {name:'Insertar diente',exact:true});
    await tooth.waitFor();
    t.diagnostic('Emoji ' + JSON.stringify(await checkLayout(page, emoji, 'emoji', width)));
    await tooth.click();
    assert.equal(await input.inputValue(), '🦷 final');

    await openTool(page, 'quick');
    const quick = page.locator('[data-quick-dialog][open]');
    await quick.locator('[data-quick-new]').click();
    await quick.locator('[name="shortcut"]').fill('saludo');
    await quick.locator('[name="replyText"]').fill('Buen día');
    t.diagnostic('Redacción ' + JSON.stringify(await checkLayout(page, quick, 'respuesta', width)));
    await quick.locator('[data-quick-save]').click();
    const saved = quick.locator('.smyl-inbox-quick-row').filter({hasText:'Buen día'});
    await saved.waitFor();
    t.diagnostic('Biblioteca ' + JSON.stringify(await checkLayout(page, quick, 'respuesta-lista', width)));
    await saved.click();
    assert.equal(await input.inputValue(), '🦷Buen día final');
    await openTool(page, 'quick');
    await quick.locator('[data-quick-search]').fill('saludo');
    await quick.getByRole('button', {name:'Editar /saludo', exact:true}).click();
    await quick.locator('[name="replyText"]').fill('Hola de nuevo');
    await quick.locator('[data-quick-save]').click();
    await quick.locator('.smyl-inbox-quick-row').filter({hasText:'Hola de nuevo'}).waitFor();
    await page.keyboard.press('Escape');
    await quick.waitFor({state:'hidden'});
    await input.fill('/saludo');
    await quick.waitFor();
    t.diagnostic('Atajo ' + JSON.stringify(await checkLayout(page, quick, 'respuesta-atajo', width)));
    await quick.locator('.smyl-inbox-quick-row').filter({hasText:'Hola de nuevo'}).click();
    assert.equal(await input.inputValue(), 'Hola de nuevo');
    await openTool(page, 'quick');
    await quick.getByRole('button', {name:'Editar /saludo', exact:true}).click();
    page.once('dialog', (confirm) => confirm.accept());
    await quick.locator('[data-quick-delete]').click();
    await quick.locator('[data-quick-new]').waitFor();
    assert.equal(await quick.getByRole('button', {name:'Editar /saludo', exact:true}).count(), 0);
    await page.keyboard.press('Escape');
    await input.fill('hola, me gustaria conocer tus opciones me ayudas');
    await openTool(page, 'rewrite');
    await page.locator('[data-copilot-draft]').getByText('Texto corregido en la caja. Revísalo antes de enviar.').waitFor();
    assert.equal(await input.inputValue(), 'Hola, me gustaría conocer tus opciones. ¿Podrías ayudarme?');
    if (process.env.SMYL_QA_SHOTS) await page.screenshot({path:path.join(process.env.SMYL_QA_SHOTS, 'redaccion-aplicada-' + width + '.png')});
    await page.locator('[data-copilot-draft]').getByRole('button', {name:'Deshacer', exact:true}).click();
    assert.equal(await input.inputValue(), 'hola, me gustaria conocer tus opciones me ayudas');
    const composerMetrics = await page.locator('[data-compose-surface]').evaluate((el) => {
      const outer = el.parentElement.getBoundingClientRect();
      const inner = el.getBoundingClientRect();
      return {leftGap:Math.round(inner.left-outer.left), rightGap:Math.round(outer.right-inner.right), width:Math.round(inner.width)};
    });
    assert.ok(composerMetrics.leftGap <= 34 && composerMetrics.rightGap <= 34 && Math.abs(composerMetrics.leftGap-composerMetrics.rightGap) <= 1, JSON.stringify(composerMetrics));
    assert.doesNotMatch(await page.locator('[data-inbox-composer]').innerText(), /borrador/i);
    assert.deepEqual(errors, []);
  });
}
