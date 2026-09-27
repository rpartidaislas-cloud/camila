const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.EDGE_BINARY});
  try {
    for (const width of [390,768,1366]) {
      const page = await browser.newPage({viewport:{width,height:920}});
      page.on('dialog',dialog=>dialog.dismiss());
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if(url.hostname !== '127.0.0.1')return route.abort();
        const local=path.resolve('.'+decodeURIComponent(url.pathname));
        if(!local.startsWith(process.cwd()+path.sep)||!fs.existsSync(local))return route.abort();
        return route.fulfill({path:local});
      });
      await page.goto('http://127.0.0.1:8790/simulacion-rapida.html',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('.flow-home',{state:'attached'});
      await page.evaluate(()=>{document.querySelectorAll('[id$="overlay"]').forEach(n=>n.style.display='none'); show('s-intro');});
      await page.screenshot({path:'../output/organized-home-'+width+'.png'});
      await page.getByRole('button',{name:'Crear simulación',exact:true}).click();
      assert.equal(await page.locator('#flow-continue').isDisabled(),true);
      assert.equal(await page.locator('.flow-photo-card').count(),8);
      // Load a lateral as the only photo: no frontal/intraoral prerequisite.
      await page.locator('.flow-photo-card').filter({has:page.getByRole('heading',{name:'Perfil derecho',exact:true})}).getByRole('button',{name:'Subir foto'}).click();
      await page.locator('#flow-upload').setInputFiles('tests/fixtures/smyl-paciente-chuecos-v1/02-perfil-derecho.png');
      await page.waitForFunction(()=>S.photos.length===1 && !document.getElementById('flow-continue').disabled);
      assert.equal(await page.evaluate(()=>S.photos[0].view),'right');
      await page.screenshot({path:'../output/organized-photos-'+width+'.png'});
      await page.getByRole('button',{name:'Continuar a opciones'}).click();
      await page.waitForSelector('#s-vita.active');
      assert.equal(await page.locator('#quick-config').isVisible(),true);
      await page.locator('[data-quick-objective="alignment"]').click();
      assert.equal(await page.locator('#quick-vita-tone').isDisabled(),true);
      await page.locator('[data-quick-objective="combined"]').click();
      await page.locator('[data-quick-arch="both"]').click();
      assert.equal(await page.evaluate(()=>S.smileDesign.arch),'both');
      assert.equal(await page.locator('#quick-vita-tone').isDisabled(),false);
      await page.screenshot({path:'../output/organized-options-'+width+'.png'});
      assert.equal(await page.evaluate(()=>document.getElementById('s-vita').scrollWidth<=innerWidth),true);
      // Stop at the generation boundary; verify the selected photo is passed unchanged.
      await page.evaluate(()=>{window.processPhotos=async()=>{window.workflowProbe={view:S.photos[0].view,options:{...S.smileDesign}};};});
      await page.getByRole('button',{name:'Generar simulación',exact:true}).click();
      assert.equal(await page.evaluate(()=>workflowProbe.view),'right');
      await page.getByRole('button',{name:'← Fotografías'}).click();
      assert.equal(await page.locator('#s-photos').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      await page.locator('.flow-photo-card').filter({has:page.getByRole('heading',{name:'Lateral intraoral izquierda',exact:true})}).getByRole('button',{name:'Subir foto'}).click();
      await page.locator('#flow-upload').setInputFiles('tests/fixtures/smyl-paciente-chuecos-v1/02-perfil-derecho.png');
      await page.waitForFunction(()=>S.photos.length===2 && !document.getElementById('flow-continue').disabled);
      await page.locator('.flow-photo-card').filter({has:page.getByRole('heading',{name:'Lateral intraoral izquierda',exact:true})}).getByRole('button',{name:'Generar primero'}).click();
      assert.equal(await page.evaluate(()=>S.photos[0].view),'intraoralLeft');
      await page.evaluate(()=>{var src='data:image/jpeg;base64,'+S.photos[0].b64;document.getElementById('img-b').src=src;document.getElementById('img-a').src=src;show('s-res');renderResPhotos();initBASlider();});
      await page.screenshot({path:'../output/organized-results-'+width+'.png'});
      assert.equal(await page.locator('#s-res').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      assert.equal(await page.evaluate(()=>document.getElementById('ba-wrap').getBoundingClientRect().top >= document.querySelector('.res-header').getBoundingClientRect().bottom-1),true);
      assert.equal(await page.locator('#btn-editor-diseno').isVisible(),false);
      await page.locator('.flow-result-tools summary').click();
      assert.equal(await page.locator('#btn-editor-diseno').isVisible(),true);
      await page.close(); console.log('Organized workflow passed '+width);
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
