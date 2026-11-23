import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../smyl-inbox.js', import.meta.url), 'utf8');
const logic = source.slice(source.indexOf('  function locationCoordinate('), source.indexOf('  function chatLocationCard('));
const classify = vm.runInNewContext(logic + '; chatLocation', {URL});
const pin = 'https://www.google.com/maps?q=20.674%2C-103.344';

test('muestra la ubicación nativa, en ambas direcciones, sin falsear una coordenada ausente como cero', () => {
  for (const author_type of ['patient', 'team']) {
    assert.equal(classify({author_type, media_type:'location', location:{latitude:'20.674',longitude:-103.344}}).url, pin);
    assert.equal(classify({author_type, media_type:'location', latitude:0,longitude:0}).url, 'https://www.google.com/maps?q=0%2C0');
    for (const value of [null,'',' ',undefined,true,NaN,-181,'2x']) {
      assert.equal(classify({media_type:'location', latitude:0,longitude:value}), null);
    }
  }
  assert.equal(classify({media_type:'location', media_url:pin, content:'Entrada norte'}).caption, 'Entrada norte');
});

test('contrae sólo un enlace reconocido, conserva instrucciones y evita duplicar el marcador original', () => {
  assert.equal(classify({content:'📍 Ubicación actual\n' + pin}).caption, '');
  assert.equal(classify({content:'Nos vemos en recepción.\n'+pin}).caption, 'Nos vemos en recepción.');
  assert.equal(classify({content:'https://www.google.com.mx/maps/search/?api=1&query=20.674,-103.344&utm_source=something'}).url, pin);
  assert.equal(classify({content:'https://maps.app.goo.gl/AbCd123?g_st=ic'}).url, 'https://maps.app.goo.gl/AbCd123');
  assert.equal(classify({media_type:'document',content:pin}),null);
  assert.equal(classify({deleted:true,content:pin}),null);
});

test('enlaces ambiguos, destinos no admitidos y coordenadas inválidas siguen siendo texto', () => {
  for (const url of ['https://www.google.com.ejemplo.test/maps?q=1,2','https://maps.app.goo.gl.ejemplo.test/AbCd123','https://me@www.google.com/maps?q=1,2',
    'https://www.google.com:8080/maps?q=1,2','http://www.google.com/maps?q=1,2','https://www.google.com/url?q=1,2',
    'https://www.google.com/maps?q=91,2','https://www.google.com/maps?q=0,-181','https://www.google.com/maps?q=1,',
    'https://www.google.com/maps?q=1,2,3','test@example.com','No abrir automáticamente: '+pin]) {
    assert.equal(classify({content:url}), null, url);
  }
});

test('Chat y Pipeline muestran la misma tarjeta y no contactan al mapa antes de pulsarlo',async t=>{
  let browser;
  try { browser=await createRequire(import.meta.url)('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM,args:['--allow-file-access-from-files']}); }
  catch(e){if(process.env.SMYL_CHROMIUM)throw e;return t.skip('Se necesita Chromium.');}
  t.after(()=>browser.close());
  for(const [view,width] of [['focus',390],['pipeline-preview',1440]]){
    const page=await browser.newPage({viewport:{width,height:840}});
    try {
      const external=[];page.on('request',r=>{if(/https:\/\/[^/]*goo(?:gle)?\./.test(r.url()))external.push(r.url());});
      await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
        const thread=window.demoThreads?.get('c-preview')||window.messages, created_at=new Date().toISOString();
        thread.push({id:'native-map',media_type:'location',location:{latitude:0,longitude:-103},role:'user',author_type:'patient',status:'sent',content:'Entrada principal',created_at},
          {id:'map-unknown',content:'https://www.google.com/maps?q=200,400',role:'user',author_type:'patient',status:'sent',created_at});
      }));
      await page.goto(new URL('./fixtures/smyl-inbox-stage7-preview.html?chat-ux&'+view,import.meta.url).href);
      await page.waitForSelector('html[data-preview-ready=true]');
      if(view==='pipeline-preview') await page.getByRole('button',{name:'Abrir conversación con Ana López'}).click();
      const thread=page.locator('[data-thread-messages]');
      const map=thread.locator('.is-team a.smyl-chat-location');await map.waitFor();
      assert.equal(await map.getAttribute('href'),pin);
      assert.match(await map.getAttribute('aria-label'),/Abrir mapa.+otra pestaña/);
      assert.equal(await map.getAttribute('rel'),'noopener noreferrer');
      assert.equal(await map.getAttribute('target'),'_blank');
      assert.ok((await map.boundingBox()).height>=44);
      assert.equal(await thread.locator('.is-patient a.smyl-chat-location').count(),1);
      assert.equal(await thread.getByText('Entrada principal',{exact:true}).count(),1);
      assert.equal(await thread.getByText('https://www.google.com/maps?q=200,400',{exact:true}).count(),1);
      assert.deepEqual(external,[]);
    } finally {await page.close();}
  }
});
