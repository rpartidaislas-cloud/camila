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
      const dialog = document.querySelector('.rr-dialog')?.getBoundingClientRect();
      const reject = document.querySelector('[data-rr-decision="reject"]')?.getBoundingClientRect();
      const confirm = document.querySelector('[data-rr-decision="confirm"]')?.getBoundingClientRect();
      const visualTop = Math.max(0, dialog?.top || 0);
      const visualBottom = Math.min(innerHeight, dialog?.bottom || innerHeight);
      const actionInsideViewport = rect => Boolean(rect && rect.width && rect.height && rect.top >= visualTop - 1 && rect.bottom <= visualBottom + 1);
      const picker = document.querySelector('.rr-item[aria-current="true"] .rr-tooth-picker');
      const pickerSummary = picker?.querySelector(':scope > summary')?.getBoundingClientRect();
      const toothOptions = Array.from(picker?.querySelectorAll('.rr-tooth-option[role="radio"]') || []);
      const toothChart = picker?.querySelector('.rr-tooth-chart');
      const quadrants = Array.from(picker?.querySelectorAll('.rr-tooth-row[data-quadrant]') || []);
      const verticalDivider = toothChart ? getComputedStyle(toothChart, '::before') : null;
      const horizontalDivider = toothChart ? getComputedStyle(toothChart, '::after') : null;
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
        layoutOrder: Boolean(workspace&&canvas&&panel&&footer&&document.querySelector('.rr-signal-panel')?.contains(document.querySelector('.rr-save'))&&footer.bottom<=panel.bottom+1&&(Math.abs(canvas.top-panel.top)<2?panel.bottom<=workspace.bottom+1:canvas.bottom<=panel.top+1)),
        minButtonHeight: Math.min(...controls.map(element => element.getBoundingClientRect().height).concat([44])),
        minButton: controls.map(element=>({text:(element.textContent||'').trim(),className:element.className,height:element.getBoundingClientRect().height})).sort((a,b)=>a.height-b.height)[0],
        decisionVisibleWithoutScroll: actionInsideViewport(reject) && actionInsideViewport(confirm),
        initialHostScroll: document.querySelector('.rr-host')?.scrollTop || 0,
        initialItemsScroll: document.querySelector('.rr-items')?.scrollTop || 0,
        toothPickerCount: picker ? 1 : 0,
        toothPickerOpen: Boolean(picker?.open),
        toothPickerSummaryHeight: pickerSummary?.height || 0,
        toothPickerOverflow: Boolean(picker && picker.scrollWidth > picker.clientWidth + 1),
        toothRadioCount: toothOptions.length,
        toothRadioLabels: new Set(toothOptions.map(option => option.getAttribute('aria-label'))).size,
        toothTabStopCount: toothOptions.filter(option => option.tabIndex === 0).length,
        toothGlyphCount: picker?.querySelectorAll('.rr-tooth-glyph[aria-hidden="true"]').length || 0,
        toothFamilies: Array.from(new Set(toothOptions.map(option => option.dataset.kind))).sort().join(','),
        quadrantCount: quadrants.length,
        quadrantOrder: quadrants.map(quadrant => quadrant.dataset.quadrant).join(','),
        quadrantLabels: new Set(quadrants.map(quadrant => quadrant.getAttribute('aria-label'))).size,
        quadrantCrossVisible: Boolean(verticalDivider && horizontalDivider && parseFloat(verticalDivider.width) >= 2 && parseFloat(verticalDivider.height) > 0 && parseFloat(horizontalDivider.height) >= 2 && parseFloat(horizontalDivider.width) > 0),
        selectedTooth: toothOptions.find(option => option.getAttribute('aria-checked') === 'true')?.textContent?.trim() || '',
        nativeToothSelects: picker?.querySelectorAll('select').length || 0
      };
    });
    const expectedSameRow = item.width >= 720;
    report.push({ name: item.name, width: item.width, ...metrics, expectedSameRow });
    if (item.name.startsWith('mobile')) {
      const picker = page.locator('.rr-item[aria-current="true"] .rr-tooth-picker');
      await picker.locator(':scope > summary').click();
      if (!await picker.evaluate(element => element.open)) throw new Error(`Compact FDI picker did not open at ${item.width}px`);
      const openPicker = await picker.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest('.rr-items')?.getBoundingClientRect();
        const body = element.querySelector('.rr-tooth-picker-body');
        const bodyRect = body?.getBoundingClientRect();
        const quadrants = Array.from(element.querySelectorAll('.rr-tooth-row[data-quadrant]'));
        return {
          horizontalFit: Boolean(panel && rect.left >= panel.left - 1 && rect.right <= panel.right + 1),
          overflow: element.scrollWidth > element.clientWidth + 1,
          visibleOptions: Array.from(element.querySelectorAll('.rr-tooth-option')).filter(option => option.getClientRects().length).length,
          visibleGlyphs: Array.from(element.querySelectorAll('.rr-tooth-glyph')).filter(glyph => glyph.getClientRects().length).length,
          visibleQuadrants: quadrants.filter(quadrant => quadrant.getClientRects().length).length,
          quadrantSizes: quadrants.map(quadrant => quadrant.querySelectorAll('.rr-tooth-option').length),
          quadrantOrder: quadrants.map(quadrant => quadrant.dataset.quadrant).join(','),
          bodyFullyVisible: Boolean(bodyRect && bodyRect.top >= 63 && bodyRect.bottom <= innerHeight - 60),
          bodyNeedsScroll: Boolean(body && body.scrollHeight > body.clientHeight + 1),
          hostScroll: element.closest('.rr-host')?.scrollTop || 0,
          itemsScroll: element.closest('.rr-items')?.scrollTop || 0
        };
      });
      if (!openPicker.horizontalFit || openPicker.overflow || openPicker.visibleOptions !== 32 || openPicker.visibleGlyphs !== 32 || openPicker.visibleQuadrants !== 4 || openPicker.quadrantOrder !== '1,2,4,3' || openPicker.quadrantSizes.some(size => size !== 8) || !openPicker.bodyFullyVisible || openPicker.bodyNeedsScroll || openPicker.hostScroll || openPicker.itemsScroll) throw new Error(`Anatomical FDI picker overflowed at ${item.width}px: ${JSON.stringify(openPicker)}`);
      await page.screenshot({ path: path.join(output, `${item.name}-tooth-picker.png`), fullPage: false });
      await page.getByRole('button', { name: 'Cerrar selector de pieza', exact: true }).click();
      if (await picker.evaluate(element => element.open)) throw new Error(`Compact FDI picker did not close at ${item.width}px`);
    }
    if (item.name === 'desktop') {
      const picker = page.locator('.rr-item[aria-current="true"] .rr-tooth-picker');
      await picker.locator(':scope > summary').click();
      if (!await picker.evaluate(element => element.open)) throw new Error('Compact FDI picker did not open from its summary');
      const selected = picker.getByRole('radio', { name: 'Pieza FDI 46', exact: true });
      if (await selected.getAttribute('aria-checked') !== 'true') throw new Error('Compact FDI picker did not expose the current piece as selected');
      await selected.focus();
      await selected.press('ArrowUp');
      let focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focusedLabel !== 'Pieza FDI 16') throw new Error(`Anatomical FDI vertical navigation failed: ${focusedLabel}`);
      await page.keyboard.press('ArrowDown');
      focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focusedLabel !== 'Pieza FDI 46') throw new Error(`Anatomical FDI vertical return failed: ${focusedLabel}`);
      const upperMidline = picker.getByRole('radio', { name: 'Pieza FDI 11', exact: true });
      await upperMidline.focus();
      await upperMidline.press('ArrowRight');
      focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focusedLabel !== 'Pieza FDI 21') throw new Error(`Upper FDI midline crossing failed: ${focusedLabel}`);
      const lowerMidline = picker.getByRole('radio', { name: 'Pieza FDI 41', exact: true });
      await lowerMidline.focus();
      await lowerMidline.press('ArrowRight');
      focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focusedLabel !== 'Pieza FDI 31') throw new Error(`Lower FDI midline crossing failed: ${focusedLabel}`);
      await selected.focus();
      await selected.press('ArrowLeft');
      focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focusedLabel !== 'Pieza FDI 47') throw new Error(`Compact FDI keyboard navigation failed: ${focusedLabel}`);
      await page.keyboard.press('Enter');
      await page.locator('.rr-tooth-picker > summary').waitFor();
      if (!(await page.locator('.rr-tooth-current').textContent()).includes('47')) throw new Error('Compact FDI picker did not synchronize the selected piece');
    }
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
      const finalAction=page.getByRole('button',{name:'Confirmar y continuar',exact:true});
      await finalAction.scrollIntoViewIfNeeded();
      const reachable = await page.evaluate(() => {
        const action=document.querySelector('[data-rr-decision="confirm"]'),host=document.querySelector('.rr-host');
        if(!action||!host)return false;const box=action.getBoundingClientRect(),viewport=window.innerHeight||document.documentElement.clientHeight;return box.top>=0&&box.bottom<=viewport;
      });
      if (!reachable) throw new Error(`Signal decision is not reachable at ${item.width}px`);
      await page.locator('.rr-host').evaluate(element=>{element.scrollTop=0;});
    }
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    if (item.name === 'desktop') {
      if (await page.locator('.rr-item-body').count() !== 1) throw new Error('Filtered signal did not become the active task');
      const text = page.locator('.rr-item-body textarea');
      await text.fill('Cambio de densidad por comprobar con revisión profesional.');
      await page.getByRole('button', { name: 'Confirmar y continuar', exact: true }).click();
      if (!(await page.locator('.rr-feedback').textContent()).includes('Ubica la señal')) throw new Error('Placement guidance disappeared after rendering');
      await page.locator('.rr-image-stage > img').click({position:{x:220,y:250}});
      await page.getByRole('button', { name: 'Confirmar y continuar', exact: true }).click();
      await page.waitForFunction(()=>document.querySelector('.rr-feedback')?.textContent.includes('Señal 1 guardada'));
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
  if (report.some(item => item.rootOverflow || item.dialogOverflow || item.sameRow !== item.expectedSameRow || !item.layoutOrder || item.workspaceUse < .9 || item.signals !== 1 || item.expandedSignals !== 1 || item.filters !== 0 || item.queue !== 1 || item.tools !== 0 || (item.width >= 640 && !item.decisionVisibleWithoutScroll) || item.initialHostScroll || item.initialItemsScroll || item.toothPickerCount !== 1 || item.toothPickerOpen || item.toothPickerSummaryHeight < 36 || item.toothPickerSummaryHeight > 56 || item.toothPickerOverflow || item.toothRadioCount !== 32 || item.toothRadioLabels !== 32 || item.toothTabStopCount !== 1 || item.toothGlyphCount !== 32 || item.toothFamilies !== 'canine,incisor,molar,premolar' || item.quadrantCount !== 4 || item.quadrantOrder !== '1,2,4,3' || item.quadrantLabels !== 4 || !item.quadrantCrossVisible || item.selectedTooth !== '46' || item.nativeToothSelects || (item.width < 960 && item.cleanSavePosition === 'sticky') || item.minButtonHeight < (item.name.startsWith('mobile') ? 44 : 36) || (item.width >= 960 && (item.canvasRatio < .62 || item.canvasRatio > .75)))) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
