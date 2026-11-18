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

test('la constancia también llena el domicilio fiscal y el estatus en el padrón (opcionales)', () => {
  const r = core.leerConstancia(JSON.stringify({ is_constancia: true, legible: true, rfc: 'GUAJ620917DE7', legal_name: 'Jose Guevara', tax_postal_code: '44920', fiscal_regimes: ['Sueldos y Salarios'], email: '', sat_status: 'Suspendido', address: { street: 'calle  hidalgo', exterior_number: '123', interior_number: '', neighborhood: 'Centro', locality: '', municipality: 'Guadalajara', state: 'Jalisco' } }));
  assert.deepEqual(r.address, { street: 'CALLE HIDALGO', exterior_number: '123', interior_number: '', neighborhood: 'CENTRO', locality: '', municipality: 'GUADALAJARA', state: 'JALISCO' });
  assert.equal(r.sat_status, 'SUSPENDIDO');
  assert.match(r.warnings.join(' '), /Estatus en el padrón: SUSPENDIDO/);
  // Sin domicilio en la respuesta no se inventa nada.
  const vacio = core.leerConstancia(JSON.stringify({ is_constancia: true, legible: true, rfc: 'GUAJ620917DE7', legal_name: 'J G', tax_postal_code: '44920', fiscal_regimes: [], email: '' }));
  assert.ok(Object.values(vacio.address).every((v) => v === ''));
  assert.doesNotMatch(core.FISCAL_SYSTEM, /domicilio completo/);
  assert.match(core.FISCAL_SYSTEM, /No copies CURP/);
});

test('cada lectura se contabiliza en Créditos de IA con sus tokens y costo estimado', () => {
  assert.match(edge, /p_resource: "ai_credits", p_quantity_units: 1/);
  assert.match(edge, /p_source_type: "fiscal_extract"/);
  assert.match(edge, /token_usage: message\.usage \|\| null/);
  assert.match(edge, /estimated_cost_usd: costoEstimadoUsd\(FISCAL_EXTRACT_MODEL, usage\)/);
  assert.equal(core.costoEstimadoUsd('claude-haiku-5-5', { input_tokens: 7653, output_tokens: 314 }), 0.000922);
  assert.match(fs.readFileSync(path.join(root, 'smyl-consumption.js'), 'utf8'), /fiscal_extract:'Facturación · Lectura de constancia'/);
});

test('el formulario guarda el domicilio cuando existe la columna y lo obligatorio si aún no se aplica la migración', () => {
  const capture = fs.readFileSync(path.join(root, 'smyl-fiscal-capture.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261118170000_smyl_patient_fiscal_address.sql'), 'utf8');
  for (const col of ['street', 'exterior_number', 'interior_number', 'neighborhood', 'locality', 'municipality', 'state', 'sat_status']) {
    assert.match(migration, new RegExp(`add column if not exists ${col} text not null default ''`));
    assert.ok(capture.includes(`'${col}'`) || capture.includes(`['${col}'`), col);
  }
  assert.match(capture, /if \(res && res\.error && missingColumn\(res\.error\)\) \{ partial = true;/);
  assert.match(capture, /Domicilio fiscal <small>Opcional/);
});
