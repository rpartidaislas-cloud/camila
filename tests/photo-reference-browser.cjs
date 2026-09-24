const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,768,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.setContent('<html><body></body></html>');await page.addScriptTag({path:path.resolve('photo-reference.js')});
  const single=await page.evaluate(async()=>({view:await SmylPhotoReference.choose([{view:'frontal'}]),dialogs:document.querySelectorAll('dialog').length}));assert.deepEqual(single,{view:'frontal',dialogs:0});
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;const dataUrl=c.toDataURL();window.photos=['frontal','right','intraoral'].map(view=>({view,dataUrl}));window.answer=SmylPhotoReference.choose(photos);});
  await page.locator('dialog').waitFor();assert.equal(await page.locator('select').inputValue(),'intraoral');
  await page.selectOption('select','right');await page.getByRole('button',{name:'Usar como referencia'}).click();assert.equal(await page.evaluate(()=>window.answer),'right');
  await page.evaluate(()=>{window.answer=SmylPhotoReference.choose(photos.filter(p=>p.view!=='intraoral'));});
  await page.locator('dialog').waitFor();assert.equal(await page.locator('select').inputValue(),'frontal');
  assert.equal(await page.evaluate(()=>{const d=document.querySelector('dialog');return d.scrollWidth>d.clientWidth;}),false);
  await page.screenshot({path:path.resolve('artifacts/reference-'+width+'.png')});
  await page.getByRole('button',{name:'Volver',exact:true}).click();assert.equal(await page.evaluate(()=>window.answer),null);
  page.once('dialog',d=>d.dismiss());assert.equal(await page.evaluate(()=>SmylPhotoReference.independent()),false);
  page.once('dialog',d=>d.accept());assert.equal(await page.evaluate(()=>SmylPhotoReference.independent()),true);
  await page.close();console.log('Single, optional intraoral, alternative selection, cancel and explicit fallback: '+width+' passed');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
