import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
let browser;
before(async () => {
  try {
    browser = await require('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM, args:['--allow-file-access-from-files']});
  } catch (e) { if (process.env.SMYL_CHROMIUM) throw e; }
});
after(async () => browser?.close());

for (const [width, board] of [[1440,false],[768,false],[390,false],[1440,true],[390,true]]) {
  test(`Ubicación y relevo en un hilo largo de ${board ? 'Pipeline' : 'Conversaciones'} a ${width}px`, async t => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page = await browser.newPage({viewport:{width,height:850}, hasTouch:width < 500});
    t.after(() => page.close());
    const mapRequests = [];
    page.on('request', req => { if (/^https:\/\/[^/]*(?:google|goo\.gl)/.test(req.url())) mapRequests.push(req.url()); });
    page.setDefaultTimeout(7000);
    const url = new URL('./fixtures/smyl-inbox-stage7-preview.html?chat-ux', import.meta.url);
    if (board) url.searchParams.set('pipeline-preview','1');
    await page.goto(url.href);
    await page.waitForSelector('html[data-preview-ready=true]');
    if (board) await page.getByRole('button',{name:'Abrir conversación con Ana López'}).click();
    const history = page.locator('[data-thread-body]');
    const card = history.getByRole('link',{name:/abrir mapa/i});
    await card.waitFor();
    assert.match(await card.getAttribute('href'), /^https:\/\/www\.google\.com\/maps\?/);
    assert.doesNotMatch(await history.innerText(),/www\.google\.com/);
    const note = page.locator('[data-handoff]');
    const trigger = note.locator('summary');
    await trigger.click();
    assert.match(await note.innerText(), /confirmar la sucursal/i);
    const popover = await note.locator('p').boundingBox();
    assert.ok(popover && popover.x >= 0 && popover.x + popover.width <= width+1);
    assert.doesNotMatch(await history.innerText(), /confirmar la sucursal/i);
    await trigger.press('Escape');
    assert.equal(await note.getAttribute('open'), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1), false);
    assert.deepEqual(mapRequests,[], 'leer la conversación no consulta servicios de mapas');
  });
}
