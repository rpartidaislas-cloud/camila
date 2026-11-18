import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as core from '../supabase/functions/_shared/fiscal-core.mjs';

const root = path.resolve(import.meta.dirname, '..');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/fiscal-extract/index.ts'), 'utf8');
// La función llama a la API con fetch (sin SDK), así que nadie quita restricciones no soportadas: la API rechaza el esquema con 400.
const UNSUPPORTED = ['maxItems', 'minItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'pattern'];

test('el esquema de la constancia solo usa palabras clave que aceptan los structured outputs', () => {
  const found = [];
  (function walk(node, at) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED.includes(key)) found.push(`${at}.${key}`);
      walk(value, `${at}.${key}`);
    }
  })(core.FISCAL_SCHEMA, 'FISCAL_SCHEMA');
  assert.deepEqual(found, []);
});

test('el límite de regímenes se aplica al leer, no en el esquema', () => {
  const many = Array(12).fill('Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios');
  const result = core.leerConstancia(JSON.stringify({ is_constancia: true, legible: true, rfc: 'PARR900514AB1', legal_name: 'Ricardo Partida', tax_postal_code: '44100', fiscal_regimes: many, email: '' }));
  assert.equal(result.fiscal_regime, '605');
});

test('la llamada deja margen al razonamiento de Haiku 5.5 y registra el motivo de un rechazo sin datos del paciente', () => {
  assert.ok(core.FISCAL_EXTRACT_MAX_TOKENS >= 4000);
  assert.equal(core.FISCAL_EXTRACT_EFFORT, 'low');
  assert.match(edge, /output_config: \{ effort: FISCAL_EXTRACT_EFFORT, format: \{ type: "json_schema", schema: FISCAL_SCHEMA \} \}/);
  assert.match(edge, /console\.error\("\[fiscal-extract\] la API rechazó la solicitud:", resp\.status, message\?\.error\?\.type/);
  assert.doesNotMatch(edge, /console\.(log|error)\([^)]*file_base64/);
});
