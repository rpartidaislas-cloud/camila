const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-evidence-center-integration-preview.html').replace(/\\/g, '/')}`;
  await page.goto(fixture);
  await page.locator('.seci-root').waitFor();

  await page.evaluate(() => {
    const editor = document.createElement('details');
    editor.className = 'cw-advanced-editor';
    editor.hidden = true;
    editor.innerHTML = `
      <summary>Cargador radiográfico</summary>
      <form class="dr-record">
        <label class="dr-study-type">
          Tipo de estudio
          <select>
            <option value="panoramic">Panorámica</option>
            <option value="periapical">Periapical</option>
            <option value="bitewing">Bitewing</option>
            <option value="other">Otro</option>
          </select>
        </label>
        <div class="dr-upload-fields">
          <input type="text" aria-label="Nombre del estudio">
          <input type="date" aria-label="Fecha del estudio radiográfico">
          <input type="file" accept="image/jpeg,image/png" aria-label="Archivo radiográfico">
        </div>
      </form>`;
    document.body.append(editor);
    window.__radiographIntakeCalls = 0;
    window.SmylCaseWorkspace.openRadiographIntake = payload => {
      window.__radiographIntakeCalls += 1;
      window.__radiographIntakePayload = payload;
      editor.hidden = false;
      editor.open = true;
      return editor;
    };
  });

  await page.locator('.seci-center .sec-primary').click();
  await page.getByRole('button', { name: 'Subir radiografía' }).click();
  await page.getByRole('button', { name: 'Panorámica', exact: true }).click();
  const dialog = page.locator('.sec-dialog[open]');
  await dialog.locator('input[name="evidenceFile"]').setInputFiles({
    name: 'panoramica-control.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  });
  await dialog.locator('input[name="date"]').fill('2026-11-11');
  await dialog.locator('input[name="title"]').fill('Panorámica de control');
  await dialog.getByRole('button', { name: 'Continuar al editor' }).click();

  await page.locator('.cw-advanced-editor[open]').waitFor();
  await page.waitForFunction(() => !document.querySelector('.sec-dialog')?.open);

  const result = await page.evaluate(() => {
    const editor = document.querySelector('.cw-advanced-editor');
    const form = editor.querySelector('.dr-record');
    const inputs = [...form.querySelectorAll('.dr-upload-fields input')];
    return {
      calls: window.__radiographIntakeCalls,
      payloadModality: window.__radiographIntakePayload?.modality,
      payloadSubtype: window.__radiographIntakePayload?.subtype,
      editorVisible: !editor.hidden && editor.open,
      type: form.querySelector('.dr-study-type select')?.value,
      title: inputs.find(input => input.type === 'text')?.value,
      date: inputs.find(input => input.type === 'date')?.value,
      fileCount: inputs.find(input => input.type === 'file')?.files?.length || 0,
      fileName: inputs.find(input => input.type === 'file')?.files?.[0]?.name || '',
      feedback: document.querySelector('.seci-feedback')?.textContent?.trim() || '',
      dialogOpen: document.querySelector('.sec-dialog')?.open === true
    };
  });

  assert.equal(result.calls, 1, 'the direct radiograph intake API should be called once');
  assert.equal(result.payloadModality, 'radiograph_2d');
  assert.equal(result.payloadSubtype, 'panoramic');
  assert.equal(result.editorVisible, true, 'the canonical radiograph editor should open');
  assert.equal(result.type, 'panoramic');
  assert.equal(result.title, 'Panorámica de control');
  assert.equal(result.date, '2026-11-11');
  assert.equal(result.fileCount, 1, 'the selected image should reach the canonical editor');
  assert.equal(result.fileName, 'panoramica-control.png');
  assert.match(result.feedback, /Radiografía preparada en el editor/);
  assert.equal(result.dialogOpen, false, 'the Evidence dialog should close after a successful handoff');
  assert.deepEqual(errors, [], `browser errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
