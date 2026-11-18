import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const js = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const app = read('../app.html');
const worker = read('../sw.js');
const fixture = new URL('./fixtures/smyl-inbox-stage7-preview.html?focus=1&chat=agent', import.meta.url);
let browser;
before(async () => {
  try { browser = await createRequire(import.meta.url)('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM,args:['--allow-file-access-from-files']}); }
  catch (error) { if (process.env.SMYL_CHROMIUM) throw error; }
});
after(async () => { await browser?.close(); });

test('Mensajes ofrece la vista Pipeline junto a Conversaciones y la recuerda', () => {
  assert.match(js, /data-inbox-view="list"/);
  assert.match(js, /data-inbox-view="pipeline"/);
  assert.match(js, /function setInboxView/);
  assert.match(js, /sessionStorage\.setItem\('smyl_inbox_view'/);
  assert.match(js, /classList\.toggle\('view-pipeline'/);
});

test('el tablero integra las etapas clínicas con las de LANA y protege los movimientos concurrentes', () => {
  assert.match(js, /function pipelineColumns/);
  assert.match(js, /'Sin etapa'/);
  const move = js.slice(js.indexOf('async function saveConversationStage'), js.indexOf('function setInboxView'));
  assert.match(move, /action: 'stage'/);
  assert.match(move, /target_stage_id: stageId \|\| null/);
  assert.match(move, /expected_revision: revision/);
});

test('las tarjetas se mueven arrastrando o con «Mover a» y solo con permiso', () => {
  const card = js.slice(js.indexOf('function pipelineCard'), js.indexOf('function renderPipeline'));
  assert.match(card, /canTransfer\(item\)/);
  assert.match(card, /card\.draggable = movable/);
  assert.match(card, /dragstart/);
  assert.match(card, /'Mover a'/);
  assert.match(card, /setInboxView\('list'\); openConversation\(item\.id\)/);
});

test('el pipeline no marca como leídas conversaciones que nadie abrió', () => {
  assert.match(js, /window\.innerWidth > 760 && state\.view !== 'pipeline'/);
});

for (const mobile of [false,true]) {
  test('Agenda y movimientos manuales en las tarjetas de '+(mobile ? 'celular' : 'escritorio'), async t => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page = await browser.newPage({viewport:{width:mobile ? 390 : 1440,height:900},hasTouch:mobile,timezoneId:'Europe/Madrid'});
    t.after(() => page.close());
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const original = window.fetch;
        const model = window.pipelineFixture = {
          stage:'smyl:confirmed', source:'agenda', revision:2, status:'confirmed', moves:[], conflict:false, notify:false
        };
        function visit() {
          return {id:'visit-preview',starts_at:'2026-11-19T15:00:00Z',ends_at:'2026-11-19T16:00:00Z',status:model.status,timezone:'America/Mexico_City'};
        }
        function fields() {
          return {stage_id:model.stage,pipeline:{stage_id:model.stage,source:model.source,revision:model.revision,provider_stage_id:null},appointment:visit()};
        }
        window.fetch = async (url, init) => {
          const params = new URL(url,document.baseURI).searchParams;
          const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
          const action = params.get('action') || body.action;
          if (action === 'stages') return Response.json({stages:[]});
          if (action === 'stage') {
            model.moves.push([body.target_stage_id, body.expected_revision]);
            if (model.conflict || model.revision !== body.expected_revision) {
              model.conflict = false; model.stage = null; model.source = 'manual'; model.revision++;
              return Response.json({error:'Etapa actualizada por otro integrante'},{status:409});
            }
            model.stage = body.target_stage_id; model.source = 'manual'; model.revision++;
            return Response.json(fields());
          }
          if (action === 'sync') {
            const changed = model.notify; model.notify = false;
            return Response.json({conversations:[],synced_at:new Date().toISOString(),pipeline_changed:changed,pipeline_updates:changed ? [{id:'c-preview',...fields()}] : []});
          }
          const result = await original(url,init);
          if (action !== 'messages' && action !== 'list') return result;
          const data = await result.json();
          for (const row of data.conversations || [data.conversation]) Object.assign(row,fields());
          return Response.json(data);
        };
      },{once:true});
    });
    await page.goto(fixture.href + (mobile ? '&mobile=1' : ''));
    await page.waitForSelector('html[data-preview-ready=true]');
    const row = page.locator('[data-inbox-list] [data-conversation-id="c-preview"]');
    assert.match(await row.locator('.smyl-inbox-card-appointment').textContent(), /Cita confirmada.*0?9:00/);
    if (mobile) await page.locator('[data-inbox-back]').click();
    await page.locator('[data-inbox-view=pipeline]').click();
    const columns = page.locator('[data-pipeline-stage]');
    assert.deepEqual(await columns.locator('header strong').allTextContents(), ['Sin etapa','Cita confirmada','Llegó','Atendido']);
    const card = stage => page.locator('[data-pipeline-stage="'+stage+'"] article[data-conversation-id="c-preview"]');
    const status = page.locator('[data-pipeline-status]');
    await card('smyl:confirmed').locator('select').waitFor();
    if (mobile) await card('smyl:confirmed').locator('select').selectOption('smyl:arrived');
    else await card('smyl:confirmed').dragTo(page.locator('[data-pipeline-stage="smyl:arrived"] header'));
    await card('smyl:arrived').waitFor();
    assert.match(await card('smyl:arrived').textContent(), /Cita confirmada/);
    assert.match(await row.locator('.smyl-inbox-row-stage-line').textContent(), /Etapa · Llegó/);
    assert.deepEqual(await page.evaluate(() => window.pipelineFixture.moves), [['smyl:arrived',2]]);
    await page.evaluate(() => { window.pipelineFixture.conflict = true; });
    await card('smyl:arrived').locator('select').selectOption('smyl:attended');
    await card('').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-pipeline-status]').textContent.includes('La etapa cambió'));
    assert.equal(await card('').locator('select').inputValue(), '');
    await page.evaluate(() => {
      Object.assign(window.pipelineFixture,{status:'completed',stage:'smyl:attended',source:'agenda',notify:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await card('smyl:attended').waitFor();
    assert.equal(await card('smyl:attended').locator('.smyl-inbox-card-appointment').count(), 0);
    assert.equal(await card('smyl:attended').getByRole('button').getAttribute('aria-description'), 'Atendido');
    assert.equal(await row.locator('.smyl-inbox-card-appointment').count(), 0);
    assert.equal(await row.locator('.smyl-inbox-row-stage-line').textContent(), 'Etapa · Atendido');
    for (const [past, label] of [['cancelled','Cita cancelada'], ['no_show','No asistió']]) {
      await page.evaluate(past => {
        Object.assign(window.pipelineFixture,{status:past,stage:null,source:'none',notify:true});
        document.dispatchEvent(new Event('visibilitychange'));
      }, past);
      await page.waitForFunction(label => document.querySelector('[data-pipeline-stage=""] .smyl-inbox-pipeline-open')?.title === label, label);
      assert.equal(await row.locator('.smyl-inbox-card-appointment, .smyl-inbox-row-stage-line').count(), 0);
      assert.equal(await row.getAttribute('title'), label);
    }
    assert.ok(await status.isVisible());
    assert.deepEqual(errors, []);
  });
}

test('el tablero es horizontal en escritorio y desliza por columna en celular', () => {
  assert.match(css, /\.smyl-inbox-pipeline-board\{[^}]*overflow-x:auto/);
  assert.match(css, /\.smyl-inbox-page\.view-pipeline \.smyl-inbox-workspace>:not\(dialog\)\{display:none\}/);
  assert.match(css, /scroll-snap-type:x mandatory/);
  assert.match(css, /\.smyl-inbox-pipeline-move\{display:grid/);
});

test('sincroniza 205 tarjetas una vez por canal y recupera solo el lote de etapas fallido', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  t.after(() => page.close());
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const original = window.fetch;
      const initialCursor = '2026-11-18T10:00:00.000Z';
      const paging = window.paging = {phase:0, calls:[], originals:[]};
      const idAt = n => n === 0 ? 'c-preview' : 'card-'+n;
      const visit = id => ({id,stage_id:'smyl:arrived',pipeline:{stage_id:'smyl:arrived',source:'agenda',revision:1},appointment:{id:'visit-'+id,status:'arrived',starts_at:'2026-11-18T10:00:00Z'}});
      window.fetch = async (url, init) => {
        const p = new URL(url,document.baseURI).searchParams, action = p.get('action');
        if (action === 'list') {
          const data = await (await original(url,init)).json();
          const base = data.conversations[0];
          paging.originals = Array.from({length:205}, (_,i) => ({...base,id:idAt(i),contact_name:idAt(i),last_message_at:initialCursor,unread_count:0,pinned:i===0,stage_id:null}));
          const start = Number(p.get('offset')), limit = Number(p.get('limit'));
          data.conversations = paging.originals.slice(start,start+limit);
          data.page = {total:205,has_more:start+limit<205,next_offset:start+data.conversations.length};
          data.synced_at = initialCursor;
          return Response.json(data);
        }
        if (action !== 'sync' && action !== 'pipeline_updates') return original(url,init);
        const ids = p.get('visible_ids').split(','), since = p.get('since'), phase = paging.phase;
        if (phase) paging.calls.push({phase,action,ids,since});
        if (action === 'sync') {
          const promoted = {...paging.originals[204],pinned:true};
          return Response.json({conversations:phase===1 ? [promoted] : [],synced_at:phase ? '2026-11-18T10:01:00.000Z' : initialCursor});
        }
        if (phase === 1 && ids.includes('card-204')) return Response.json({error:'Sin respuesta temporal'},{status:503});
        const updates = phase ? ids.filter(id => ['card-130','card-204'].includes(id)).map(visit) : [];
        return Response.json({pipeline_updates:updates,removed_conversation_ids:phase===1 && ids.includes('card-131') ? ['card-131'] : [],pipeline_changed:!!updates.length});
      };
    },{once:true});
  });
  await page.goto(fixture.href);
  await page.waitForSelector('html[data-preview-ready=true]');
  await page.locator('[data-inbox-view=pipeline]').click();
  for (let count=60; count<=210; count+=30) {
    await page.locator('[data-pipeline-more]').click();
    await page.waitForFunction(n=>document.querySelectorAll('[data-pipeline-board] article').length===n,Math.min(count,205));
  }
  const poll = phase => page.evaluate(n => { window.paging.phase = n; document.dispatchEvent(new Event('visibilitychange')); },phase);
  await poll(1);
  await page.waitForFunction(()=>document.querySelector('[data-inbox-live] span').textContent.includes('pendientes de actualizar'));
  assert.equal(await page.locator('[data-pipeline-stage="smyl:arrived"] [data-conversation-id=card-130]').count(),1);
  assert.equal(await page.locator('[data-inbox-list] [data-conversation-id=card-131]').count(),0);
  const first = await page.evaluate(()=>window.paging.calls.filter(x=>x.phase===1));
  assert.equal(first.filter(x=>x.action==='sync').length,1);
  assert.deepEqual(first.map(x=>x.ids.length).sort((a,b)=>a-b),[5,100,100]);
  assert.equal(new Set(first.flatMap(x=>x.ids)).size,205);
  assert.deepEqual([...new Set(first.map(x=>x.since))],['2026-11-18T10:00:00.000Z']);
  await poll(2);
  await page.waitForSelector('[data-pipeline-stage="smyl:arrived"] [data-conversation-id=card-204]');
  const second = await page.evaluate(()=>window.paging.calls.filter(x=>x.phase===2));
  assert.equal(second.filter(x=>x.action==='sync').length,1);
  assert.equal(second.find(x=>x.action==='sync').since,'2026-11-18T10:01:00.000Z');
  assert.ok(second.find(x=>x.action==='sync').ids.includes('card-204'));
  const recovered = second.filter(x=>x.action==='pipeline_updates' && !x.since);
  assert.equal(recovered.length,1);
  assert.deepEqual(recovered[0].ids,first.find(x=>x.ids.includes('card-204')).ids);
});

test('web, móvil y PWA publican el pipeline', () => {
  assert.equal(read('../mobile/www/smyl-inbox.js'), js);
  assert.equal(read('../mobile/www/smyl-inbox.css'), css);
  assert.match(app, /smyl-inbox\.js\?v=70/);
  assert.match(app, /smyl-inbox\.css\?v=59/);
  assert.match(worker, /smyl-inbox\.js\?v=70/);
  assert.match(worker, /smyl-inbox\.css\?v=59/);
});

test('sin canales conectados el Inbox muestra una sola explicación en lugar de lista, hilo y compositor vacíos', () => {
  const js = read('../smyl-inbox.js');
  const css = read('../smyl-inbox.css');
  assert.match(js, /function renderOffline\(host\)/);
  assert.match(js, /workspace\.dataset\.state = 'offline'/);
  assert.match(js, /Conecta tus canales para atender mensajes aquí/);
  assert.match(js, /window\.ir\('conexiones'\)/);
  assert.match(js, /replace\(\/\\bde LANA\\b\/g, 'del servicio de mensajería'\)/);
  assert.match(css, /#p-inbox \[hidden\]\{display:none!important\}/);
  assert.match(css, /\.smyl-inbox-workspace\[data-state="offline"\]>main/);
});
