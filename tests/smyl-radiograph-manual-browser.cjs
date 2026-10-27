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
    const before = await page.locator('.dr-radiograph-dialog .dr-mark').count();
    await page.locator('.dr-radiograph-dialog .dr-image-stage img').click({ position: { x: 80, y: 80 } });
    const afterPassiveClick = await page.locator('.dr-radiograph-dialog .dr-mark').count();
    const metrics = await page.evaluate(() => {
      const dialog=document.querySelector('.dr-radiograph-dialog'),workspace=document.querySelector('.dr-reading-workspace')?.getBoundingClientRect(),viewer=document.querySelector('.dr-viewer-pane')?.getBoundingClientRect(),panel=document.querySelector('.dr-signal-pane')?.getBoundingClientRect();
      const controls=Array.from(document.querySelectorAll('.dr-radiograph-dialog button')).filter(element=>element.getClientRects().length);
      return {rootOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,dialogOverflow:dialog.scrollWidth>dialog.clientWidth+1,sameRow:Math.abs((viewer?.top||0)-(panel?.top||0))<2,stackGap:panel&&viewer?panel.top-viewer.bottom:0,viewerRatio:workspace&&viewer?viewer.width/workspace.width:0,signals:document.querySelectorAll('.dr-signal-card').length,minButtonHeight:Math.min(...controls.map(element=>element.getBoundingClientRect().height).concat([44]))};
    });
    if (item.name === 'manual-desktop') {
      await page.getByRole('button', { name: 'Marcar zona' }).click();
      await page.locator('.dr-radiograph-dialog .dr-image-stage img').click({ position: { x: 120, y: 120 } });
      await page.locator('.dr-mark-dialog textarea').fill('Señal manual de prueba.');
      await page.getByRole('button', { name: 'Agregar al borrador' }).click();
      if (await page.locator('.dr-radiograph-dialog .dr-mark').count() !== 3) throw new Error('Explicit placement did not create one signal');
      if (await page.locator('.dr-mark-dialog[open]').count()) throw new Error('Signal editor did not close');
    }
    report.push({name:item.name,before,afterPassiveClick,...metrics,expectedSameRow:item.width>=960});
    await page.screenshot({path:path.join(output,`${item.name}.png`),fullPage:false});
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report,null,2));
  if(report.some(item=>item.before!==2||item.afterPassiveClick!==2||item.rootOverflow||item.dialogOverflow||item.sameRow!==item.expectedSameRow||(!item.expectedSameRow&&item.stackGap<0)||item.signals!==2||item.minButtonHeight<(item.name.includes('mobile')?44:40)||(item.expectedSameRow&&(item.viewerRatio<.62||item.viewerRatio>.75))))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
