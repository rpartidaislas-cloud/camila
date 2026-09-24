const {chromium}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const [width,height] of [[1280,900],[768,1024],[390,844]]){
  const page=await browser.newPage({viewport:{width,height}});
  await page.setContent('<html><body></body></html>');
  await page.addStyleTag({path:path.resolve('dental-transfer.css')});
  await page.addScriptTag({path:path.resolve('dental-transfer.js')});
  await page.evaluate(()=>{
   const make=color=>{const c=document.createElement('canvas');c.width=300;c.height=200;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,300,200);return c.toDataURL();};
   window.done=SmylDentalTransfer.open({source:make('#ffffff'),anatomy:make('#eeeeee'),original:make('#123456'),target:make('#123456')});
  });
  await page.locator('dialog').waitFor();
  const point=async(selector,x,y)=>{const el=page.locator(selector);await el.scrollIntoViewIfNeeded();const r=await el.boundingBox();await page.mouse.click(r.x+x/300*r.width,r.y+y/200*r.height);};
  const next=()=>page.locator('[data-act="next"]').click();
  for(const p of [[70,40],[140,40],[140,140],[70,140]])await point('.dt-source',...p);await next();
  for(const p of [[100,40],[70,140],[140,140]])await point('.dt-source',...p);await next();
  for(const p of [[100,40],[70,140],[140,140]])await point('.dt-target',...p);await next();
  for(const p of [[70,50],[140,50],[140,130],[70,130]])await point('.dt-target',...p);await next();
  assert.match(await page.locator('.dt-count').textContent(),/13/);
  assert.equal(await page.locator('[data-act="save"]').isDisabled(),true);
  const pixels=await page.evaluate(()=>{const c=document.querySelector('.dt-target'),x=c.getContext('2d');return {inside:[...x.getImageData(100,100,1,1).data],outside:[...x.getImageData(20,20,1,1).data],clipped:[...x.getImageData(100,45,1,1).data],overflow:document.querySelector('dialog').scrollWidth>document.querySelector('dialog').clientWidth};});
  assert.deepEqual(pixels.inside,[255,255,255,255]);assert.deepEqual(pixels.outside,[18,52,86,255]);assert.deepEqual(pixels.clipped,[18,52,86,255]);assert.equal(pixels.overflow,false);
  await page.locator('.dt-reviewed').check();
  await page.screenshot({path:path.resolve('artifacts/dental-transfer-'+width+'.png'),fullPage:true});
  await page.locator('[data-act="save"]').click();
  const result=await page.evaluate(async()=>{const r=await window.done;return {version:r.version,count:r.entries.length};});assert.equal(result.count,1);
  await page.close();console.log('Transfer + protected pixels + review + responsive '+width+' passed');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
