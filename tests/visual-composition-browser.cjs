const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_BINARY,headless:true});
 try{for(const [width,height] of [[1366,900],[768,1024],[390,844]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button>Inicio</button>');
  await page.addStyleTag({path:path.resolve('visual-simulation.css')});await page.addScriptTag({path:path.resolve('visual-composition.js')});
  const result=await page.evaluate(async()=>{
    const make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
    const original=make(600,500),g=original.getContext('2d');g.fillStyle='#b77d62';g.fillRect(0,0,600,500);
    for(let i=0;i<60;i++){g.fillStyle=i%2?'#724a3a':'#cf9b83';g.fillRect(110+(i*43)%360,155+(i*31)%210,7+i%12,5+i%9);}
    g.fillStyle='#573330';g.fillRect(165,252,275,87);for(let i=0;i<6;i++){g.fillStyle='#d7c09e';g.fillRect(175+i*42,260,37,55);}
    const rect={x:100,y:150,w:400,h:240},source=make(400,240);source.getContext('2d').drawImage(original,100,150,400,240,0,0,400,240);
    const target=make(400,240),t=target.getContext('2d');t.fillStyle='#a86e57';t.fillRect(0,0,400,240);t.drawImage(source,6,4);
    for(let i=0;i<6;i++){t.fillStyle='#f1e5cc';t.fillRect(81+i*42,114,37,55);}
    window.originalUrl=original.toDataURL();window.prepared=await SmylVisualComposition.prepare(originalUrl,target.toDataURL(),rect,source.toDataURL(),{x:.15,y:.42,w:.72,h:.35});
    const rendered=SmylVisualComposition.render(prepared.source,prepared.target,prepared.region,prepared.alignment);
    const a=source.getContext('2d').getImageData(0,0,400,240).data,b=rendered.getContext('2d').getImageData(0,0,400,240).data;let outside=0,inside=0;
    for(let y=0;y<240;y++)for(let x=0;x<400;x++){const i=(y*400+x)*4,d=[0,1,2,3].some(k=>a[i+k]!==b[i+k]);if(d){if(SmylVisualComposition.opacity(x+.5,y+.5,prepared.region,400,240)===0)outside++;else inside++;}}
    const after=SmylVisualComposition.compose(prepared),img=await new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.src=after;}),full=make(600,500);full.getContext('2d').drawImage(img,0,0);
    const fullPx=full.getContext('2d').getImageData(0,0,600,500).data,origPx=g.getImageData(0,0,600,500).data;let outerChanged=0;
    for(let y=0;y<500;y++)for(let x=0;x<600;x++)if(x<100||x>=500||y<150||y>=390){const i=(y*600+x)*4;if([0,1,2,3].some(k=>fullPx[i+k]!==origPx[i+k]))outerChanged++;}
    window.afterUrl=after;
    const flat=make(400,240);flat.getContext('2d').fillRect(0,0,400,240);const uncertain=SmylVisualComposition.estimate(flat,flat,prepared.region);
    let rejected=false;try{await SmylVisualComposition.prepare(originalUrl,make(100,100).toDataURL(),rect,source.toDataURL(),prepared.region);}catch{rejected=true;}
    window.startAdjust=()=>{window.done=null;SmylVisualComposition.adjust(prepared).then(r=>done={accepted:!!r});};startAdjust();
    return {outside,inside,outerChanged,alignment:prepared.alignment,uncertain,rejected};
  });
  assert.equal(result.outside,0);assert.equal(result.outerChanged,0);assert.ok(result.inside>1000);assert.ok(result.rejected);
  assert.ok(Math.abs(result.alignment.dx+.015)<.012);assert.ok(Math.abs(result.alignment.dy+.0167)<.012);
  assert.equal(result.uncertain.dx,0);assert.equal(result.uncertain.dy,0);assert.equal(result.uncertain.needsReview,true);
  const d=page.locator('dialog');await d.waitFor();assert.ok(await d.locator('[data-action=accept]').isDisabled());
  await d.getByRole('slider',{name:'Zona · posición vertical'}).fill('0.04');
  assert.equal(await d.locator('.vc-warning').isVisible(),true);assert.ok(await d.locator('[type=checkbox]').isDisabled());
  await d.getByRole('button',{name:'Restablecer zona inicial'}).click();assert.equal(await d.locator('.vc-warning').isVisible(),false);assert.equal(await d.locator('[type=checkbox]').isDisabled(),false);
  await d.locator('[type=checkbox]').check();
  await d.getByRole('slider',{name:'Zona · alto'}).focus();await page.keyboard.press('ArrowLeft');assert.ok(await d.locator('[data-action=accept]').isDisabled());
  await page.screenshot({path:path.resolve('../output/visual-union-'+width+'.png')});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>done);assert.equal(await page.evaluate(()=>done.accepted),false);
  assert.equal(await page.evaluate(()=>prepared.region.h),.35,'cancel must not mutate original settings');
  await page.evaluate(()=>startAdjust());await d.waitFor();await d.locator('[type=checkbox]').check();await d.locator('[data-action=accept]').click();await page.waitForFunction(()=>done);
  assert.equal(await page.evaluate(()=>done.accepted),true);
  await page.evaluate(()=>{const opts={shade:'A1',current:false,finish:'natural',intensity:'balanced'};SmylVisualComposition.remember({original:originalUrl,after:afterUrl,rect:prepared.rect,options:{...opts,construction:'layered'}});SmylVisualComposition.remember({original:originalUrl,after:afterUrl,rect:prepared.rect,options:{...opts,construction:'monolithic'}});window.comparisonDone=false;SmylVisualComposition.compare(originalUrl).then(()=>comparisonDone=true);});
  await page.getByRole('heading',{name:'Comparar acabados'}).waitFor();
  assert.deepEqual(await d.locator('img').evaluateAll(imgs=>imgs.map(i=>[i.naturalWidth,i.naturalHeight])),[[400,240],[400,240]]);
  await page.screenshot({path:path.resolve('../output/visual-pair-'+width+'.png')});
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();await page.waitForFunction(()=>comparisonDone);assert.deepEqual(errors,[]);
  console.log('Composition: pixel preservation, shift correction, fallback, adjustment, same-scale comparison passed '+width+'x'+height);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
