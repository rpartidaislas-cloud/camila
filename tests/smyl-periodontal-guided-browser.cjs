// Exercises the review dialog, the canonical clinical draft and guided capture together.
// Recognition, speech playback and the persistence boundary use synthetic data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const scripts = ['smyl-dental-model', 'smyl-dental-dictation', 'smyl-periodontal-context',
  'smyl-periodontal-mila', 'smyl-periodontal-graph', 'smyl-periodontal-guided-model',
  'smyl-periodontal-guided', 'smyl-periodontal-review'];

function installSpeech(available) {
  const audio = window.audioFixture = { turns: [], playback: [], active: null, playing: false, overlap: false };
  class Recognition {
    start() {
      if (audio.active || audio.playing) audio.overlap = true;
      audio.active = this;
      audio.turns.push(this);
      queueMicrotask(() => this.onstart?.());
    }
    stop() {
      if (audio.active !== this) return;
      audio.active = null;
      setTimeout(() => this.onend?.(), 0);
    }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = available ? Recognition : undefined;
  window.webkitSpeechRecognition = undefined;
  let playbackTimer;
  const synthesis = {
    getVoices: () => [{ name: 'Prueba', lang: 'es-MX', localService: true }],
    speak(prompt) {
      if (audio.active) audio.overlap = true;
      audio.playing = true;
      audio.playback.push(prompt.text);
      playbackTimer = setTimeout(() => { audio.playing = false; prompt.onend?.(); }, 8);
    },
    cancel() { clearTimeout(playbackTimer); audio.playing = false; },
    get speaking() { return audio.playing; }
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  audio.result = (text, final = true, confidence = .98) => {
    const rec = audio.active;
    if (!rec) throw new Error('The microphone must be listening');
    const result = [{ transcript: text, confidence }];
    result.isFinal = final;
    const event = { resultIndex: 0, results: [result] };
    const callback = rec.onresult;
    audio.repeatLast = () => callback?.call(rec, event);
    audio.repeatLast();
    if (final) rec.stop();
  };
  audio.deny = () => {
    const rec = audio.active;
    if (!rec) throw new Error('The microphone must be listening');
    rec.onerror?.({ error: 'not-allowed' });
    rec.stop();
  };
}

async function makePage(browser, width, voice = true) {
  const page = await browser.newPage({ viewport: { width, height: width > 700 ? 900 : 844 },
    hasTouch: width <= 700, isMobile: width <= 700, locale: 'es-MX', reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  page.on('dialog', dialog => dialog.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://smyl.test/**', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html lang="es"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:16px system-ui}[hidden]{display:none!important}</style><main id="fixture"></main></html>' }));
  await page.goto('https://smyl.test/guided');
  for (const name of ['smyl-periodontal-review','smyl-periodontal-graph','smyl-periodontal-guided']) {
    await page.addStyleTag({ path: path.join(root, name + '.css') });
  }
  for (const name of scripts) await page.addScriptTag({ path: path.join(root, name + '.js') });
  await page.evaluate(installSpeech, voice);
  await page.evaluate(() => {
    const model = window.SmylDentalModel;
    const doc = model.empty();
    doc.periodontogram = model.createPeriodontalExam('2026-11-20');
    doc.findings.events.push(model.createFinding({ tooth:'14', surface:'whole', conditionCode:'missing' }));
    doc.periodontogram.teeth[16] = { MB: { depth:null, margin:-1, bleeding:true } };
    const ctx = window.record = { doc, savedDoc:structuredClone(doc), canWrite:true, ready:true, busy:false, dirty:false };
    window.savedVersions = [];
    window.readable = true;
    let editor;
    const access = window.SmylPeriodontalContext.create(ctx, { model, readable:() => window.readable,
      markDirty:() => { ctx.dirty = true; }, getFindings:() => [], readHistory:async () => [],
      notify:() => editor?.update(), saveDocument:async () => {
        ctx.savedDoc = structuredClone(ctx.doc);
        window.savedVersions.push(ctx.savedDoc);
        ctx.dirty = false; ctx.perioDirty = false;
        return true;
      }
    });
    editor = window.editor = window.SmylPeriodontalReview.mount(document.querySelector('#fixture'), {
      ...access, tenantId:'test-clinic', patientId:'test-patient', tooth:'16'
    });
    editor.open('chart');
  });
  return { page, errors, dialog:page.locator('dialog.perio-dialog[open]') };
}

const button = (scope, name) => scope.getByRole('button', { name, exact:true });
const original = {16: {MB:{depth:null, margin:-1, bleeding:true}}};
async function withPage(browser, width, voice, run) {
  const fixture = await makePage(browser, width, voice);
  try {
    await run(fixture);
    assert.deepEqual(fixture.errors, []);
  } catch (error) {
    const screen = await fixture.dialog.innerText({timeout:500}).catch(() => '');
    console.error({width, pageErrors:fixture.errors, screen:screen.slice(-1800)});
    throw error;
  } finally {
    await fixture.page.close();
  }
}
async function unchanged(page) {
  assert.deepEqual(await page.evaluate(() => record.doc.periodontogram.teeth), original, 'Proposals are isolated from the clinical draft');
  assert.equal(await page.evaluate(() => savedVersions.length), 0);
}
async function setup(dialog, manualAdvance = false) {
  await button(dialog, 'Iniciar sondaje guiado').click();
  await dialog.getByLabel('Pieza inicial', {exact:true}).selectOption('16');
  await dialog.getByLabel('Cara inicial', {exact:true}).selectOption('V');
  await dialog.getByLabel('Sentido del recorrido', {exact:true}).selectOption('forward');
  await dialog.getByLabel('Avance automático', {exact:true}).setChecked(!manualAdvance);
}
async function listen(page) {
  await page.waitForFunction(() => !!audioFixture.active?.onresult);
}
async function say(page, text, final = true, confidence = .98) {
  await listen(page);
  await page.evaluate(({text, final, confidence}) => audioFixture.result(text, final, confidence), {text, final, confidence});
}
async function typeCommand(dialog, text) {
  await dialog.getByRole('textbox', {name:'Medidas o comando'}).fill(text);
  await button(dialog, 'Aplicar entrada').click();
}
async function checkVoice(browser, width) {
  await withPage(browser, width, true, async ({page,dialog}) => {
    await setup(dialog);
    await button(dialog, 'Iniciar micrófono').click();
    const activeTooth = dialog.locator('.perio-guide-graph .pg-tooth-label.pg-current');
    assert.equal(await activeTooth.textContent(), '16');
    await say(page, 'puedes descansar un momento');
    assert.deepEqual(await dialog.locator('.pgd-readings dd').allTextContents(), ['—','—','—']);
    assert.equal(await activeTooth.textContent(), '16');
    await say(page, 'siete siete siete', true, .1);
    assert.deepEqual(await dialog.locator('.pgd-readings dd').allTextContents(), ['—','—','—'], 'Reported low confidence leaves sites unmeasured');
    assert.equal(await activeTooth.textContent(), '16');
    await say(page, 'tres cuatro cinco', false);
    await unchanged(page);
    await say(page, 'tres cuatro cinco', true, 0); // Several providers use zero for unknown confidence.
    await listen(page);
    assert.equal(await activeTooth.textContent(), '15');
    await page.evaluate(() => audioFixture.repeatLast()); // Duplicate from the preceding capture turn.
    await say(page, 'corrige la dieciséis vestibular central a siete');
    assert.equal(await activeTooth.textContent(), '15');
    await say(page, 'dos tres');
    assert.deepEqual(await dialog.locator('.pgd-readings dd').allTextContents(), ['2','3','—']);
    await say(page, 'pausa');
    const resume = button(dialog, 'Reanudar');
    await resume.waitFor();
    assert.equal(await page.evaluate(() => Boolean(audioFixture.active)), false);
    await unchanged(page);
    await resume.click();
    await say(page, 'cuatro');
    assert.equal(await activeTooth.textContent(), '13', 'FDI 14 is absent');
    await say(page, 'saltar');
    assert.equal(await activeTooth.textContent(), '12');
    await button(dialog, 'Terminar recorrido').click();
    await unchanged(page);
    await button(dialog, 'Aplicar al borrador').click();
    const draft = await page.evaluate(() => record.doc.periodontogram.teeth);
    assert.deepEqual(Object.keys(draft).sort(), ['15','16']);
    assert.deepEqual(draft[16].MB, {depth:3,margin:-1,bleeding:true});
    assert.deepEqual(draft[16].B, {depth:7,margin:null,bleeding:null});
    assert.equal(draft[16].DB.depth, 5);
    assert.deepEqual(['MB','B','DB'].map(site => draft[15][site].depth), [2,3,4]);
    assert.equal(await page.evaluate(() => savedVersions.length), 0);
    await button(dialog, 'Guardar mediciones').click();
    await page.waitForFunction(() => savedVersions.length === 1);
    assert.deepEqual(await page.evaluate(() => savedVersions[0].periodontogram.teeth), draft);
    assert.equal(await page.evaluate(() => audioFixture.overlap), false, 'Recognition must be silent during prompts');
    assert.ok(await page.evaluate(() => audioFixture.playback.length > 1), 'Spoken feedback was exercised');
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No horizontal overflow in the host dialog');
  });
}

async function checkFallback(browser) {
  await withPage(browser, 390, false, async ({page,dialog}) => {
    await setup(dialog, true);
    await button(dialog, 'Usar teclado').click();
    await typeCommand(dialog, 'tres cuatro cinco');
    await typeCommand(dialog, 'corrige el central a dos');
    await typeCommand(dialog, 'siguiente');
    await typeCommand(dialog, 'seis');
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No horizontal overflow during capture');
    await button(dialog, 'Terminar recorrido').click();
    await dialog.locator('summary').filter({hasText:'Revisar pendientes'}).click();
    const pending = dialog.getByLabel('Sitio pendiente', {exact:true});
    assert.equal(await pending.locator('option[value="16:V"]').count(), 0, 'Completed sites leave the pending list');
    assert.equal(await pending.locator('option[value="14:V"]').count(), 0, 'Absent teeth are never requested');
    await pending.selectOption('15:V');
    await button(dialog, 'Ir a pendiente').click();
    assert.equal(await dialog.locator('.pgd-tooth').textContent(), 'Pieza 15');
    assert.deepEqual(await dialog.locator('.pgd-readings dd').allTextContents(), ['6','—','—']);
    await button(dialog, 'Terminar recorrido').click();
    await unchanged(page);
    await button(dialog, 'Aplicar al borrador').click();
    assert.equal(await page.evaluate(() => record.doc.periodontogram.teeth[16].B.depth), 2);
    assert.deepEqual(await page.evaluate(() => record.doc.periodontogram.teeth[15]), {MB:{depth:6,margin:null,bleeding:null}});
  });
}

async function checkExit(browser) {
  await withPage(browser, 320, true, async ({page,dialog}) => {
    await setup(dialog);
    await button(dialog, 'Iniciar micrófono').click();
    await say(page, 'tres cuatro cinco');
    await listen(page);
    await page.keyboard.press('Escape');
    await button(dialog, 'Seguir en la guía').click();
    await button(dialog, 'Reanudar').click();
    await listen(page);
    await button(dialog, 'Cerrar periodontograma').click();
    await button(dialog, 'Descartar y salir').click();
    await button(dialog, 'Iniciar sondaje guiado').waitFor();
    await unchanged(page);
    assert.equal(await page.evaluate(() => Boolean(audioFixture.active)), false);
  });
}

async function checkQuadrant(browser) {
  await withPage(browser, 820, true, async ({page,dialog}) => {
    await setup(dialog);
    await dialog.getByLabel('Pieza inicial', {exact:true}).selectOption('18');
    await button(dialog, 'Iniciar micrófono').click();
    const expected = ['18','17','16','15','13','12','11']; // Confirmed absence of 14.
    const activeTooth = dialog.locator('.perio-guide-graph .pg-tooth-label.pg-current');
    for (const tooth of expected) {
      await listen(page);
      assert.equal(await activeTooth.textContent(), tooth);
      await say(page, 'dos tres cuatro');
    }
    assert.equal(await activeTooth.textContent(), '21');
    await button(dialog, 'Terminar recorrido').click();
    await unchanged(page);
    await button(dialog, 'Aplicar al borrador').click();
    const captured = await page.evaluate(() => record.doc.periodontogram.teeth);
    assert.deepEqual(Object.keys(captured).sort(), [...expected].sort());
    for (const tooth of expected) assert.deepEqual(['MB','B','DB'].map(site => captured[tooth][site].depth), [2,3,4]);
    assert.equal(await page.evaluate(() => savedVersions.length), 0);
  });
}

async function checkInterruption(browser) {
  await withPage(browser, 1280, true, async ({page,dialog}) => {
    await setup(dialog);
    await button(dialog, 'Iniciar micrófono').click();
    await say(page, 'tres cuatro cinco');
    await listen(page);
    await page.evaluate(() => audioFixture.deny());
    await unchanged(page);
    assert.equal(await page.evaluate(() => Boolean(audioFixture.active)), false);
    await button(dialog, 'Usar teclado').click();
    await typeCommand(dialog, 'dos cuatro cinco');
    await button(dialog, 'Terminar recorrido').click();
    await button(dialog, 'Aplicar al borrador').click();
    assert.equal(await page.evaluate(() => record.doc.periodontogram.teeth[16].DB.depth), 5);
    assert.equal(await page.evaluate(() => record.doc.periodontogram.teeth[15].MB.depth), 2);
    assert.equal(await page.evaluate(() => savedVersions.length), 0);
  });
}

async function checkAccessLost(browser) {
  await withPage(browser, 390, true, async ({page,dialog}) => {
    await setup(dialog);
    await button(dialog, 'Iniciar micrófono').click();
    await say(page, 'tres cuatro cinco');
    await listen(page);
    await page.evaluate(() => {
      const active = audioFixture.active;
      const lateResult = active.onresult;
      window.readable = false;
      editor.update();
      const result = [{ transcript:'seis seis seis', confidence: .99 }];
      result.isFinal = true;
      lateResult.call(active, {resultIndex:0, results:[result]});
    });
    await dialog.waitFor({state:'detached'});
    await unchanged(page);
    assert.equal(await page.evaluate(() => Boolean(audioFixture.active)), false);
  });
}

(async () => {
  const browser = await chromium.launch({ headless:true,
    executablePath: process.env.CHROME_PATH || (process.platform==='win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined) });
  try {
    for (const width of [1440, 390]) await checkVoice(browser, width);
    await checkQuadrant(browser);
    await checkFallback(browser);
    await checkExit(browser);
    await checkInterruption(browser);
    await checkAccessLost(browser);
    console.log('Guided probing passed voice, draft, keyboard, interruption and mobile checks.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
