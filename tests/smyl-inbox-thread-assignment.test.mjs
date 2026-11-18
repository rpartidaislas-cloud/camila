import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';

const js = await readFile(new URL('../smyl-inbox.js', import.meta.url), 'utf8');
const fixture = new URL('./fixtures/smyl-inbox-stage7-preview.html?focus=1', import.meta.url);
const require = createRequire(import.meta.url);
let browser;
before(async () => {
  try { browser = await require('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM, args:['--allow-file-access-from-files']}); }
  catch (error) { if (process.env.SMYL_CHROMIUM) throw error; }
});
after(async () => { await browser?.close(); });

test('El responsable es explícito: no se autoasigna al abrir y sólo el equipo con permiso puede cambiarlo', () => {
  const header = js.slice(js.indexOf('<header class="smyl-inbox-thread-head"'), js.indexOf('</header>', js.indexOf('<header class="smyl-inbox-thread-head"')));
  assert.match(header, /data-thread-owner/);
  assert.doesNotMatch(header, /data-thread-more|Más acciones/);
  const assign = js.slice(js.indexOf('async function changeChatOwner('), js.indexOf('async function loadTeam('));
  assert.match(assign, /conversation.id !== conversationId/);
  assert.match(assign, /canOperate\(conversation, 'messages\.manage'\)/);
  assert.match(assign, /state\.team\.some/);
  assert.match(assign, /action: targetId \? 'assign' : 'release'/);
  assert.doesNotMatch(assign, /targetId \|\| state\.actor/);
});

for (const width of [1440, 1024, 390]) {
  test('Asigna a recepción o dentista sin perder Agendar cita a '+width+' px', async (t) => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page = await browser.newPage({viewport:{width,height:900},hasTouch:width<500});
    t.after(() => page.close()); page.setDefaultTimeout(6000);
    const errors=[]; page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.href+(width<500 ? '&mobile=1' : ''));
    await page.waitForSelector('html[data-preview-ready=true]');
    const assign=page.locator('[data-thread-assign]'), menu=page.locator('[data-thread-more]'), schedule=page.locator('[data-thread-primary-action="schedule"]');
    async function checkWidth() {
      const header = await page.locator('.smyl-inbox-thread-head').boundingBox();
      for(const control of [assign,schedule]) {
        const box=await control.boundingBox(); assert.ok(box && box.width>0 && box.x>=header.x-1 && box.x+box.width<=header.x+header.width+1,'Header action fits at '+width);
      }
    }
    await checkWidth();
    await assign.selectOption('desk-preview');
    await page.waitForFunction(() => document.querySelector('[data-thread-owner-name]').textContent === 'Sofía · Recepción');
    await assign.selectOption('owner-preview');
    await page.waitForFunction(() => document.querySelector('[data-thread-owner-name]').textContent === 'Dra. Mariana');
    await assign.selectOption('');
    await page.waitForFunction(() => document.querySelector('[data-thread-owner-name]').textContent === 'Sin asignar');
    await menu.click(); await page.locator('[data-thread-menu]:not([hidden])').waitFor(); await page.keyboard.press('Escape');
    const expand=page.locator('[data-inbox-context]');
    if (await expand.getAttribute('aria-expanded')!=='true') await expand.click();
    await checkWidth(); assert.deepEqual(errors,[]);
  });
}
