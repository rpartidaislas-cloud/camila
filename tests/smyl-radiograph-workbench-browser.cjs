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
    await page.goto(base);
    await page.locator('#open').click();
    await page.locator('.rr-dialog[open] .rr-workspace').waitFor();
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
        tools: visible('.rr-view-tools input').length,
        cleanSavePosition: getComputedStyle(document.querySelector('.rr-save')).position,
        layoutOrder: Boolean(workspace&&canvas&&panel&&footer&&panel.bottom<=workspace.bottom+1&&workspace.bottom<=footer.top+1&&(Math.abs(canvas.top-panel.top)<2||canvas.bottom<=panel.top+1)),
        minButtonHeight: Math.min(...controls.map(element => element.getBoundingClientRect().height).concat([44]))
      };
    });
    const expectedSameRow = item.width >= 960;
    report.push({ name: item.name, width: item.width, ...metrics, expectedSameRow });
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
      await page.locator('.rr-mark').click();
      const selected = await page.locator('.rr-item[aria-current="true"] .rr-number').textContent();
      if (selected.trim() !== '2') throw new Error('Marker and signal card are not correlated');
      await page.getByRole('button', { name: 'Confirmadas', exact: true }).click();
      if (await page.locator('.rr-item').count() !== 1) throw new Error('Confirmed filter did not isolate one signal');
      await page.getByRole('button', { name: 'Todas', exact: true }).click();
      await page.locator('.rr-tool-range input[aria-label="Contraste"]').fill('150');
      await page.getByRole('button', { name: 'Invertir', exact: true }).click();
      await page.getByRole('button', { name: 'Vista original', exact: true }).click();
      const style = await page.locator('.rr-image-stage img').getAttribute('style');
      if (!style.includes('brightness(100%)') || !style.includes('contrast(100%)') || !style.includes('invert(0)')) throw new Error('Original view reset failed');
    }
    if (item.width < 960) {
      if (item.name === 'mobile') {
        const viewport=page.locator('.rr-image-wrap'),zoom=page.locator('.rr-tool-range input[aria-label="Ampliar radiografía"]');
        await viewport.evaluate(element=>{const event=(type,touches)=>{const value=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(value,'touches',{value:touches});element.dispatchEvent(value);};event('touchstart',[{clientX:100,clientY:320},{clientX:210,clientY:320}]);event('touchmove',[{clientX:65,clientY:320},{clientX:245,clientY:320}]);event('touchend',[]);});
        await page.waitForTimeout(40);
        const pinch=await viewport.evaluate(element=>({left:element.scrollLeft,zoomed:element.classList.contains('is-zoomed')}));
        if (!pinch.zoomed||Number(await zoom.inputValue())<=1||pinch.left<=0) throw new Error('Assisted-review pinch gesture did not zoom');
        await page.getByRole('button',{name:'Vista original',exact:true}).click();
      }
      const last = page.locator('.rr-item').last();
      await last.scrollIntoViewIfNeeded();
      const reachable = await page.evaluate(() => {
        const dialog=document.querySelector('.rr-dialog').getBoundingClientRect(),signal=document.querySelector('.rr-item:last-child').getBoundingClientRect(),save=document.querySelector('.rr-save').getBoundingClientRect();
        return signal.top>=dialog.top-1&&signal.bottom<=dialog.bottom+1&&!(signal.top<save.bottom&&signal.bottom>save.top);
      });
      if (!reachable) throw new Error(`Last signal is not reachable at ${item.width}px`);
      await page.locator('.rr-host').evaluate(element=>{element.scrollTop=0;});
    }
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    if (item.name === 'desktop') {
      await page.getByRole('button', { name: 'Por revisar', exact: true }).click();
      if (await page.locator('.rr-item-body').count() !== 1) throw new Error('Filtered signal did not become the active task');
      const text = page.locator('.rr-item-body textarea');
      await text.fill('Cambio de densidad por comprobar con revisión profesional.');
      await page.getByRole('button', { name: 'Confirmar señal', exact: true }).click();
      if (!(await page.locator('.rr-feedback').textContent()).includes('Ubica la señal')) throw new Error('Placement guidance disappeared after rendering');
      await page.getByRole('button', { name: 'Volver al expediente', exact: true }).click();
      await page.locator('.rr-confirm-dialog[open]').waitFor();
      await page.getByRole('button', { name: 'Continuar revisando', exact: true }).click();
      if (!await page.locator('.rr-dialog[open]').count()) throw new Error('Custom close confirmation dismissed the review');
    }
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.some(item => item.rootOverflow || item.dialogOverflow || item.sameRow !== item.expectedSameRow || !item.layoutOrder || item.workspaceUse < .9 || item.signals !== 3 || item.expandedSignals !== 1 || item.filters !== 4 || item.tools !== 3 || (item.width < 960 && item.cleanSavePosition === 'sticky') || item.minButtonHeight < (item.name.startsWith('mobile') ? 44 : 38) || (item.expectedSameRow && (item.canvasRatio < .62 || item.canvasRatio > .75)))) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
