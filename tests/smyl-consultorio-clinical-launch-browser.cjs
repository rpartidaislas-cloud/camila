// Real frontends with synthetic records and private services simulated in memory.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const tenant = '11111111-1111-4111-8111-111111111111';
const patient = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const base = pathToFileURL(path.join(root, 'simulacion-rapida.html')).href;
const launch = '?from=consultorio&workspace=professional&clinic=' + tenant + '&patient=' + patient;

async function simulation(browser, scenario, query = launch) {
  const page = await browser.newPage();
  await page.route(/^https?:/, route => route.fulfill({status: 200, contentType: 'application/javascript', body: ''}));
  await page.addInitScript(({scenario, tenant, patient, other}) => {
    const log = window.testLog = {lookup: [], cases: [], uploads: [], urls: []};
    if (scenario === 'preferences-storage') {
      for (const key of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, key, {get() { throw Error('Storage unavailable'); }});
      }
    }
    let user = scenario === 'expired' ? null : {id: scenario === 'staff' ? other : tenant, is_anonymous: false};
    const session = () => user && {user, access_token: 'fixture', expires_at: Date.now() / 1000 + 3600};
    const authListeners = [];
    window.expireSession = () => { user = null; authListeners.forEach(fn => fn('SIGNED_OUT', null)); };
    window.supabase = {createClient: () => ({
      auth: {
        getSession: async () => { if (scenario === 'auth-storage') throw Error('Storage unavailable'); return {data: {session: session()}}; },
        getUser: async () => ({data: {user}}),
        onAuthStateChange: fn => authListeners.push(fn)
      },
      rpc: async (name, args) => {
        if (name === 'smyl_case_capabilities') return {data: {schema: 1, enabled: scenario !== 'denied', tenant_id: tenant, bucket: 'smyl-case-photos', private: true}};
        if (name !== 'smyl_save_patient_case') throw Error('Unexpected RPC ' + name);
        log.cases.push(args.p_patient_id);
        return {data: {id: args.p_id, tenant_id: tenant, patient_id: args.p_patient_id, document: args.p_document}};
      },
      from(table) {
        if (table !== 'camila_pacientes') throw Error('Unexpected table');
        const ids = {};
        return {
          select() { return this; },
          eq(key, value) { ids[key] = value; return this; },
          async single() {
            log.lookup.push(ids);
            return {data: {id: scenario === 'wrong-row' ? other : patient, tenant_id: tenant, nombre: 'Persona', apellido: 'Ficticia'}};
          }
        };
      },
      storage: {from: () => ({upload: async key => { log.uploads.push(key); if (window.failUpload) return {error: Error('Unavailable')}; return {data: {path: key}}; }})},
      functions: {invoke: async (_name, {body}) => ({data: {ok: !window.failUpload, ...body}})}
    })};
    window.fetch = async url => { log.urls.push(String(url)); return Response.json([]); };
  }, {scenario, tenant, patient, other});
  await page.goto(base + query);
  return page;
}

async function interview(browser) {
  const page = await browser.newPage();
  await page.setContent('<main><button id="source">Entrevista</button></main>');
  await page.addScriptTag({path: path.join(root, 'smyl-mila-interview.js')});
  await page.evaluate(({tenant, patient, other}) => {
    window.tenantId = tenant;
    window.SUPA_URL = 'https://clinic.invalid';
    window.sb = {auth: {getSession: async () => ({data: {session: {access_token: 'fixture'}}})}};
    window.pacienteActual = {id: patient, tenant_id: tenant, nombre: 'Persona', apellido: 'Ficticia'};
    window.actions = [];
    window.fetch = async (_url, {body}) => {
      const action = JSON.parse(body); window.actions.push(action);
      if (action.action === 'create') await new Promise(resolve => { window.finishCreate = resolve; });
      return Response.json({id: 'fixture-interview', token: 'fixture-token', expires_at: new Date(Date.now()+60000).toISOString()});
    };
    window.openTest = (overrides = {}) => SmylMilaInterview.open({tenant, patient, patientInfo: pacienteActual, view: 'clinic', ...overrides});
    window.otherPatient = other;
  }, {tenant, patient, other});
  assert.equal(await page.evaluate(() => openTest({patient: otherPatient})), false);
  assert.equal(await page.evaluate(() => openTest({tenant: otherPatient})), false);
  assert.equal(await page.evaluate(() => openTest()), true);
  await page.waitForFunction(() => !!window.finishCreate);
  assert.equal(await page.locator('#mila-iv-title').textContent(), 'Persona Ficticia');
  assert.ok(await page.getByText('Confirma el paciente y su consentimiento.').isVisible());
  await page.evaluate(() => {
    pacienteActual = {id: otherPatient, tenant_id: tenantId};
    dispatchEvent(new CustomEvent('smyl:patient-context-updated', {detail: {patient: otherPatient}}));
    finishCreate();
  });
  await page.waitForFunction(() => window.actions.some(row => row.action === 'close'));
  assert.deepEqual(await page.evaluate(() => actions), [{action: 'create', patient_id: patient}, {action: 'close', id: 'fixture-interview'}]);
  assert.equal(await page.locator('#smyl-mila-interview').isVisible(), false);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.SMYL_CHROMIUM});
  try {
    for (const [scenario, query] of [['staff'], ['expired'], ['auth-storage'], ['denied'], ['wrong-row'], ['public', launch + '&clinica=' + other], ['missing', '?from=consultorio&workspace=professional']]) {
      const page = await simulation(browser, scenario, query);
      await page.waitForSelector('html[data-consultorio-case="blocked"]');
      assert.equal(await page.getByRole('link', {name: 'Volver al consultorio'}).isVisible(), true);
      assert.equal(await page.locator('#s-intro').isVisible(), false);
      await page.evaluate(() => guardarCaso());
      assert.equal(await page.locator('#pc-save-dialog').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => testLog.cases), []);
      assert.equal(await page.evaluate(() => CFG.modoProspecto || testLog.urls.some(url => url.includes('_publico'))), false);
      await page.close();
    }
    for (const [query, publicMode] of [['?workspace=professional', false], ['?clinica=' + tenant, true]]) {
      const page = await simulation(browser, 'owner', query);
      await page.waitForSelector('#s-intro.active');
      assert.equal(await page.evaluate(() => CFG.modoProspecto), publicMode);
      assert.deepEqual(await page.evaluate(() => testLog.lookup), []);
      await page.close();
    }
    const page = await simulation(browser, 'preferences-storage');
    await page.waitForSelector('html[data-consultorio-case="ready"]');
    assert.deepEqual(await page.evaluate(() => testLog.lookup), [{tenant_id: tenant, id: patient}]);
    assert.ok(await page.getByText('Expediente de Persona Ficticia', {exact: true}).first().isVisible());
    await page.getByRole('button', {name: 'Crear simulación', exact: true}).click();
    assert.ok(await page.locator('#s-photos').isVisible());
    assert.equal(await page.evaluate(() => CFG.consultorioPatientId), patient);
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4;
      const image = canvas.toDataURL('image/png');
      S.photos = [{view: 'frontal', dataUrl: image}]; S.results = {frontal: image};
      S.smileDesign = {mode: 'veneers', arch: 'upper'};
      window.failUpload = true;
    });
    assert.equal(await page.locator('#btn-revision-clinica').textContent(), 'Revisar en el expediente');
    await page.evaluate(() => abrirRevisionClinica());
    assert.ok(page.url().startsWith(base));
    assert.deepEqual(await page.evaluate(() => testLog.cases), []);
    assert.equal(await page.locator('#pc-save-dialog').isVisible(), false);
    assert.equal(await page.evaluate(() => testLog.urls.some(url => url.includes('/camila_casos'))), false);
    await page.evaluate(() => { window.failUpload = false; });
    assert.equal(await page.evaluate(() => guardarCaso()), true);
    assert.equal(await page.evaluate(() => guardarCaso()), true);
    assert.deepEqual(await page.evaluate(() => testLog.cases), [patient]);
    assert.equal(await page.evaluate(() => new Set(testLog.uploads).size), 2);
    await page.evaluate(() => expireSession());
    await page.waitForSelector('html[data-consultorio-case="blocked"]');
    assert.equal(await page.locator('#s-photos').isVisible(), false);
    await page.close();
    await interview(browser);
    console.log('Verified selected-patient simulation, private save, seven blocked entries, expired session and MILA consent/context switch.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
