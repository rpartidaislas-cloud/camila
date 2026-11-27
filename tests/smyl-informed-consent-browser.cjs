const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const out = path.resolve(root, '../output/informed-consent-v3');
fs.mkdirSync(out, { recursive: true });

let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  playwright = require(path.join(
    process.env.SMYL_NODE_MODULES || path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),
    'playwright'
  ));
}

async function drawSignature(page, canvas) {
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 100 && box.height > 80, 'el lienzo de firma debe ser visible');
  await page.mouse.move(box.x + 35, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.72, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.42, { steps: 8 });
  await page.mouse.up();
}

async function reachSignatureStep(dialog) {
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('checkbox', { name: /Confirmo que expliqué el procedimiento/ }).check();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('button', { name: 'Firmar con mi celular' }).waitFor();
}

test('consentimiento: dos rutas de firma, una sola finalización y evidencia visible', { timeout: 120000 }, async (t) => {
  const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.print = () => { window.__printRequested = true; };
    window.confirm = () => true;
  });

  await page.goto(pathToFileURL(path.join(root, 'tests/fixtures/smyl-informed-consent-v2-preview.html')).href);
  await page.getByRole('button', { name: 'Nuevo consentimiento' }).waitFor();
  await page.getByRole('button', { name: 'Nuevo consentimiento' }).click();
  let dialog = page.locator('.ic-dialog');
  await dialog.waitFor();
  assert.match(await dialog.locator('.ic-stepper').innerText(), /Procedimiento[\s\S]*Documento[\s\S]*Explicación[\s\S]*Firma del paciente[\s\S]*Confirmar y guardar/);
  await reachSignatureStep(dialog);
  assert.equal(await dialog.getByRole('button', { name: 'Firmar con mi celular' }).count(), 1);
  assert.equal(await dialog.getByRole('button', { name: 'Firmar en este dispositivo' }).count(), 1);
  assert.doesNotMatch(await dialog.innerText(), /WhatsApp/i);
  await page.screenshot({ path: path.join(out, 'firma-opciones-desktop.png') });

  await dialog.getByRole('button', { name: 'Firmar en este dispositivo' }).click();
  let canvas = dialog.locator('canvas');
  await canvas.waitFor();
  const accidental = await canvas.boundingBox();
  await page.mouse.click(accidental.x + 20, accidental.y + 20);
  assert.match(await dialog.locator('.ic-sign-state').innerText(), /Pendiente/);
  await dialog.getByRole('checkbox', { name: /Leí o recibí la lectura/ }).check();
  await drawSignature(page, canvas);
  assert.match(await dialog.locator('.ic-sign-state').innerText(), /Trazo listo/);
  await dialog.getByRole('button', { name: 'Revisar firma' }).click();
  await dialog.getByAltText('Vista previa de la firma del paciente').waitFor();
  await dialog.getByRole('button', { name: 'Usar esta firma' }).click();
  await dialog.getByText('Firma lista para la revisión final').waitFor();

  await dialog.getByLabel('Relación con el paciente').selectOption('guardian');
  assert.equal(await dialog.getByText('Firma lista para la revisión final').count(), 0, 'cambiar al firmante invalida la firma anterior');
  await dialog.getByLabel('Nombre completo de quien firma *').fill('Ana Tutora');
  await dialog.getByRole('button', { name: 'Firmar en este dispositivo' }).click();
  await dialog.getByRole('checkbox', { name: /Leí o recibí la lectura/ }).check();
  canvas = dialog.locator('canvas');
  await drawSignature(page, canvas);
  await dialog.getByRole('button', { name: 'Revisar firma' }).click();
  await dialog.getByRole('button', { name: 'Usar esta firma' }).click();
  await dialog.getByRole('button', { name: 'Revisar y guardar' }).click();
  assert.match(await dialog.locator('[data-stage="confirm"]').innerText(), /Dispositivo de la clínica/);
  assert.match(await dialog.locator('[data-stage="confirm"]').innerText(), /verificaste presencialmente/);
  await page.screenshot({ path: path.join(out, 'confirmacion-local-desktop.png') });
  await dialog.getByRole('button', { name: 'Confirmar identidad profesional y guardar' }).click();
  await dialog.getByText('Consentimiento incorporado al expediente', { exact: true }).waitFor();

  const localCall = await page.evaluate(() => window.__icCalls.filter((item) => item.name === 'smyl_finalize_informed_consent_signature')[0]);
  assert.equal(localCall.args.p_link_token, null);
  assert.match(localCall.args.p_signature_png, /^data:image\/png;base64,/);
  assert.equal(localCall.args.p_identity_verified, true);
  assert.equal(localCall.args.p_patient_accepted, true);
  assert.equal(localCall.args.p_signer_relation, 'guardian');
  assert.equal(localCall.args.p_signer_name, 'Ana Tutora');

  await dialog.getByRole('button', { name: 'Ver documento' }).click();
  let documentDialog = page.locator('.ic-document-dialog');
  await documentDialog.waitFor();
  const documentText = await documentDialog.innerText();
  assert.match(documentText, /Huella del documento/);
  assert.match(documentText, /Huella de la firma/);
  assert.match(documentText, /Huella del paquete de evidencia/);
  assert.match(documentText, /Firma en dispositivo de la clínica/);
  await documentDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.evaluate(() => {
    window.__remoteReady = false;
    window.__remotePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAADICAYAAAA0n5+2AAAABmJLR0QA/wD/AP+gvaeTAAAAFElEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAwG4G4AABfX2wkgAAAABJRU5ErkJggg==';
  });
  await page.getByRole('button', { name: 'Nuevo consentimiento' }).click();
  dialog = page.locator('.ic-dialog');
  await reachSignatureStep(dialog);
  await dialog.getByRole('button', { name: 'Firmar con mi celular' }).click();
  await dialog.getByText('Escanea este código con el celular').waitFor();
  await page.evaluate(() => { window.__remoteReady = true; });
  await dialog.getByAltText('Vista previa de la firma del paciente').waitFor({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Usar esta firma' }).click();
  await dialog.getByRole('button', { name: 'Revisar y guardar' }).click();
  assert.match(await dialog.locator('[data-stage="confirm"]').innerText(), /Celular mediante QR/);
  await dialog.getByRole('button', { name: 'Confirmar identidad profesional y guardar' }).click();
  await dialog.getByText('Consentimiento incorporado al expediente', { exact: true }).waitFor();
  const qrCall = await page.evaluate(() => window.__icCalls.filter((item) => item.name === 'smyl_finalize_informed_consent_signature')[1]);
  assert.equal(qrCall.args.p_signature_png, null);
  assert.equal(qrCall.args.p_link_token, 'a'.repeat(64));
  assert.equal(qrCall.args.p_identity_verified, true);
  assert.equal(qrCall.args.p_patient_accepted, true);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Nuevo/ }).click();
  dialog = page.locator('.ic-dialog');
  await dialog.waitFor();
  assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'flujo clínico sin desborde móvil');
  await page.screenshot({ path: path.join(out, 'flujo-clinica-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Cerrar consentimiento' }).click();
  assert.deepEqual(errors, []);
});

test('página del paciente: documento, aceptación, firma, vista previa y envío', { timeout: 120000 }, async (t) => {
  const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const token = 'b'.repeat(64);
  const calls = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://rpxshsiwoxdbuevjjpfw.supabase.co/rest/v1/rpc/**', async (route) => {
    const name = route.request().url().split('/').pop();
    const body = route.request().postDataJSON();
    calls.push({ name, body });
    if (name === 'smyl_informed_consent_signature_link_info') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        available: true,
        clinic_name: 'Clínica Centro',
        patient_name: 'Mariana López',
        signer_name: 'Mariana López',
        signer_relation: 'patient',
        procedure_title: 'Extracción dental',
        document_text: 'CONSENTIMIENTO INFORMADO\n\nProcedimiento: Extracción dental\n\nRiesgos, beneficios y alternativas explicados al paciente. Esta es la versión exacta que quedará firmada.',
        document_sha256: 'd'.repeat(64),
        reference: 'IC-QR01',
        acceptance_text: 'Leí o recibí la lectura de este documento, pude hacer preguntas y autorizo libremente el procedimiento descrito.',
        expires_at: new Date(Date.now() + 300000).toISOString()
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ captured: true }) });
  });

  await page.goto(pathToFileURL(path.join(root, 'firma-consentimiento.html')).href + '#token=' + token);
  await page.getByRole('heading', { name: 'Revisa este consentimiento' }).waitFor();
  assert.equal(new URL(page.url()).hash, '', 'el token se retira del historial visible');
  const publicText = await page.locator('#ics-main').innerText();
  assert.match(publicText, /Extracción dental/);
  assert.match(publicText, /Mariana López/);
  assert.match(publicText, /IC-QR01/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuar a la firma' }).click();
  const canvas = page.getByRole('img', { name: 'Área para dibujar la firma con el dedo' });
  await drawSignature(page, canvas);
  await page.getByRole('button', { name: 'Revisar firma' }).click();
  await page.getByRole('heading', { name: 'Confirma tu firma' }).waitFor();
  await page.getByAltText('Vista previa de la firma dibujada').waitFor();
  await page.screenshot({ path: path.join(out, 'firma-paciente-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirmar y enviar' }).click();
  await page.getByRole('heading', { name: 'Firma enviada a la clínica' }).waitFor();

  const submit = calls.find((item) => item.name === 'smyl_submit_informed_consent_signature');
  assert.ok(submit, 'se envía la firma al RPC público');
  assert.equal(submit.body.p_token, token);
  assert.equal(submit.body.p_accepted, true);
  assert.match(submit.body.p_signature_png, /^data:image\/png;base64,/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'página del paciente sin desborde móvil');
  assert.deepEqual(errors, []);
});
