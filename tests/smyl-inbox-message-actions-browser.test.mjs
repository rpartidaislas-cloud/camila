import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {after, before, test} from 'node:test';

const require=createRequire(import.meta.url);
const shell=new URL('../app.html',import.meta.url), shellHead=readFileSync(shell,'utf8').split('</head>')[0];
const preview=new URL('./fixtures/smyl-inbox-stage7-preview.html?focus&chat-ux&media-preview',import.meta.url);
const shots=path.resolve('../output/chat-message-actions');mkdirSync(shots,{recursive:true});
let browser;
before(async()=>{
  try{browser=await require('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM,args:['--allow-file-access-from-files']});}
  catch(error){if(process.env.SMYL_CHROMIUM)throw error;}
});
after(async()=>browser?.close());

async function realStyles(page){
  await page.evaluate(async({html,base})=>{
    const shell=new DOMParser().parseFromString(html,'text/html'),loads=[];
    document.head.querySelectorAll('link[rel=stylesheet]').forEach(el=>el.remove());
    for(const el of shell.head.querySelectorAll('style,link[rel=stylesheet]')){
      const copy=document.importNode(el,true);
      if(copy.tagName==='LINK'){
        const url=new URL(el.getAttribute('href'),base);if(url.protocol!=='file:')continue;
        copy.href=url.href;loads.push(new Promise((resolve,reject)=>{copy.onload=resolve;copy.onerror=()=>reject(new Error(url.pathname));}));
      }
      document.head.append(copy);
    }
    await Promise.all(loads);
  },{html:shellHead,base:shell.href});
}
async function ready(page){await page.waitForSelector('html[data-preview-ready=true]');await realStyles(page);await page.locator('[data-message-id="map-example"]').waitFor();}

for(const [width,touch] of [[1440,false],[834,true],[390,true]]){
  test('Opciones fuera de texto, ubicación y archivos; responder sin perder borrador a '+width+' px',async t=>{
    if(!browser)return t.skip('Se necesita Chromium; se ejecuta en el trabajo navegador.');
    const page=await browser.newPage({viewport:{width,height:960},hasTouch:touch});t.after(()=>page.close());page.setDefaultTimeout(7000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());
    await page.route('https://preview.invalid/example.png',r=>r.fulfill({contentType:'image/png',body:readFileSync(new URL('../icons/icon-512.png',import.meta.url))}));
    await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
      const original=window.fetch;
      window.fetch=async(input,init)=>{
        const response=await original(input,init);
        if(new URL(input,document.baseURI).searchParams.get('action')!=='messages')return response;
        const data=await response.json();
        for(const item of data.messages||[])if(item.id==='img-test')item.media_url='https://preview.invalid/example.png';
        return Response.json(data);
      };
    },{once:true}));
    await page.goto(preview.href);await ready(page);
    const body=page.locator('[data-thread-body]'),input=page.locator('#smyl-inbox-message');
    await input.fill('Texto que ya estaba escribiendo');
    for(const id of ['history-19','map-example','img-test','pdf-test']){
      const row=page.locator('[data-message-id="'+id+'"]'),button=row.getByRole('button',{name:'Opciones del mensaje'}),bubble=row.locator('.smyl-inbox-bubble');
      await row.scrollIntoViewIfNeeded();
      if(id==='img-test')await page.waitForFunction(()=>document.querySelector('[data-message-id="img-test"] img')?.naturalWidth>0);
      const before=await bubble.boundingBox();await row.hover();
      const after=await bubble.boundingBox();assert.deepEqual(after,before,'hover no mueve la burbuja '+id);
      const geometry=await row.evaluate(el=>{
        const b=el.querySelector('.smyl-inbox-bubble').getBoundingClientRect(),a=el.querySelector('.smyl-inbox-message-more').getBoundingClientRect(),r=el.getBoundingClientRect();
        return {incoming:el.classList.contains('is-patient'),bubble:{left:b.left,right:b.right},button:{left:a.left,right:a.right,width:a.width,height:a.height},inside:r.left<=a.left&&r.right>=a.right,opacity:getComputedStyle(el.querySelector('button.smyl-inbox-message-more')).opacity};
      });
      assert.ok(geometry.incoming?geometry.button.left>=geometry.bubble.right+4:geometry.button.right<=geometry.bubble.left-4,JSON.stringify(geometry));
      assert.ok(geometry.inside&&geometry.button.width>=44&&geometry.button.height>=44);
      if(touch)assert.equal(geometry.opacity,'1');
      assert.equal(await bubble.locator('.smyl-inbox-message-actions').count(),0);
      if(touch)await button.tap();else await button.click();
      const menu=page.getByRole('menu',{name:'Opciones del mensaje'});await menu.waitFor();
      assert.equal(await menu.getByRole('menuitem').first().innerText(),'Responder');
      const m=await menu.boundingBox();assert.ok(m.x>=0&&m.y>=0&&m.x+m.width<=width+1&&m.y+m.height<=960,'menú dentro de pantalla');
      assert.equal(await button.getAttribute('aria-expanded'),'true');
      if(id==='map-example'){
        const b=await bubble.boundingBox();
        assert.ok(m.x+m.width<=b.x||m.x>=b.x+b.width||m.y+m.height<=b.y||m.y>=b.y+b.height,'el menú no cubre la ubicación seleccionada');
        await page.screenshot({path:path.join(shots,'menu-'+width+'.png')});
      }
      if(id==='img-test')assert.equal(await menu.getByRole('menuitem',{name:'Enviar a revisión clínica'}).count(),1);
      await menu.getByRole('menuitem',{name:'Responder',exact:true}).click();
      const quote=page.locator('[data-compose-context]');await quote.waitFor();
      assert.equal(await input.inputValue(),'Texto que ya estaba escribiendo');
      if(id==='map-example')assert.match(await quote.innerText(),/Ubicación compartida/);
      if(id==='img-test')assert.match(await quote.innerText(),/Fotografía/);
      assert.ok((await quote.boundingBox()).y+(await quote.boundingBox()).height<=(await input.boundingBox()).y,'cita encima del texto');
      assert.ok(await input.evaluate(el=>document.activeElement===el));
      if(id==='map-example')await page.screenshot({path:path.join(shots,'respuesta-'+width+'.png')});
      await quote.getByRole('button',{name:'Cancelar respuesta'}).click();assert.equal(await quote.isVisible(),false);assert.equal(await input.inputValue(),'Texto que ya estaba escribiendo');
    }
    const last=page.locator('[data-message-id="pdf-test"] .smyl-inbox-message-more');await last.scrollIntoViewIfNeeded();await last.focus();await page.keyboard.press('ArrowDown');
    const menu=page.getByRole('menu',{name:'Opciones del mensaje'});await menu.waitFor();
    assert.equal(await page.locator(':focus').innerText(),'Responder');await page.keyboard.press('End');assert.equal(await page.locator(':focus').innerText(),'Ocultar en el panel');
    await page.keyboard.press('Home');assert.equal(await page.locator(':focus').innerText(),'Responder');await page.keyboard.press('Escape');assert.equal(await menu.count(),0);assert.ok(await last.evaluate(el=>document.activeElement===el));
    await last.click();await input.click();assert.equal(await menu.count(),0);
    await last.click();await body.evaluate(el=>el.scrollTop=0);await menu.waitFor({state:'detached'});
    const textButton=page.locator('[data-message-id="m1"] .smyl-inbox-message-more');await textButton.scrollIntoViewIfNeeded();await textButton.focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal(await menu.count(),0);
    // Sending is intercepted in memory: the real composer must preserve the exact reply ID.
    await page.evaluate(()=>{const fetch=window.fetch;window.replyCalls=[];window.fetch=async(url,init)=>{let data={};try{data=JSON.parse(init?.body||'{}');}catch{}if(data.action==='send'){window.replyCalls.push(data);return new Response(JSON.stringify({message:{id:'sent-example',author_type:'team',role:'assistant',content:data.content,status:'sent',created_at:new Date().toISOString()}}),{status:200,headers:{'Content-Type':'application/json'}});}return fetch(url,init);};});
    await textButton.click();await page.getByRole('menuitem',{name:'Responder',exact:true}).click();await input.fill('Respuesta de prueba');await page.locator('[data-compose-send]').click();
    await page.waitForFunction(()=>window.replyCalls.length===1);
    const sent=await page.evaluate(()=>window.replyCalls[0]);assert.equal(sent.reply_to_message_id,'m1');assert.equal(sent.content,'Respuesta de prueba');assert.equal(await page.locator('[data-compose-context]').isVisible(),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  });
}

test('el menú funciona también dentro del chat lateral del Pipeline y se cierra al cambiar conversación',async t=>{
  if(!browser)return t.skip('Se necesita Chromium; se ejecuta en el trabajo navegador.');
  const page=await browser.newPage({viewport:{width:1440,height:960}});t.after(()=>page.close());await page.route(/^https?:/,r=>r.abort());
  const fixture=new URL('./fixtures/smyl-inbox-stage7-preview.html?pipeline-preview&chat-ux',import.meta.url);await page.goto(fixture.href);await page.waitForSelector('html[data-preview-ready=true]');await realStyles(page);
  await page.locator('[data-pipeline-board]').getByRole('button',{name:'Abrir conversación con Ana López'}).click();
  const button=page.locator('[data-message-id="map-example"] .smyl-inbox-message-more');await button.scrollIntoViewIfNeeded();await button.click();
  await page.getByRole('menuitem',{name:'Responder',exact:true}).click();await page.locator('#smyl-inbox-message').fill('Borrador de Ana');
  await button.click();await page.locator('[data-pipeline-board]').getByRole('button',{name:'Abrir conversación con Elena Cruz'}).click();
  await page.locator('[data-thread-name]').getByText('Elena Cruz',{exact:true}).waitFor();
  assert.equal(await page.getByRole('menu',{name:'Opciones del mensaje'}).count(),0);assert.equal(await page.locator('[data-compose-context]').isVisible(),false);
});
