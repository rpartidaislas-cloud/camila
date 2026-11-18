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
  const assign = js.slice(js.indexOf('function changeChatOwner('), js.indexOf('async function loadTeam('));
  assert.match(assign, /conversation.id !== conversationId/);
  assert.match(assign, /canTransfer\(conversation\)/);
  assert.match(assign, /roster\.members\.find/);
  assert.match(assign, /expected_version: version/);
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
    const dialog = page.locator('[data-chat-transfer][open]');
    await dialog.locator('textarea').fill('Llamar después de las cuatro.');
    await dialog.locator('[type=submit]').click();
    await page.locator('[data-handoff] summary').click();
    assert.equal(await page.locator('[data-handoff] p').innerText(), 'Llamar después de las cuatro.');
    assert.ok(!(await page.locator('[data-thread-messages]').innerText()).includes('Llamar después de las cuatro.'));
    assert.equal(await page.locator('[name=message]').inputValue(), '');
    await page.waitForFunction(() => document.querySelector('[data-thread-owner-name]').textContent === 'Sofía · Recepción');
    await assign.selectOption('owner-preview');
    await dialog.locator('[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('[data-thread-owner-name]').textContent === 'Dra. Mariana');
    await assign.selectOption('');
    await dialog.locator('[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('[data-thread-owner-name]').textContent === 'Sin asignar');
    assert.equal(await menu.count(), 0);
    const expand=page.locator('[data-inbox-context]');
    if (await expand.getAttribute('aria-expanded')!=='true') await expand.click();
    await checkWidth(); assert.deepEqual(errors,[]);
  });
}

test('El selector consulta cada chat y sede, descarta respuestas fuera de orden y permite reintentar', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const previewFetch = window.fetch;
      window.rosterRequests = [];
      window.secondBranch = 'centro';
      let attemptedSouth = false;
      window.fetch = async (input, init) => {
        const params = new URL(input, document.baseURI).searchParams;
        const action = params.get('action'), id = params.get('conversation_id');
        const branch = id === 'c-preview' ? 'norte' : window.secondBranch;
        if (action === 'team') {
          window.rosterRequests.push(id + '/' + branch);
          if (id === 'c-preview') await new Promise(resolve => { window.releaseNorth = resolve; });
          if (branch === 'sur' && !attemptedSouth) {
            attemptedSouth = true;
            return Response.json({error:'Equipo temporalmente no disponible'},{status:503});
          }
          return Response.json({members:[{id:'shared',name:'Ambas sedes'},{id:branch,name:branch}]});
        }
        if (!['list','messages'].includes(action)) return previewFetch(input, init);
        const response = await (await previewFetch(input, init)).json();
        function located(base, convoId, site) {
          return {...base,id:convoId,branch:{id:site,name:site},contact_name:convoId};
        }
        if (action === 'messages') response.conversation = located(response.conversation, id, branch);
        else {
          const [base] = response.conversations;
          response.conversations = [located(base,'c-preview','norte'),located(base,'c-second',window.secondBranch)];
          response.page.total = 2;
        }
        return Response.json(response);
      };
    }, {once:true});
  });
  await page.goto(fixture.href);
  await page.waitForSelector('html[data-preview-ready=true]');
  await page.waitForFunction(() => typeof window.releaseNorth === 'function');
  const assign = page.locator('[data-thread-assign]');
  const members = () => assign.locator('option:not(:disabled)').evaluateAll(options => options.map(option => option.value));
  const openSecond = () => page.evaluate(() => window.SmylInbox.open('c-second'));
  await openSecond();
  await assign.locator('option[value=centro]').waitFor({state:'attached'});
  await page.evaluate(() => window.releaseNorth());
  await openSecond();
  assert.deepEqual(await members(), ['', 'shared', 'centro']);
  assert.deepEqual(await page.evaluate(() => window.rosterRequests), ['c-preview/norte', 'c-second/centro']);

  await page.evaluate(() => { window.secondBranch = 'sur'; });
  await openSecond();
  const retry = page.locator('[data-thread-owner-retry]');
  await retry.waitFor();
  assert.ok(await assign.isDisabled());
  assert.ok(!(await members()).includes('centro'));
  await retry.click();
  await assign.locator('option[value=sur]').waitFor({state:'attached'});
  assert.deepEqual(await members(), ['', 'shared', 'sur']);

  await page.locator('[data-inbox-bulk]').evaluate(button => button.click());
  for (const id of ['c-preview','c-second']) await page.locator('[data-conversation-id="'+id+'"].smyl-inbox-row').click();
  const bulk = page.getByRole('combobox', {name:'Responsable para seleccionadas'});
  assert.deepEqual(await bulk.locator('option').evaluateAll(options => options.map(option => option.value)), ['', 'shared']);
  assert.deepEqual(await page.evaluate(() => window.rosterRequests), ['c-preview/norte','c-second/centro','c-second/sur','c-second/sur']);
});

test('Al transferir su conversación el agente pierde el hilo incluso desde el enlace directo', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(fixture.href+'&chat=agent');
  await page.waitForSelector('html[data-preview-ready=true]');
  const assign=page.locator('[data-thread-assign]');
  await assign.selectOption('desk-preview');
  await page.locator('[data-chat-transfer] textarea').fill('Contactar por la tarde');
  await page.locator('[data-chat-transfer] [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('[data-inbox-thread]').hidden);
  await page.evaluate(()=>window.SmylInbox.open('c-preview'));
  assert.equal(await page.locator('[data-conversation-id="c-preview"]').count(),0);
  assert.equal(await page.locator('[data-inbox-thread]').isVisible(),false);
});

test('Sin acceso oculta la navegación y bloquea la apertura directa', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page=await browser.newPage();
  t.after(()=>page.close());
  await page.goto(fixture.href+'&chat=none');
  await page.waitForSelector('html[data-smyl-chat-access=none]');
  await page.evaluate(()=>window.SmylInbox.open('c-preview'));
  assert.equal(await page.locator('[data-inbox-thread]').isVisible(),false);
  assert.equal(await page.locator('[data-conversation-id="c-preview"]').count(),0);
  assert.match(await page.locator('[data-chat-access-status]').innerText(), /no tiene acceso/);
});

test('Dos sesiones comparten el relevo sin publicar la nota en el canal del paciente', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  let owner = 'owner-preview', version = 1, note = '', sends = 0;
  async function login(id) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.exposeFunction('handoffBackend', (action, payload) => {
      if (action === 'send') sends++;
      if (action === 'assign') {
        if (id !== owner) return {status:403, code:'conversation_scope_denied'};
        if (payload.expected_version !== version) return {status:409};
        owner = payload.target_actor_id; note = payload.private_note; version++;
      }
      return {owner, version, note:id === owner ? note : ''};
    });
    await page.addInitScript(actorId => {
      document.addEventListener('DOMContentLoaded', () => {
        const previewFetch = window.fetch;
        window.fetch = async (input, init) => {
          const q = new URL(input, document.baseURI).searchParams;
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
          const action = q.get('action') || body.action;
          if (!['access','branches','list','messages','assign','send'].includes(action)) return previewFetch(input,init);
          const result = await window.handoffBackend(action,body);
          const actor = {id:actorId,role:'staff',chat_access:'agent',permissions:['messages.read','messages.respond']};
          let response = {actor};
          if (result.status) return Response.json(result,{status:result.status});
          if (action === 'list' || action === 'messages') {
            if (action === 'messages' && result.owner !== actorId) return Response.json({code:'conversation_scope_denied'},{status:403});
            response = await (await previewFetch(input,init)).json();
            const conversation = (response.conversations || [response.conversation])[0];
            conversation.assignment = {actor_id:result.owner,name:result.owner === 'desk-preview' ? 'Sofía · Recepción' : 'Dra. Mariana'};
            conversation.assignment_version = result.version;
            if (action === 'messages') conversation.private_handoff_note = result.note;
            if (action === 'list') {
              response.actor = actor;
              response.conversations = actorId === result.owner ? [conversation] : [];
              response.page.total = response.conversations.length;
            }
          }
          if (action === 'assign') response = {assigned_actor_id:result.owner,assigned_actor_name:'Sofía · Recepción',assignment_version:result.version,private_handoff_note:null};
          return Response.json(response);
        };
      },{once:true});
    }, id);
    await page.goto(fixture.href);
    await page.waitForSelector('html[data-preview-ready=true]');
    return page;
  }
  const sender=await login('owner-preview'), recipient=await login('desk-preview');
  assert.equal(await recipient.locator('.smyl-inbox-row').count(),0);
  const select=sender.locator('[data-thread-assign]');
  await select.selectOption('desk-preview');
  await sender.locator('[data-chat-transfer] textarea').fill('Pidió que le llamemos por la tarde.');
  await sender.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal(owner,'owner-preview'); assert.equal(version,1);
  await select.selectOption('desk-preview');
  await sender.locator('[data-chat-transfer] textarea').fill('Pidió que le llamemos por la tarde.');
  await sender.locator('[data-chat-transfer] [type=submit]').click();
  await sender.waitForFunction(()=>document.querySelector('[data-inbox-thread]').hidden);
  await recipient.evaluate(()=>window.SmylInbox.open('c-preview'));
  await recipient.locator('[data-handoff] summary').click();
  assert.equal(await recipient.locator('[data-handoff] p').innerText(),note);
  assert.ok(!(await recipient.locator('[data-thread-messages]').innerText()).includes(note));
  assert.equal(sends,0);
});
