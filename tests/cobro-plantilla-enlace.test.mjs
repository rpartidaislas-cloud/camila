import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const catalog = require('../smyl-template-catalog.js');

test('el enlace de pago se manda con la plantilla «cobro_enlace_pago_v1» y el enlace va dentro del texto', () => {
  const t = catalog.TEMPLATES.find((item) => item.id === 'cobro_enlace_pago_v1');
  assert.ok(t, 'existe en el catálogo');
  assert.equal(t.category, 'UTILITY');
  assert.deepEqual(catalog.validate(t), [], 'cumple las reglas de Meta del catálogo');
  assert.match(t.body, /\{\{4\}\}/);
  assert.equal(t.variables.length, 4);
  assert.doesNotMatch(t.body, /https?:\/\//, 'el enlace es una variable, no está escrito a mano');
  assert.match(t.variables[3].example, /^https:\/\//);
});

test('Finanzas: «Enviar por WhatsApp» usa la plantilla cuando el paciente tiene chat y la ofrece como sugerida', () => {
  const finance = read('smyl-finance.js');
  assert.match(finance, /id="link-wa-template">Enviar por WhatsApp/);
  assert.match(finance, /preferred:\['cobro_enlace_pago_v1'\],variables:\[patientFirstName\(patientId\),money\(data\.amount\),clinicLabel\(\),data\.url\]/);
  assert.match(finance, /Enviar desde mi WhatsApp/, 'sin chat queda el atajo personal con otro nombre');
  const suggest = read('smyl-template-suggest.js');
  assert.match(suggest, /\['cobro_enlace_pago_v1', 'essential'/);
  for (const dir of ['', 'mobile/www/']) assert.equal(read(dir + 'smyl-finance.js'), finance);
});
