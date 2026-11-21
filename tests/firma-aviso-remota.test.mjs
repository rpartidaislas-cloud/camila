import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const page = read('aviso-firma.html');
const sw = read('sw.js');

test('la página pública solo usa las dos funciones con token y no lee tablas', () => {
  assert.match(page, /rpc\('smyl_consent_link_info'/);
  assert.match(page, /rpc\('smyl_consent_link_sign'/);
  assert.doesNotMatch(page, /\/rest\/v1\/(?!rpc\/)/);
  assert.doesNotMatch(page, /innerHTML/, 'el texto del aviso y el nombre se escriben con textContent');
  assert.match(page, /noindex/);
  assert.match(page, /name="referrer" content="no-referrer"/);
  assert.match(page, /\^\[0-9a-f\]\{64\}\$/, 'valida el formato del token antes de llamar');
});

test('la página exige leer, decidir las tres opciones, aceptar y firmar antes de enviar', () => {
  for (const k of ['ai', 'whatsapp', 'marketing']) assert.match(page, new RegExp(`\\['${k}',`));
  assert.match(page, /p_ai:s\.choice\.ai,p_whatsapp:s\.choice\.whatsapp,p_marketing:s\.choice\.marketing/);
  assert.match(page, /typeof s\.choice\[CHOICES\[i\]\[0\]\]!=='boolean'/, 'ninguna decisión viene marcada de antemano');
  assert.match(page, /touch-action:none/);
  assert.match(page, /pointerdown/);
  assert.match(page, /smyl-privacy-notice\.js\?v=2/);
  const sizes = [...page.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.every((n) => n >= 12), 'tipografía mínima legible en celular');
});

test('la página manda exactamente los argumentos que espera la función de la base', () => {
  const sql = read('supabase/migrations/20261124100000_smyl_consent_remote_links.sql');
  const fn = sql.match(/function public\.smyl_consent_link_sign\(([\s\S]*?)\)\s*returns/)[1];
  const expected = [...fn.matchAll(/\b(p_[a-z_]+)\b/g)].map((m) => m[1]).sort();
  const sent = page.match(/rpc\('smyl_consent_link_sign',\{([^}]*)\}/)[1].split(',').map((x) => x.split(':')[0]).sort();
  assert.deepEqual(sent, expected);
});

test('Consultorio ofrece «Enviar al celular del paciente» y espera la firma', () => {
  const js = read('smyl-consultorio.js');
  assert.match(js, /id === 'consent-link'\) openConsentLink/);
  assert.match(js, /rpc\('smyl_create_consent_link'/);
  assert.match(js, /aviso-firma\.html\?token=/);
  assert.match(js, /rpc\('smyl_patient_consent_status'/);
  assert.equal(js, read('mobile/www/smyl-consultorio.js'));
  assert.equal(read('smyl-visit-model.js'), read('mobile/www/smyl-visit-model.js'));
  const m = {};
  vm.runInNewContext(read('smyl-visit-model.js'), { module: m, globalThis: {} });
});

test('versiones y caché del panel y su copia móvil', () => {
  for (const f of ['app.html', 'mobile/www/app.html']) {
    const t = read(f);
    assert.match(t, /smyl-consultorio\.js\?v=11/);
    assert.match(t, /smyl-visit-model\.js\?v=6/);
  }
  assert.match(sw, /firma-aviso-remota-v1/);
  assert.match(read('mobile/www/sw.js'), /firma-aviso-remota-v1/);
  assert.match(read('scripts/migration-sentinels.mjs'), /'20261124100000'/);
});
