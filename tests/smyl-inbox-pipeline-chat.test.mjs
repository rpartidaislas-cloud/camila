import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const fixture = new URL('./fixtures/smyl-inbox-stage7-preview.html?pipeline-preview', import.meta.url);
let browser;
before(async () => {
  try {
    browser = await require('playwright').chromium.launch({
      executablePath:process.env.SMYL_CHROMIUM, args:['--allow-file-access-from-files'],
    });
  } catch (error) { if (process.env.SMYL_CHROMIUM) throw error; }
});
after(async () => browser?.close());

for (const width of [1680, 1024, 390]) {
  test('El chat del Pipeline permite responder, abrir la ficha, agendar y volver a ' + width + ' px', async t => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page = await browser.newPage({ viewport:{width,height:900}, hasTouch:width < 500 });
    t.after(() => page.close());
    page.setDefaultTimeout(6500);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.href);
    await page.waitForSelector('html[data-preview-ready=true]');
    const board = page.locator('[data-pipeline-board]');
    const open = board.getByRole('button', { name:'Abrir conversación con Ana López' });
    await open.scrollIntoViewIfNeeded();
    await open.focus();
    const boardPosition = await board.evaluate(el => el.scrollLeft);
    await open.press('Enter');
    const chat = page.locator('[data-inbox-thread-pane]');
    const back = chat.getByRole('button', { name:'Volver al Pipeline', exact:true });
    const message = chat.locator('[name=message]');
    await chat.getByText('Gracias, nos vemos en la consulta.', {exact:true}).waitFor();
    assert.equal(await page.locator('[data-inbox-view=pipeline]').getAttribute('aria-selected'), 'true');
    if (width >= 1400) {
      const [columns, panel] = await Promise.all([board.boundingBox(),chat.boundingBox()]);
      assert.ok(columns.width > 400 && panel.width > 330 && columns.x + columns.width <= panel.x + 1, 'columnas y chat tienen su propio espacio');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    for (const selector of ['[data-compose-more]','[data-compose-send]','[data-compose-copilot]','[data-thread-primary-action="schedule"]']) {
      const control = await chat.locator(selector).boundingBox();
      const box = await chat.boundingBox();
      assert.ok(control && control.width > 0 && control.x >= box.x - 1 && control.x + control.width <= box.x + box.width + 1, selector);
    }
    if (process.env.SMYL_QA_SHOTS) await page.screenshot({path:path.join(process.env.SMYL_QA_SHOTS, 'pipeline-chat-'+width+'.png')});
    await chat.locator('[data-compose-more]').click();
    await chat.getByRole('menuitem',{name:'Respuesta rápida'}).click();
    const quickDialog = page.locator('[data-quick-dialog][open]');
    await quickDialog.waitFor();
    await quickDialog.locator('[data-quick-close]').click();
    await chat.locator('[data-thread-primary-action="schedule"]').click();
    await page.locator('[data-availability-dialog][open] [data-availability-close]').click();
    await chat.locator('[data-inbox-context]').click();
    const profile = page.locator('[data-inbox-context-panel]');
    await profile.getByRole('heading',{name:'Ana López'}).waitFor();
    await profile.locator('.smyl-inbox-context-close').click();
    await message.fill('Nos vemos en recepción.');
    await chat.locator('[data-compose-send]').click();
    await chat.locator('[data-thread-messages]').getByText('Nos vemos en recepción.',{exact:true}).waitFor();
    await back.click();
    await board.waitFor({state:'visible'});
    await page.waitForFunction(() => !document.getElementById('p-inbox').classList.contains('pipeline-chat-open'));
    assert.equal(await open.getAttribute('aria-expanded'), 'false');
    assert.equal(await open.evaluate(el => document.activeElement === el), true);
    if (width < 500) {
      assert.ok(boardPosition > 0);
      assert.ok(Math.abs(await board.evaluate(el => el.scrollLeft) - boardPosition) <= 2, 'vuelve a la misma columna');
    }
    assert.deepEqual(errors, []);
  });
}

test('Un envío en tránsito permanece en el chat de origen al abrir otra tarjeta', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage({viewport:{width:1680,height:900}});
  t.after(() => page.close());
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const original = window.fetch;
      window.fetch = async (url, init) => {
        if (typeof init?.body === 'string' && JSON.parse(init.body).action === 'send') {
          await new Promise(resolve => { window.finishPipelineSend = resolve; });
        }
        return original(url, init);
      };
    });
  });
  await page.goto(fixture.href);
  await page.waitForSelector('html[data-preview-ready=true]');
  const board = page.locator('[data-pipeline-board]');
  const open = name => board.getByRole('button', {name:'Abrir conversación con ' + name});
  await open('Ana López').click();
  await page.locator('[data-thread-name]').getByText('Ana López',{exact:true}).waitFor();
  await page.locator('[name=message]').fill('Mensaje exclusivo de Ana');
  await page.locator('[data-compose-send]').click();
  await page.waitForFunction(() => typeof window.finishPipelineSend === 'function');
  await open('Elena Cruz').click();
  await page.locator('[data-thread-name]').getByText('Elena Cruz',{exact:true}).waitFor();
  await page.evaluate(() => window.finishPipelineSend());
  await open('Ana López').getByText('Mensaje exclusivo de Ana',{exact:true}).waitFor();
  assert.equal(await open('Elena Cruz').getByText('Mensaje exclusivo de Ana').count(),0);
  assert.equal(await page.locator('[data-thread-messages]').getByText('Mensaje exclusivo de Ana').count(),0);
});

test('Cerrar el chat durante la carga conserva el tablero y los mensajes sin leer', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  t.after(() => page.close());
  page.setDefaultTimeout(6000);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const original = window.fetch;
      window.panelReads = [];
      window.fetch = async (url, init) => {
        const params = new URL(url, document.baseURI).searchParams;
        if (params.get('action') === 'messages' && params.get('conversation_id') === 'c-mateo') {
          await new Promise(resolve => { window.releaseChatLoad = resolve; });
        }
        if (typeof init?.body === 'string') {
          const body = JSON.parse(init.body);
          if (body.action === 'read') window.panelReads.push(body.conversation_id);
        }
        const response = await original(url,init);
        if (params.get('action') === 'messages' && params.get('conversation_id') === 'c-mateo') window.loadFinished = true;
        return response;
      };
    });
  });
  await page.goto(fixture.href);
  await page.waitForSelector('html[data-preview-ready=true]');
  const board = page.locator('[data-pipeline-board]');
  const card = board.getByRole('button',{name:'Abrir conversación con Mateo Ruiz'});
  await card.click();
  await page.locator('[data-pipeline-cancel]').click();
  await page.evaluate(() => window.releaseChatLoad());
  await page.waitForFunction(() => window.loadFinished);
  await board.getByRole('button',{name:'Abrir conversación con Elena Cruz'}).click();
  await page.locator('[data-thread-name]').getByText('Elena Cruz',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.panelReads), []);
  assert.equal(await card.getAttribute('aria-expanded'), 'false');
  assert.equal(await card.locator('.smyl-inbox-pipeline-unread').innerText(),'1');
});

test('Un permiso de micrófono tardío se libera al cambiar de contacto', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  t.after(() => page.close());
  page.setDefaultTimeout(6000);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      window.allowPipelineMicrophone = () => resolve({getTracks:() => [{stop:() => { window.microphoneReleased = true; }}]});
    });
  });
  await page.goto(fixture.href);
  await page.waitForSelector('html[data-preview-ready=true]');
  const board = page.locator('[data-pipeline-board]');
  await board.getByRole('button',{name:'Abrir conversación con Ana López'}).click();
  await page.locator('[data-compose-more]').click();
  await page.locator('[data-compose-record]').click();
  await page.waitForFunction(() => !!window.allowPipelineMicrophone);
  await board.getByRole('button',{name:'Abrir conversación con Elena Cruz'}).click();
  await page.locator('[data-thread-name]').getByText('Elena Cruz',{exact:true}).waitFor();
  await page.evaluate(() => window.allowPipelineMicrophone());
  await page.waitForFunction(() => window.microphoneReleased);
  assert.equal(await page.locator('[data-compose-context]').isVisible(), false);
});
