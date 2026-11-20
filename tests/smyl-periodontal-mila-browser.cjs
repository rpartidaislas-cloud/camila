// Synthetic patient, controlled recognition and mocked private endpoint. No real audio or credits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const from = process.env.USERPROFILE || '';
const playwright = ['playwright', path.resolve(root, '../promodesk-smyl-stage4/node_modules/playwright'),
  path.join(from, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')]
  .map(candidate => { try { return require.resolve(candidate); } catch { return null; } }).find(Boolean);

(async () => {
  const browser = await require(playwright).chromium.launch({ headless: true, executablePath: process.env.SMYL_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    for (const width of [320, 390, 820, 1100]) {
      const page = await browser.newPage({ viewport: { width, height: 780 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setContent('<main><div id="tools"></div></main>');
      for (const file of ['smyl-dental-dictation.js','smyl-periodontal-mila.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root,file),'utf8') });
      await page.addStyleTag({ path: path.join(root, 'smyl-periodontal-mila.css') });
      await page.evaluate(() => {
        const saved = { id: 'synthetic-exam', date: '2026-04-12', teeth: { 16: { B: { depth: 3, margin: null, bleeding: false } } } };
        window.ctx = { tooth: '16', patientId: 'synthetic', canEdit: true, sessionKey: 'synthetic:exam', current: { ...saved, summary:'Nota existente.' }, confirmed: saved };
        window.patches = [];
        window.hr = 0;
        window.SpeechRecognition = class { start() { window.latest = this; } abort() { window.hr++; } };
        window.sb = { auth: {
          getSession: async () => ({ data: { session: { access_token: 'test' } } }),
          onAuthStateChange: fn => { window.notifyAuth = fn; return { data: { subscription: { unsubscribe() { window.notifyAuth = null; } } } }; }
        } };
        window.SUPA_URL = 'https://invalid.test';
        window.fetch = async (_url, settings) => {
          window.providerInput = JSON.parse(settings.body);
          if (window.showError) return Response.json({error: 'Servicio temporalmente ocupado.'}, {status: 503});
          return Response.json({ indices: [0] });
        };
        window.mount = () => window.mila = window.SmylPeriodontalMila.mount(document.querySelector('#tools'), {
          getContext: () => ctx, onApply: patch => { patches.push(patch); return true; }
        });
        mount();
      });
      const click = label => page.getByRole('button', { name: label, exact: true }).click();
      const listen = async () => { await click('Dictar sondaje'); await click('Iniciar micrófono'); };
      const speak = text => page.evaluate(t => window.latest.onresult({ results: [{ 0: { transcript: t }, isFinal: true }] }), text);
      await page.getByText('Asistencia de MILA', {exact: true}).click();
      await listen(); await speak('pieza dieciséis vestibular tres cuatro cinco');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      assert.deepEqual(await page.evaluate(() => patches), []);
      await page.getByLabel('Central (mm)').fill('7');
      await click('Aplicar al borrador');
      assert.deepEqual(await page.evaluate(() => patches), [{ tooth:'16', face:'V', values:[3,7,5] }]);
      await listen(); await speak('pieza 36 lingual tres tres tres');
      assert.match(await page.getByRole('status').innerText(), /Estás editando la 16/);
      await listen();
      await page.evaluate(() => window.latest.onerror({error:'not-allowed'}));
      assert.match(await page.getByRole('status').innerText(), /micrófono está desactivado/);
      await listen();
      await page.evaluate(() => {
        window.late = latest.onresult;
        window.dispatchEvent(new Event('offline'));
        late({results:[{0:{transcript:'pieza 16 vestibular 1 2 3'},isFinal:true}]});
      });
      assert.equal(await page.getByLabel('Central (mm)').count(),0);
      await click('Resumir esta pieza'); await click('Generar resumen');
      assert.match(await page.getByLabel('Resumen propuesto').inputValue(), /sondaje 3 mm/);
      await page.getByLabel('Resumen propuesto').fill('Resumen revisado.');
      await click('Incorporar al resumen');
      assert.deepEqual(await page.evaluate(() => patches[1]), { summary:'Nota existente.\n\nResumen revisado.' });
      await page.evaluate(() => { window.showError = true; });
      await click('Resumir esta pieza'); await click('Generar resumen');
      await page.getByText('Servicio temporalmente ocupado.').waitFor();
      await page.evaluate(() => { window.showError = false; });
      await click('Resumir esta pieza'); await click('Generar resumen');
      await page.getByLabel('Resumen propuesto').waitFor();
      await page.evaluate(() => { ctx.confirmed.teeth[16].B.depth = 6; });
      await click('Incorporar al resumen');
      assert.match(await page.getByRole('status').innerText(), /registro cambió/);
      await listen();
      await page.evaluate(() => {
        const late = latest.onresult;
        ctx.tooth = '36'; ctx.sessionKey = 'different';
        mila.destroy();
        late({ results:[{0:{transcript:'pieza 16 vestibular 5 7 8'},isFinal:true}] });
      });
      assert.equal(await page.evaluate(() => patches.length), 2);
      assert.equal(await page.evaluate(() => window.latest.onresult), null);
      await page.evaluate(() => { ctx.tooth = '16'; mount(); });
      await page.getByText('Asistencia de MILA',{exact:true}).click();
      await listen(); await page.evaluate(() => notifyAuth('SIGNED_OUT', null));
      assert.equal(await page.evaluate(() => window.latest.onresult), null);
      assert.match(await page.getByRole('status').innerText(), /sesión cambió/);
      await page.evaluate(() => { mila.destroy(); window.SpeechRecognition = null; window.webkitSpeechRecognition = null; mount(); });
      await page.getByText('Asistencia de MILA',{exact:true}).click(); await click('Dictar sondaje');
      assert.match(await page.getByRole('status').innerText(), /captura manual/);
      assert.deepEqual(errors, []);
      await page.close();
      console.log('OK, dictado, resumen, fallos y cambio de contexto a ' + width + ' px.');
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
