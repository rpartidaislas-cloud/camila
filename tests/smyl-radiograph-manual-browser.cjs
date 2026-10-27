const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-radiograph-manual-preview.html').replace(/\\/g, '/')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'radiograph-workbench-v41');
  fs.mkdirSync(output, { recursive: true });
  const cases = [{ name: 'manual-desktop', width: 1280, height: 820 }, { name: 'manual-mobile', width: 390, height: 844 }, { name: 'manual-mobile-320', width: 320, height: 700 }];
  const report = [];
  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    await page.goto(fixture);
    await page.getByText('Radiografías', { exact: true }).click();
    await page.getByRole('button', { name: 'Abrir y anotar' }).waitFor();
    await page.getByRole('button', { name: 'Abrir y anotar' }).click();
    await page.locator('.dr-radiograph-dialog[open] .dr-reading-workspace').waitFor();
    const zoom = page.locator('.dr-radiograph-dialog input[aria-label="Ampliar radiografía"]');
    await zoom.fill('2');
    await page.waitForTimeout(40);
    const centered = await page.locator('.dr-radiograph-dialog .dr-viewport').evaluate(element => ({
      left: element.scrollLeft,
      horizontalCenter: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
      zoomed: element.classList.contains('is-zoomed'), clientWidth:element.clientWidth, scrollWidth:element.scrollWidth, stageWidth:element.firstElementChild.offsetWidth
    }));
    if (!centered.zoomed || centered.left <= 0 || Math.abs(centered.horizontalCenter - .5) > .04) throw new Error(`Zoom did not remain centered at ${item.width}px: ${JSON.stringify(centered)}`);
    const viewport = page.locator('.dr-radiograph-dialog .dr-viewport');
    const viewportBox = await viewport.boundingBox();
    await page.mouse.move(viewportBox.x + viewportBox.width * .62, viewportBox.y + viewportBox.height * .5);
    await page.mouse.down();
    await page.mouse.move(viewportBox.x + viewportBox.width * .38, viewportBox.y + viewportBox.height * .5, { steps: 4 });
    await page.mouse.up();
    const draggedLeft = await viewport.evaluate(element => element.scrollLeft);
    if (draggedLeft <= centered.left + 5) throw new Error(`Horizontal drag did not pan at ${item.width}px`);
    await page.getByRole('button', { name: 'Vista original', exact: true }).click();
    await page.waitForTimeout(40);
    if (await viewport.evaluate(element => element.scrollLeft > 2 || element.classList.contains('is-zoomed'))) throw new Error(`Original view did not reset at ${item.width}px`);
    if (item.name === 'manual-mobile') {
      await viewport.evaluate(element => {
        const event=(type,touches)=>{const value=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(value,'touches',{value:touches});element.dispatchEvent(value);};
        event('touchstart',[{clientX:120,clientY:300},{clientX:220,clientY:300}]);
        event('touchmove',[{clientX:80,clientY:300},{clientX:260,clientY:300}]);
        event('touchend',[]);
      });
      await page.waitForTimeout(40);
      const pinch = await viewport.evaluate(element => ({left:element.scrollLeft,zoomed:element.classList.contains('is-zoomed')}));
      const pinchZoom=Number(await zoom.inputValue());
      if (!pinch.zoomed || pinchZoom <= 1 || pinch.left <= 0) throw new Error(`Pinch gesture did not zoom around its center: ${JSON.stringify({...pinch,pinchZoom})}`);
      await page.getByRole('button', { name: 'Vista original', exact: true }).click();
    }
    const before = await page.locator('.dr-radiograph-dialog .dr-mark').count();
    await page.locator('.dr-radiograph-dialog .dr-image-stage img').click({ position: { x: 80, y: 80 } });
    const afterPassiveClick = await page.locator('.dr-radiograph-dialog .dr-mark').count();
    const metrics = await page.evaluate(() => {
      const dialog=document.querySelector('.dr-radiograph-dialog'),workspace=document.querySelector('.dr-reading-workspace')?.getBoundingClientRect(),viewer=document.querySelector('.dr-viewer-pane')?.getBoundingClientRect(),panel=document.querySelector('.dr-signal-pane')?.getBoundingClientRect();
      const controls=Array.from(document.querySelectorAll('.dr-radiograph-dialog button')).filter(element=>element.getClientRects().length);
      return {rootOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,dialogOverflow:dialog.scrollWidth>dialog.clientWidth+1,sameRow:Math.abs((viewer?.top||0)-(panel?.top||0))<2,stackGap:panel&&viewer?panel.top-viewer.bottom:0,viewerRatio:workspace&&viewer?viewer.width/workspace.width:0,signals:document.querySelectorAll('.dr-signal-card').length,minButtonHeight:Math.min(...controls.map(element=>element.getBoundingClientRect().height).concat([44]))};
    });
    if (item.name === 'manual-desktop') {
      await page.getByRole('button', { name: 'Revisar con apoyo de IA', exact: true }).click();
      if (!await page.evaluate(() => window.__aiOpened)) throw new Error('AI review action did not open the assisted review');
      if (await page.locator('.dr-radiograph-dialog[open]').count()) throw new Error('Manual viewer remained open after launching AI review');
      await page.getByRole('button', { name: 'Abrir y anotar' }).click();
      await page.locator('.dr-radiograph-dialog[open] .dr-reading-workspace').waitFor();
      await page.locator('.dr-radiograph-dialog[open]').getByRole('button', { name: 'Marcar zona' }).click();
      await page.locator('.dr-radiograph-dialog .dr-image-stage img').click({ position: { x: 120, y: 120 } });
      await page.locator('.dr-mark-dialog textarea').fill('Señal manual de prueba.');
      await page.getByRole('button', { name: 'Agregar al borrador' }).click();
      if (await page.locator('.dr-radiograph-dialog .dr-mark').count() !== 3) throw new Error('Explicit placement did not create one signal');
      if (await page.locator('.dr-mark-dialog[open]').count()) throw new Error('Signal editor did not close');
      await page.getByRole('button', { name: 'Revisar con apoyo de IA', exact: true }).click();
      const feedback = await page.locator('.dr-action-feedback').textContent();
      if (!feedback.includes('Guarda primero') || !await page.locator('.dr-radiograph-dialog[open]').count()) throw new Error('Unsaved-state AI blocker was not visible in the viewer');
    }
    report.push({name:item.name,before,afterPassiveClick,...metrics,expectedSameRow:item.width>=960});
    await page.screenshot({path:path.join(output,`${item.name}.png`),fullPage:false});
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report,null,2));
  if(report.some(item=>item.before!==2||item.afterPassiveClick!==2||item.rootOverflow||item.dialogOverflow||item.sameRow!==item.expectedSameRow||(!item.expectedSameRow&&item.stackGap<0)||item.signals!==2||item.minButtonHeight<(item.name.includes('mobile')?44:40)||(item.expectedSameRow&&(item.viewerRatio<.62||item.viewerRatio>.75))))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
