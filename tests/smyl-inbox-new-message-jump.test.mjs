import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const preview = new URL('./fixtures/smyl-inbox-stage7-preview.html?focus&composer-tools', import.meta.url);
let browser;
before(async () => {
  try { browser = await require('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM, args:['--allow-file-access-from-files']}); }
  catch (error) { if (process.env.SMYL_CHROMIUM) throw error; }
});
after(async () => browser?.close());

for (const width of [390, 1440]) {
  test('Ir al final respeta el historial, la redacción y los mensajes nuevos a ' + width + ' px', async t => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page = await browser.newPage({ viewport:{width,height:820}, hasTouch:width<500 });
    t.after(() => page.close());
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const original = window.fetch;
        const base = Date.UTC(2026, 10, 1);
        const msg = i => ({ id:'msg-'+i, created_at:new Date(base+i*60000).toISOString(), author_type:'patient', role:'user', status:'sent', content:'Entrada de prueba '+i });
        window.jumpPhase = 0;
        window.jumpResponse = 0;
        window.fetch = async (input, init) => {
          const q = new URL(input,document.baseURI).searchParams;
          const response = await original(input,init);
          if (!['messages','list'].includes(q.get('action'))) return response;
          const data = await response.json();
          if (q.get('action') === 'list') {
            data.conversations.push({...data.conversations[0],id:'c-second',contact_name:'Otra persona'}); data.page.total = 2;
          } else if (q.get('conversation_id') === 'c-second') {
            data.conversation={...data.conversation,id:'c-second',contact_name:'Otra persona'}; data.messages=[msg(0)];
          } else if (q.has('since')) {
            data.messages = [msg(39),...Array.from({length:window.jumpPhase},(_,i)=>msg(40+i))];
            window.jumpResponse++;
          } else data.messages = Array.from({length:40},(_,i)=>msg(i));
          return Response.json(data);
        };
      },{once:true});
    });
    await page.goto(preview.href);
    await page.waitForSelector('html[data-preview-ready=true]');
    const body = page.locator('[data-thread-body]'), jump = page.locator('[data-thread-jump]'), composer = page.locator('[data-inbox-composer]');
    const poll = async phase => {
      const prev = await page.evaluate(phase => {
        const prev = window.jumpResponse;
        window.jumpPhase = phase; document.dispatchEvent(new Event('visibilitychange')); return prev;
      }, phase);
      await page.waitForFunction(prev => window.jumpResponse > prev,prev);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(()=>requestAnimationFrame(r))));
    };
    assert.equal(await jump.isVisible(),false);
    await body.evaluate(el => { el.scrollTop = el.scrollHeight / 3; });
    await jump.waitFor();
    assert.equal(await jump.getAttribute('aria-label'),'Ir al final');
    assert.equal(await jump.locator('span').isVisible(), await jump.evaluate(el => el.closest('.smyl-inbox-thread').clientWidth > 640));
    const start = await body.evaluate(el=>el.scrollTop);
    await poll(2); // Includes one already-seen id.
    assert.equal(await jump.innerText(),'2 mensajes nuevos');
    assert.ok(Math.abs((await body.evaluate(el=>el.scrollTop))-start)<3,'el historial no salta al llegar mensajes');
    await poll(2); // Identical reply from the provider.
    assert.equal(await jump.innerText(),'2 mensajes nuevos');
    const input = composer.locator('textarea');
    await input.fill('Texto en preparación');
    await poll(3); // Protected edit: new data waits to be painted.
    assert.equal(await jump.innerText(),'3 mensajes nuevos');
    const [button, editor, history] = await Promise.all([jump.boundingBox(),composer.boundingBox(),body.boundingBox()]);
    assert.ok(button.height >= 44 && button.y >= history.y && button.y+button.height <= editor.y, JSON.stringify({button,editor,history}));
    await jump.focus(); await jump.press('Enter');
    await jump.waitFor({state:'hidden'});
    assert.equal(await input.inputValue(),'Texto en preparación');
    assert.equal(await body.evaluate(el=>document.activeElement===el),true);
    assert.ok(await body.getByText('Entrada de prueba 42',{exact:true}).isVisible());
    await body.evaluate(el=>{el.scrollTop=150;});
    await jump.waitFor(); await poll(4);
    assert.equal(await jump.innerText(),'1 mensaje nuevo');
    await body.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await jump.waitFor({state:'hidden'});
    await body.evaluate(el=>{el.scrollTop=150;});
    await jump.waitFor(); await poll(5);
    await page.evaluate(()=>window.SmylInbox.open('c-second'));
    await page.locator('[data-thread-name]').getByText('Otra persona',{exact:true}).waitFor();
    assert.equal(await jump.isVisible(),false);
    assert.equal(await page.locator('[data-thread-jump-status]').textContent(),'');
  });
}
