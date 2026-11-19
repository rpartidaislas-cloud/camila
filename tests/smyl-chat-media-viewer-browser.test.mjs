import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const fixture = '/tests/fixtures/smyl-inbox-stage7-preview.html';
let browser, server, base;
const mime = { html:'text/html', js:'text/javascript', mjs:'text/javascript', css:'text/css', png:'image/png', wasm:'application/wasm' };

const pdfFixture = await readFile(new URL('./fixtures/chat-media-ejemplo.pdf', import.meta.url));

before(async () => {
  let playwright;
  try { playwright = require('playwright'); } catch (error) { if (process.env.SMYL_CHROMIUM) throw error; return; }
  try { browser = await playwright.chromium.launch({executablePath:process.env.SMYL_CHROMIUM}); }
  catch (error) { if (process.env.SMYL_CHROMIUM) throw error; return; }
  server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (pathname === '/tests/fixtures/chat-media-ejemplo.pdf') {
      res.writeHead(200, {'Content-Type':'application/pdf', 'Cache-Control':'no-store'}).end(pdfFixture);
      return;
    }
    const allowed = pathname === fixture || pathname === '/icons/icon-512.png' || /^\/smyl-[\w-]+\.(js|css)$/.test(pathname) || /^\/vendor\/[\w./-]+$/.test(pathname);
    if (!allowed) return res.writeHead(404).end();
    try {
      const file = await readFile(new URL(pathname.slice(1), root));
      res.writeHead(200, {'Content-Type':mime[pathname.split('.').pop()] || 'application/octet-stream'}).end(file);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = 'http://127.0.0.1:'+server.address().port;
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openInbox(t, width, pipeline = false) {
  const page = await browser.newPage({viewport:{width,height:width <= 500 ? 844 : 900}, hasTouch:width <= 850});
  t.after(() => page.close());
  page.setDefaultTimeout(9000);
  await page.addInitScript(() => {
    const fetchFile = window.fetch.bind(window);
    addEventListener('DOMContentLoaded', () => {
      const fixtureFetch = window.fetch;
      window.mediaSends = 0;
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input, location.href);
        if (url.origin === location.origin || url.protocol === 'blob:') return fetchFile(input, init);
        if (init?.body instanceof FormData) window.mediaSends++;
        return fixtureFetch(input, init);
      };
    }, {once:true});
  });
  await page.goto(base+fixture+(pipeline ? '?pipeline-preview&media-preview' : '?media-preview'));
  await page.waitForSelector('html[data-preview-ready=true]');
  if (pipeline) await page.getByRole('button',{name:'Abrir conversación con Ana López'}).click();
  return page;
}

for (const width of [1440, 820, 390]) {
  test('Abre la miniatura, amplía y anota una copia a '+width+' px', async t => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page = await openInbox(t, width, width !== 820);
    const opener = page.locator('[data-thread-messages] [data-chat-media-open="image"]');
    await opener.click();
    const dialog = page.locator('dialog[data-smyl-media-dialog][open]');
    const stage = dialog.locator('[data-media-stage]');
    const pen = dialog.getByRole('button',{name:'Plumón',exact:true});
    await pen.waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-smyl-media-dialog] button[aria-label="Plumón"]')?.disabled);
    const rect = await stage.boundingBox();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const range = dialog.getByRole('slider',{name:'Zoom'});
    const before = Number(await range.inputValue());
    if (width === 390) {
      const cdp = await page.context().newCDPSession(page);
      const points = distance => [{id:1,x:x-distance,y},{id:2,x:x+distance,y}];
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(22)});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(50)});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await cdp.detach();
    } else {
      await page.mouse.move(x,y);
      await page.mouse.wheel(0,-160);
    }
    await page.waitForFunction(value => Number(document.querySelector('input[aria-label="Zoom"]').value) > value, before);
    await range.press('End');
    const plane = dialog.locator('.cmv-plane');
    const atStart = await plane.boundingBox();
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(x-42,y-40,{steps:6});
    await page.mouse.up();
    const afterPan = await plane.boundingBox();
    assert.ok(atStart.y - afterPan.y > 20, 'La imagen ampliada se desplaza al arrastrarla');
    await dialog.getByRole('button',{name:'Ajustar a la ventana',exact:true}).click();
    await pen.click();
    await dialog.getByRole('button',{name:'Color azul',exact:true}).click();
    await dialog.getByRole('combobox',{name:'Grosor'}).selectOption('2');
    await page.mouse.move(x - 24, y);
    await page.mouse.down();
    await page.mouse.move(x+24, y+25, {steps:6});
    await page.mouse.up();
    const undo = dialog.getByRole('button',{name:'Deshacer',exact:true});
    const redo = dialog.getByRole('button',{name:'Rehacer',exact:true});
    await undo.click();
    await redo.click();
    assert.equal(await dialog.locator('[data-media-ink] polyline').getAttribute('stroke'), '#1689e4');
    if (process.env.SMYL_QA_SHOTS) await page.screenshot({path:join(process.env.SMYL_QA_SHOTS,'visor-chat-'+width+'.png')});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1), false);
    await dialog.getByRole('button',{name:'Adjuntar copia al chat',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const draft = page.locator('[data-compose-context]');
    await draft.waitFor({state:'visible'});
    assert.match(await draft.innerText(),/\.(?:png|jpe?g)/i);
    assert.equal(await page.evaluate(() => window.mediaSends),0);
    assert.match(await opener.locator('img').getAttribute('src'), /icon-512\.png/);
  });
}

test('Lee un PDF de dos páginas y descarga una copia con trazos sobre la página rotada', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await openInbox(t, 1360);
  await page.locator('[data-thread-messages] [data-chat-media-open="pdf"]').click();
  const dialog = page.locator('dialog[data-smyl-media-dialog][open]');
  const next = dialog.getByRole('button',{name:'Página siguiente',exact:true});
  await next.click();
  await dialog.getByRole('button',{name:'Página anterior',exact:true}).waitFor();
  const stage = dialog.locator('[data-media-stage]');
  await dialog.getByRole('button',{name:'Plumón', exact:true}).click();
  const rect = await stage.boundingBox();
  const x = rect.x+rect.width/2, y = rect.y+rect.height/2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x+30,y+15,{steps:8});
  await page.mouse.up();
  await dialog.getByRole('button',{name:'Texto',exact:true}).click();
  await page.mouse.click(x - 25, y - 45);
  await dialog.getByRole('textbox',{name:'Texto de la anotación'}).fill('Revisar esta zona');
  await dialog.getByRole('button',{name:'Colocar texto',exact:true}).click();
  assert.equal(await dialog.locator('[data-media-ink] text').textContent(),'Revisar esta zona');
  await dialog.getByRole('button',{name:'Cerrar visor',exact:true}).click();
  await dialog.getByRole('button',{name:'Seguir editando',exact:true}).click();
  const completed = page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Descargar copia',exact:true}).click();
  const download = await completed;
  assert.match(download.suggestedFilename(),/\.pdf$/i);
  const exported = await readFile(await download.path());
  assert.equal(exported.subarray(0,5).toString(),'%PDF-');
  assert.notDeepEqual(exported,pdfFixture);
  assert.equal(await page.evaluate(() => window.mediaSends),0);
});

test('La copia PDF conserva el texto y sitúa los trazos en la zona anotada en las cuatro orientaciones', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/prueba-del-lector', route => route.fulfill({contentType:'text/html', body:'<!doctype html><html lang="es"></html>'}));
  await page.goto(base + '/prueba-del-lector');
  await page.addScriptTag({url:base + '/smyl-chat-pdf.js'});
  const result = await page.evaluate(async () => {
    const lib = await import('/vendor/pdf-lib-1.17.1.min.mjs');
    const reader = await import('/vendor/pdfjs-6.5.438/pdf.min.mjs');
    const source = await lib.PDFDocument.create();
    for (const angle of [0, 90, 180, 270]) {
      const sheet = source.addPage([220, 300]);
      sheet.setCropBox(17, 29, 150, 191);
      sheet.setRotation(lib.degrees(angle));
      sheet.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(2));
      sheet.drawText('Original ' + angle, {x:25, y:92, size:12});
    }
    const blob = new Blob([await source.save()], {type:'application/pdf'});
    const original = await window.SmylChatPdf.open(blob);
    const marks = new Map();
    for (let n=1; n<=original.pageCount; n++) {
      marks.set(n, [{tool:'pen', color:'#f00010', size:.05, points:[{x:.27, y:.72}]},
        {tool:'text', color:'#2244bb', size:.04, x:.12, y:.14, text:'Nota\nRevisión 雪'}]);
    }
    const copy = await original.exportCopy(marks);
    const annotated = await window.SmylChatPdf.open(copy);
    const extractor = reader.getDocument({data:new Uint8Array(await copy.arrayBuffer())});
    const extracted = await extractor.promise;
    const checks = [];
    try {
      for (let n=1; n<=original.pageCount; n++) {
        const sample = async doc => {
          const canvas = document.createElement('canvas');
          await doc.render(n, canvas, 1);
          const context = canvas.getContext('2d');
          const value = Array.from(context.getImageData(Math.round(canvas.width * .27), Math.round(canvas.height * .72), 1, 1).data);
          canvas.width = canvas.height = 0;
          return value;
        };
        const content = await (await extracted.getPage(n)).getTextContent();
        checks.push({ before:await sample(original), after:await sample(annotated), text:content.items.map(item=>item.str).join(' ') });
      }
    } finally {
      await Promise.all([extractor.destroy(), original.destroy(), annotated.destroy()]);
    }
    return checks;
  });
  assert.equal(result.length,4);
  result.forEach(({before, after, text}, index) => {
    assert.deepEqual(before,[255,255,255,255]);
    assert.ok(after[0] >= 230 && after[1] < 35 && after[2] < 55, 'Marca fuera de lugar en la página ' + (index + 1) + ': ' + after);
    assert.match(text, new RegExp('Original ' + (index * 90)));
  });
});

async function expireImageLink(page, denied) {
  await page.evaluate(rejectAccess => {
    const original = window.messages.find(item => item.id === 'img-test');
    const fetchNormally = window.fetch.bind(window);
    window.mediaRequests = { expired:0, renewed:0, other:0, query:null };
    window.fetch = (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input, location.href);
      if (target.pathname === '/icons/icon-512.png') {
        if (target.searchParams.has('renewed')) {
          window.mediaRequests.renewed++;
          return fetchNormally(input, init);
        }
        if (target.searchParams.has('other')) window.mediaRequests.other++;
        else window.mediaRequests.expired++;
        return Promise.resolve(new Response(null, {status:403}));
      }
      const query = target.searchParams;
      if (query.get('action') === 'messages' && query.has('before') && query.has('since')) {
        window.mediaRequests.query = { id:query.get('conversation_id'), since:query.get('since'), before:query.get('before'), created:original.created_at };
        if (rejectAccess) return Promise.resolve(Response.json({code:'conversation_scope_denied',error:'Se transfirió el chat.'}, {status:403}));
        const validItem = {...original, media_url:original.media_url + '?renewed=1'};
        const unrelated = {...original, id:'otro-adjunto', media_url:original.media_url + '?other=1'};
        return Promise.resolve(Response.json({messages:[unrelated,validItem]}));
      }
      return fetchNormally(input, init);
    };
  }, denied);
}

test('Renueva un enlace vencido por id y conserva tanto las marcas como el adjunto previo si se cancela el reemplazo', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await openInbox(t, 1280);
  await page.locator('[data-compose-file]').setInputFiles({name:'documento-previo.pdf',mimeType:'application/pdf',buffer:pdfFixture});
  await page.locator('[data-compose-context]').getByText(/documento-previo\.pdf/).waitFor();
  await expireImageLink(page, false);
  await page.locator('[data-thread-messages] [data-chat-media-open="image"]').click();
  const dialog = page.locator('dialog[data-smyl-media-dialog][open]');
  await dialog.getByRole('button',{name:'Plumón',exact:true}).click();
  const stage = await dialog.locator('[data-media-stage]').boundingBox();
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  const queried = await page.evaluate(() => window.mediaRequests);
  assert.equal(queried.expired,1);
  assert.equal(queried.renewed,1);
  assert.equal(queried.other,0);
  assert.equal(queried.query.id,'c-preview');
  assert.ok(Date.parse(queried.query.since) <= Date.parse(queried.query.created) && Date.parse(queried.query.before) > Date.parse(queried.query.created));
  let question = '';
  page.once('dialog', async prompt => { question = prompt.message(); await prompt.dismiss(); });
  await dialog.getByRole('button',{name:'Adjuntar copia al chat',exact:true}).click();
  await dialog.getByText('La copia sigue disponible en el visor.').waitFor();
  assert.match(question,/Reemplazar/);
  assert.equal(await dialog.getByRole('button',{name:'Deshacer',exact:true}).isEnabled(),true);
  assert.match(await page.locator('[data-compose-context]').textContent(), /documento-previo\.pdf/);
  assert.equal(await page.evaluate(() => window.mediaSends),0);
});

test('Retira el visor y el hilo cuando se revoca el acceso al renovar el enlace privado', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await openInbox(t, 1280);
  await expireImageLink(page, true);
  await page.locator('[data-thread-messages] [data-chat-media-open="image"]').click();
  await page.waitForFunction(() => window.mediaRequests.query && !document.querySelector('dialog[data-smyl-media-dialog][open]'));
  const calls = await page.evaluate(() => window.mediaRequests);
  assert.equal(calls.expired,1);
  assert.equal(calls.renewed,0);
  assert.equal(calls.other,0);
  assert.equal(await page.locator('[data-thread-messages] [data-chat-media-open]').count(),0);
  assert.equal(await page.evaluate(() => window.mediaSends),0);
});
