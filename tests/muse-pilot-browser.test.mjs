import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(path.resolve(process.env.SMYL_PGLITE_DIR || '../promodesk-calendar-voice/node_modules','loader.cjs'));
const {chromium}=require('playwright');
const root=new URL('../',import.meta.url);
test('Muse settings: desktop, tablet and mobile; personal consent and credential clearing',async t=>{
  const browser=await chromium.launch({executablePath:process.env.SMYL_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  t.after(()=>browser.close());
  mkdirSync(new URL('../output/muse-pilot',import.meta.url),{recursive:true});
  for(const [name,width,height] of [['desktop',1440,1000],['tablet',768,1024],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main class="contenido"></main></body></html>');
    await page.addStyleTag({content:'body{margin:0;background:#f4f7fb;font:15px Arial,sans-serif}.btn{font:inherit;padding:10px 16px;border:1px solid #c5d4e4;border-radius:8px;background:white;color:#173b54;cursor:pointer}.pantalla{display:none}.pantalla.activa{display:block}'+readFileSync(new URL('smyl-muse.css',root),'utf8')});
    await page.evaluate(()=>{
      window.TITULOS={};window.ir=route=>document.querySelectorAll('.pantalla').forEach(p=>p.classList.toggle('activa',p.id==='p-'+route));
      window.calls=[];window.sb={functions:{invoke:async(name,options)=>{window.calls.push(options);if(options.method==='GET')return {data:{owner:true,settings:{enabled:true,allow_replies:true},members:[],connection:null,people:[{id:'test',nombre:'Doctora de prueba'}]}};return {data:{credential:'TEST_CREDENTIAL_NOT_REAL'}};}}};
    });
    await page.addScriptTag({content:readFileSync(new URL('smyl-muse.js',root),'utf8')});await page.evaluate(()=>window.ir('muse'));
    await page.getByRole('heading',{name:'Mi conexión personal'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' no horizontal overflow');
    await page.getByRole('button',{name:'Crear clave personal'}).click();
    await page.getByRole('status').filter({hasText:'Marca la autorización'}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.some(c=>c.body?.action==='connect')),false);
    await page.getByLabel('Autorizo consultar mis chats asignados desde mi cuenta de Muse.').check();
    await page.getByRole('button',{name:'Crear clave personal'}).click();
    const credential=page.getByLabel('Clave personal de conexión');await credential.waitFor();
    assert.equal(await credential.getAttribute('type'),'password');
    await page.screenshot({path:fileURLToPath(new URL('../output/muse-pilot/'+name+'.png',import.meta.url)),fullPage:true});
    await page.evaluate(()=>window.ir('otra'));
    assert.equal(await credential.inputValue(),'');assert.deepEqual(errors,[]);
    await page.close();
  }
});
