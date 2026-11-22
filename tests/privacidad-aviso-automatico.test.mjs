import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as C from '../supabase/functions/_shared/privacy-dispatch-core.mjs';
import D from '../smyl-privacy-dispatch.js';
import * as catalog from '../supabase/functions/_shared/whatsapp-template-catalog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');

test('el saludo usa el nombre de pila y, si la ficha no tiene nombre real, uno neutro', () => {
  assert.equal(C.firstNameOf('María Fernanda López'), 'María');
  assert.equal(C.firstNameOf('  Ana '), 'Ana');
  assert.equal(C.firstNameOf('Por registrar 2221112233'), 'paciente');
  assert.equal(C.firstNameOf(''), 'paciente');
  assert.equal(C.firstNameOf(null), 'paciente');
  assert.equal(C.firstNameOf('x'.repeat(100)).length, 40);
});

test('solo se usa la plantilla aprobada; pendiente, rechazada o ausente no se manda', () => {
  assert.equal(C.approvedTemplateId([{ id: 't1', name: 'aviso_privacidad_v1', status: 'APPROVED' }]), 't1');
  assert.equal(C.approvedTemplateId([{ id: 't1', name: 'aviso_privacidad_v1', status: 'PENDING' }]), null);
  assert.equal(C.approvedTemplateId([{ id: 't1', name: 'aviso_privacidad_v1', status: 'rejected' }]), null);
  assert.equal(C.approvedTemplateId([{ id: 't1', name: 'otra_plantilla', status: 'APPROVED' }]), null);
  assert.equal(C.approvedTemplateId(null), null);
  assert.equal(C.approvedTemplateId([{ name: 'aviso_privacidad_v1', status: 'APPROVED' }]), null, 'sin id no se puede usar');
});

test('las variables salen en el orden del catálogo: nombre, clínica, enlace con el token', () => {
  const token = 'ab'.repeat(32);
  const v = C.templateVariables({ firstName: 'Ana Pérez', clinic: 'Clínica Sonrisa', base: 'https://app.smyldesign.ai/', token });
  assert.deepEqual(v, ['Ana', 'Clínica Sonrisa', 'https://app.smyldesign.ai/aviso-firma.html?token=' + token]);
  assert.equal(C.templateVariables({ firstName: '', clinic: '', base: 'https://x.mx', token })[1], 'tu clínica');
  assert.equal(C.idempotencyKey('t', 'p'), 'privacy-notice:t:p');
  const tpl = catalog.TEMPLATES.find((t) => t.id === 'aviso_privacidad_v1');
  assert.ok(tpl, 'la plantilla está en el catálogo');
  assert.equal(tpl.variables.length, v.length, 'mismo número de variables que el catálogo');
  assert.equal(tpl.category, 'UTILITY');
  assert.deepEqual(catalog.validate(tpl), []);
  assert.equal(C.NOTICE_TEMPLATE, tpl.id);
});

test('la función exige sesión y permiso, y respeta el interruptor y la plantilla aprobada', () => {
  const fn = read('supabase/functions/privacy-notice-dispatch/index.ts');
  assert.match(fn, /requireUser\(req, cors\)/);
  assert.match(fn, /requirePermission\(auth, cors, "patients\.manage"\)/);
  assert.match(fn, /if \(!enabled\) return json\(200, \{ enabled: false, sent: 0 \}\)/);
  assert.match(fn, /reason: "template_not_approved"/);
  assert.match(fn, /smyl_privacy_dispatch_claim/);
  assert.match(fn, /smyl_privacy_dispatch_finish/);
  assert.match(fn, /MAX_PER_RUN/);
  assert.match(fn, /template_id: tpl/);
  assert.doesNotMatch(fn, /type: "text"|type: 'text'/, 'nunca manda texto libre');
  assert.match(read('supabase/config.toml'), /\[functions\.privacy-notice-dispatch\]\nverify_jwt = false/);
  const bundle = read('docs/bundles/privacy-notice-dispatch.single-file.ts');
  assert.match(bundle, /aviso_privacidad_v1/);
  assert.match(bundle, /smyl_privacy_dispatch_claim/);
});

test('el panel solo dispara el envío si está encendido, como máximo cada 10 minutos y en pantallas de trabajo', () => {
  assert.equal(D.due(1000, 0), true);
  assert.equal(D.due(1000 + D.EVERY_MS - 1, 1000), false);
  assert.equal(D.due(1000 + D.EVERY_MS, 1000), true);
  assert.equal(D.shouldRun('consultorio'), true);
  assert.equal(D.shouldRun('privacidad'), false);
  assert.equal(D.shouldRun('finanzas'), false);
});

test('el panel no hace nada si la clínica lo tiene apagado o no hay permiso', async () => {
  const calls = [];
  globalThis.tenantId = 't1';
  globalThis.sb = { rpc: async (n) => { calls.push(n); return globalThis.__settings; }, functions: { invoke: async (n, o) => { calls.push('invoke:' + n + ':' + o.body.action); return { data: { sent: 1 } }; } } };
  D.reset();
  globalThis.__settings = { data: { auto_send_notice: false }, error: null };
  assert.equal(await D.run(), null);
  assert.deepEqual(calls, ['smyl_get_privacy_settings'], 'apagado: no llama a la función');
  calls.length = 0; D.reset();
  globalThis.__settings = { data: null, error: { code: '42501' } };
  assert.equal(await D.run(), null);
  assert.deepEqual(calls, ['smyl_get_privacy_settings'], 'sin permiso: tampoco');
  calls.length = 0; D.reset();
  globalThis.__settings = { data: { auto_send_notice: true }, error: null };
  assert.deepEqual(await D.run(), { sent: 1 });
  assert.deepEqual(calls, ['smyl_get_privacy_settings', 'invoke:privacy-notice-dispatch:dispatch']);
  calls.length = 0;
  assert.equal(await D.run(), null, 'dentro de los 10 minutos no repite');
  assert.deepEqual(calls, []);
  delete globalThis.sb; delete globalThis.tenantId; delete globalThis.__settings;
});

test('el interruptor usa las funciones del ajuste, la migración está en el centinela y las copias móviles son iguales', () => {
  const ui = read('smyl-privacy-rights.js');
  assert.match(ui, /autoControl/);
  assert.match(ui, /smyl_set_privacy_settings/);
  assert.match(ui, /smyl_get_privacy_settings/);
  assert.match(read('scripts/migration-sentinels.mjs'), /'20261124200000'/);
  for (const f of ['smyl-privacy-rights.js', 'smyl-privacy-rights.css', 'smyl-privacy-dispatch.js', 'smyl-template-catalog.js']) assert.equal(read(f), read('mobile/www/' + f), f);
  for (const f of ['app.html', 'mobile/www/app.html']) { const a = read(f); assert.match(a, /smyl-privacy-dispatch\.js\?v=1/); assert.match(a, /smyl-privacy-rights\.js\?v=3/); }
  for (const f of ['sw.js', 'mobile/www/sw.js']) { const a = read(f); assert.match(a, /\/camila\/smyl-privacy-dispatch\.js\?v=1/); assert.match(a, /aviso-automatico-v1/); }
});
