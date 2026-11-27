import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
const skip = chromium ? false : 'Playwright/Chromium no disponible';
const handoff = read('smyl-lana-handoff.js');
const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const PATIENT = '22222222-2222-4222-8222-222222222222';

async function boot(page, { stay } = {}) {
  await page.setContent('<!doctype html><html><body><main class="contenido"></main></body></html>');
  await page.evaluate(({ conversation, patient }) => {
    window.calls = []; window.events = []; window.opened = []; history.replaceState = () => {}; if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', { value: () => '33333333-3333-4333-8333-333333333333' });
    window.sb = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
    window.SUPA_URL = 'https://x.test'; window.SUPA_KEY = 'k';
    window.cargarPacientes = async () => {}; window.verPaciente = (id) => window.opened.push(id);
    window.fetch = async (url, init) => {
      const body = JSON.parse(init.body); window.calls.push(body.action);
      if (body.action === 'patient_link_preview') return new Response(JSON.stringify({ ok: true, conversation: { id: conversation, name: 'Ricardo', phone: '555' }, existing_link: null, candidates: [{ id: patient, name: 'Ricardo Partida', phone: '555' }] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, link: { patient_id: patient } }), { status: 200 });
    };
    window.addEventListener('smyl:chat-patient-linked', (e) => window.events.push(e.detail));
  }, { conversation: CONVERSATION, patient: PATIENT });
  await page.addScriptTag({ content: handoff });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
}

test('vincular desde el chat se queda en el chat, cierra la ventana y avisa al chat quién quedó vinculado', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await boot(page);
    await page.evaluate((id) => window.SmylLanaHandoff.open(id), CONVERSATION);
    await page.waitForSelector('input[name="lana-patient"]');
    await page.check(`input[name="lana-patient"][value="${PATIENT}"]`);
    await page.click('[data-lana-confirm]');
    await page.waitForFunction(() => window.events.length === 1);
    assert.deepEqual(await page.evaluate(() => window.events[0]), { conversationId: CONVERSATION, patientId: PATIENT, patientName: 'Ricardo Partida', created: false });
    assert.deepEqual(await page.evaluate(() => window.opened), [], 'no navega al expediente');
    assert.equal(await page.evaluate(() => document.getElementById('lana-handoff-overlay').hidden), true, 'la ventana se cierra');
    assert.deepEqual(await page.evaluate(() => window.calls), ['patient_link_preview', 'patient_link_confirm']);
  } finally { await browser.close(); }
});

test('desde la bandeja de atención (fuera del chat) vincular sí abre el expediente', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await boot(page);
    await page.evaluate((id) => window.SmylLanaHandoff.open(id, { stay: false }), CONVERSATION);
    await page.waitForSelector('input[name="lana-patient"]');
    await page.check(`input[name="lana-patient"][value="${PATIENT}"]`);
    await page.click('[data-lana-confirm]');
    await page.waitForFunction(() => window.opened.length === 1);
    assert.deepEqual(await page.evaluate(() => window.opened), [PATIENT]);
  } finally { await browser.close(); }
});

test('el chat se actualiza con el evento y vuelve a abrir «Agendar cita» si venía de ahí', () => {
  const inbox = read('smyl-inbox.js');
  assert.match(inbox, /window\.addEventListener\('smyl:chat-patient-linked'/);
  assert.match(inbox, /linked: true, patient: \{ id: detail\.patientId/);
  assert.match(inbox, /delete state\.clinical\[id\]\.auto_link_reason/);
  assert.match(inbox, /state\.patientLinkChecked\[id\] = true/);
  assert.match(inbox, /state\.availabilityResume = \{ id: state\.selectedId, at: Date\.now\(\) \}/);
  assert.match(inbox, /openAvailabilityDialog\(\);\s*\}\);/);
  assert.match(inbox, /refreshAvailabilityPatientIdentity\(\)/);
  assert.match(read('smyl-lana-attention.js'), /SmylLanaHandoff\.open\(item\.id, \{ stay: false \}\)/);
});

test('web, móvil y PWA publican la corrección', () => {
  for (const file of ['smyl-lana-handoff.js', 'smyl-lana-attention.js', 'smyl-inbox.js', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
