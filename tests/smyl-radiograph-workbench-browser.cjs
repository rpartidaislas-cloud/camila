const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const base = process.env.SMYL_PREVIEW_URL || `file:///${path.resolve(__dirname, 'fixtures/smyl-radiograph-workbench-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'radiograph-workbench-v41');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop', width: 1280, height: 820 },
    { name: 'tablet', width: 820, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 700 }
  ];
  const report = [];
  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    page.on('pageerror',error=>console.error('PAGE ERROR',item.name,error.message));
    await page.goto(base);
    await page.locator('#open').click();
    await page.locator('.rr-dialog[open] .rr-image-check-workspace').waitFor();
    const initial=await page.evaluate(()=>({
      marks:Array.from(document.querySelectorAll('.rr-mark')).filter(element=>element.getClientRects().length).length,
      viewSwitch:document.querySelectorAll('.rr-view-switch').length,
      adjustmentOpen:document.querySelector('.rr-image-adjustments')?.open,
      visibleTools:Array.from(document.querySelectorAll('.rr-view-tools input')).filter(element=>element.getClientRects().length).length
    }));
    if(initial.marks||initial.viewSwitch||initial.adjustmentOpen||initial.visibleTools) throw new Error(`Image check exposed review controls at ${item.width}px: ${JSON.stringify(initial)}`);
    await page.screenshot({ path: path.join(output, `${item.name}-image.png`), fullPage: false });
    await page.locator('.rr-image-adjustments > summary').click();
    const tools=page.locator('.rr-view-tools input');
    if(await tools.count()!==3) throw new Error('Expected three image adjustment sliders');
    if(!await page.locator('.rr-view-tools input[aria-label="Ampliar radiografía"]').isVisible()) throw new Error('Collapsed image controls did not open');
    if (item.name === 'desktop') {
      const zoom = page.locator('.rr-tool-range input[aria-label="Ampliar radiografía"]');
      const viewport = page.locator('.rr-image-wrap');
      await zoom.fill('2');
      await page.waitForTimeout(40);
      const centered = await viewport.evaluate(element => ({left:element.scrollLeft,center:(element.scrollLeft+element.clientWidth/2)/element.scrollWidth,zoomed:element.classList.contains('is-zoomed')}));
      if (!centered.zoomed || centered.left <= 0 || Math.abs(centered.center-.5) > .04) throw new Error(`Assisted-review zoom did not remain centered: ${JSON.stringify(centered)}`);
      const box = await viewport.boundingBox();
      await page.mouse.move(box.x+box.width*.62,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.38,box.y+box.height*.5,{steps:4});await page.mouse.up();
      if (await viewport.evaluate(element=>element.scrollLeft) <= centered.left+5) throw new Error('Assisted-review horizontal drag did not pan');
      await page.getByRole('button', { name: 'Vista original', exact: true }).click();
      await page.waitForTimeout(40);
      if (await viewport.evaluate(element=>element.scrollLeft>2||element.classList.contains('is-zoomed'))) throw new Error('Assisted-review original view did not reset');
    }
    if (item.name === 'mobile') {
      const viewport=page.locator('.rr-image-wrap'),zoom=page.locator('.rr-tool-range input[aria-label="Ampliar radiografía"]');
      await viewport.evaluate(element=>{const event=(type,touches)=>{const value=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(value,'touches',{value:touches});element.dispatchEvent(value);};event('touchstart',[{clientX:100,clientY:320},{clientX:210,clientY:320}]);event('touchmove',[{clientX:65,clientY:320},{clientX:245,clientY:320}]);event('touchend',[]);});
      await page.waitForTimeout(40);
      const pinch=await viewport.evaluate(element=>({left:element.scrollLeft,zoomed:element.classList.contains('is-zoomed')}));
      if (!pinch.zoomed||Number(await zoom.inputValue())<=1||pinch.left<=0) throw new Error('Assisted-review pinch gesture did not zoom');
      await page.getByRole('button',{name:'Vista original',exact:true}).click();
    }
    await page.locator('.rr-image-adjustments > summary').click();
    await page.getByRole('button',{name:'Revisar 3 señales',exact:true}).click();
    await page.locator('.rr-signal-panel').waitFor();
    const metrics = await page.evaluate(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).filter(element => element.getClientRects().length);
      const workspace = document.querySelector('.rr-workspace')?.getBoundingClientRect();
      const canvas = document.querySelector('.rr-canvas')?.getBoundingClientRect();
      const panel = document.querySelector('.rr-signal-panel')?.getBoundingClientRect();
      const footer = document.querySelector('.rr-save')?.getBoundingClientRect();
      const controls = visible('.rr-dialog button');
      return {
        rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        dialogOverflow: document.querySelector('.rr-dialog').scrollWidth > document.querySelector('.rr-dialog').clientWidth + 1,
        sameRow: Math.abs((canvas?.top || 0) - (panel?.top || 0)) < 2,
        workspaceUse: workspace ? workspace.width / document.querySelector('.rr-dialog').clientWidth : 0,
        canvasRatio: workspace && canvas ? canvas.width / workspace.width : 0,
        signals: visible('.rr-item').length,
        expandedSignals: visible('.rr-item-body').length,
        filters: visible('.rr-filter').length,
        queue: visible('.rr-signal-queue').length,
        tools: visible('.rr-view-tools input').length,
        cleanSavePosition: getComputedStyle(document.querySelector('.rr-save')).position,
        layoutOrder: Boolean(workspace&&canvas&&panel&&footer&&document.querySelector('.rr-signal-panel')?.contains(document.querySelector('.rr-save'))&&panel.bottom<=workspace.bottom+1&&footer.bottom<=panel.bottom+1&&(Math.abs(canvas.top-panel.top)<2||canvas.bottom<=panel.top+1)),
        minButtonHeight: Math.min(...controls.map(element => element.getBoundingClientRect().height).concat([44]))
      };
    });
    const expectedSameRow = item.width >= 960;
    report.push({ name: item.name, width: item.width, ...metrics, expectedSameRow });
    if (item.name === 'desktop') {
      await page.locator('.rr-mark:not(.is-selected)').first().click();
      const selected = await page.locator('.rr-item[aria-current="true"] .rr-number').textContent();
      if (selected.trim() !== '2') throw new Error('Marker and signal card are not correlated');
      await page.locator('.rr-signal-queue > summary').click();
      await page.getByRole('button',{name:/^1\. Densidad/}).click();
      if(await page.locator('.rr-item').count()!==1||await page.locator('.rr-item .rr-number').textContent()!=='1') throw new Error('The queue did not open the requested signal');
      await page.locator('.rr-image-adjustments > summary').click();
      await page.locator('.rr-tool-range input[aria-label="Contraste"]').fill('150');
      await page.getByRole('button', { name: 'Invertir', exact: true }).click();
      await page.getByRole('button', { name: 'Vista original', exact: true }).click();
      const style = await page.locator('.rr-image-stage img').getAttribute('style');
      if (!style.includes('brightness(100%)') || !style.includes('contrast(100%)') || !style.includes('invert(0)')) throw new Error('Original view reset failed');
      await page.locator('.rr-image-adjustments > summary').click();
    }
    if (item.width < 960) {
      const finalAction=page.getByRole('button',{name:'Confirmar y guardar',exact:true});
      await finalAction.scrollIntoViewIfNeeded();
      const reachable = await page.evaluate(() => {
        const dialog=document.querySelector('.rr-dialog').getBoundingClientRect(),action=document.querySelector('[data-rr-decision="confirm"]').getBoundingClientRect();
        return action.top>=dialog.top-1&&action.bottom<=dialog.bottom+1;
      });
      if (!reachable) throw new Error(`Signal decision is not reachable at ${item.width}px`);
      await page.locator('.rr-host').evaluate(element=>{element.scrollTop=0;});
    }
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    if (item.name === 'desktop') {
      if (await page.locator('.rr-item-body').count() !== 1) throw new Error('Filtered signal did not become the active task');
      const text = page.locator('.rr-item-body textarea');
      await text.fill('Cambio de densidad por comprobar con revisión profesional.');
      await page.getByRole('button', { name: 'Confirmar y guardar', exact: true }).click();
      if (!(await page.locator('.rr-feedback').textContent()).includes('Ubica la señal')) throw new Error('Placement guidance disappeared after rendering');
      await page.locator('.rr-image-stage > img').click({position:{x:220,y:250}});
      await page.getByRole('button', { name: 'Confirmar y guardar', exact: true }).click();
      await page.waitForFunction(()=>document.querySelector('.rr-feedback')?.textContent.includes('guardada en el expediente'));
      const saved=await page.evaluate(()=>({count:window.__reviewSaves.length,state:window.__reviewSaves.at(-1)?.items[0]?.state,text:window.__reviewSaves.at(-1)?.items[0]?.text}));
      if(saved.count!==1||saved.state!=='confirmed'||!saved.text.includes('revisión profesional')) throw new Error('The explicit decision was not verified by the store');
      if(!await page.getByRole('button',{name:'Ver resumen',exact:true}).count()) throw new Error('Completed review did not expose its summary step');
      await page.getByRole('button',{name:'Ver resumen',exact:true}).click();
      if(!await page.locator('.rr-review-summary').count()) throw new Error('The verified summary did not open');
      await page.screenshot({path:path.join(output,'desktop-summary.png'),fullPage:false});
      await page.getByRole('button', { name: 'Cerrar y volver al expediente', exact: true }).click();
      if(await page.locator('.rr-confirm-dialog[open]').count()) throw new Error('A verified review still appeared as unsaved');
    }
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.rootOverflow || item.dialogOverflow || item.sameRow !== item.expectedSameRow || !item.layoutOrder || item.workspaceUse < .9 || item.signals !== 1 || item.expandedSignals !== 1 || item.filters !== 0 || item.queue !== 1 || item.tools !== 0 || (item.width < 960 && item.cleanSavePosition === 'sticky') || item.minButtonHeight < (item.name.startsWith('mobile') ? 44 : 36) || (item.expectedSameRow && (item.canvasRatio < .62 || item.canvasRatio > .75)))) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
