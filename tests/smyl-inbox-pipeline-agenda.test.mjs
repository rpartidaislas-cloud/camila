import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const fixture = new URL('./fixtures/smyl-inbox-stage7-preview.html?focus=1', import.meta.url);
let browser;
before(async () => {
  try {
    browser = await createRequire(import.meta.url)('playwright').chromium.launch({
      executablePath:process.env.SMYL_CHROMIUM, args:['--allow-file-access-from-files'],
    });
  } catch (error) { if (process.env.SMYL_CHROMIUM) throw error; }
});
after(async () => browser?.close());

test('Citas de hoy usa el día de la sede, carga las siguientes páginas y combina búsqueda y cola', async (t) => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage({ viewport:{width:1440,height:900}, timezoneId:'Asia/Tokyo' });
  t.after(() => page.close());
  await page.clock.setFixedTime(new Date('2026-11-19T03:30:00Z'));
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const original = window.fetch;
      window.dayPageCalls = [];
      window.fetch = async (url, init) => {
        const params = new URL(url, document.baseURI).searchParams;
        if (params.get('action') !== 'list') return original(url, init);
        const result = await (await original(url, init)).json();
        const base = result.conversations[0];
        const data = Array.from({length:36}, (_,i) => ({...base,id:i === 0 ? 'c-preview' : 'c-'+i,contact_name:'Contacto '+i,unread_count:0}));
        function visit(i, status, time, timezone, stage, unread = 0) {
          Object.assign(data[i], { stage_id:stage, unread_count:unread,
            appointment:{id:'visit-'+i, status, starts_at:time, timezone}, contact_name:'Paciente '+i });
        }
        visit(1, 'confirmed', '2026-11-18T18:00:00Z', 'America/Mexico_City', 'smyl:confirmed');
        visit(2, 'confirmed', '2026-11-19T08:00:00Z', 'America/Mexico_City', 'smyl:confirmed');
        visit(3, 'cancelled', '2026-11-18T19:00:00Z', 'America/Mexico_City', null);
        visit(4, 'no_show', '2026-11-18T16:00:00Z', 'America/Mexico_City', null);
        // La segunda página incluye dos horarios UTC iguales en clínicas con fechas distintas.
        visit(32, 'confirmed', '2026-11-18T23:15:00Z', 'America/Mexico_City', 'smyl:confirmed', 1);
        visit(33, 'confirmed', '2026-11-18T18:00:00Z', 'Europe/Madrid', 'smyl:confirmed');
        visit(34, 'completed', '2026-11-18T18:00:00Z', 'America/Mexico_City', 'smyl:attended');
        visit(35, 'arrived', '2026-11-19T03:00:00Z', 'Europe/Madrid', 'smyl:arrived');
        const q = (params.get('q') || '').toLowerCase();
        const scoped = data.filter(item => (params.get('filter') !== 'unread' || item.unread_count) && item.contact_name.toLowerCase().includes(q));
        const start = Number(params.get('offset')), limit = Number(params.get('limit'));
        window.dayPageCalls.push({ start, limit, filter:params.get('filter'), q });
        return Response.json({ ...result, conversations:scoped.slice(start,start+limit),
          page:{ total:scoped.length, has_more:start+limit<scoped.length, next_offset:Math.min(start+limit,scoped.length) } });
      };
    }, {once:true});
  });
  await page.goto(fixture.href);
  await page.waitForSelector('html[data-preview-ready=true]');
  await page.locator('[data-inbox-view=pipeline]').click();
  const board = page.locator('[data-pipeline-board]');
  const today = page.getByRole('button',{name:'Citas de hoy'});
  await today.click();
  await board.locator('[data-conversation-id="c-35"]').waitFor();
  assert.equal(await today.getAttribute('aria-pressed'), 'true');
  const ids = () => board.locator('article').evaluateAll(cards => cards.map(card => card.dataset.conversationId).sort());
  assert.deepEqual(await ids(), ['c-1','c-32','c-34','c-35']);
  assert.ok((await page.evaluate(() => window.dayPageCalls)).some(call => call.start === 30));
  assert.equal(await board.locator('[data-conversation-id="c-32"] .smyl-inbox-card-appointment strong').count(), 0);
  assert.match(await board.locator('[data-conversation-id="c-34"] .smyl-inbox-card-appointment').textContent(), /18/);
  assert.equal(await board.getByRole('combobox', {name:'Cambiar etapa de Paciente 32'}).count(), 1);
  await page.locator('[data-inbox-pipeline] [data-inbox-filter=unread]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-pipeline-board] article').length === 1);
  assert.deepEqual(await ids(), ['c-32']);
  await page.locator('[data-inbox-pipeline] [data-inbox-filter=all]').click();
  await board.locator('[data-conversation-id="c-35"]').waitFor();
  await page.locator('[data-pipeline-search]').fill('Paciente 35');
  await page.waitForFunction(() => window.dayPageCalls.some(call => call.q === 'paciente 35') && document.querySelectorAll('[data-pipeline-board] article').length === 1);
  assert.deepEqual(await ids(), ['c-35']);
  await page.locator('[data-pipeline-search]').fill('');
  await board.locator('[data-conversation-id="c-1"]').waitFor();
  await page.locator('[data-inbox-view=list]').click();
  await page.locator('[data-inbox-list] [data-conversation-id="c-2"]').waitFor();
  assert.equal(await today.isVisible(), false);
});
