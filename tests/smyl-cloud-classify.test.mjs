import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOUD_CLASSIFY_MODEL, CLASSIFY_SCHEMA, CATEGORIAS, topesDeEntorno, evaluarTopeClasificacion, imagenValida, leerSugerencia,
} from '../supabase/functions/_shared/cloud-classify-core.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const fn = read('supabase/functions/cloud-classify/index.ts');
const ui = read('smyl-cloud.js');

test('el servidor fija el modelo y el esquema, y las categorías coinciden con las de la Nube', () => {
  assert.equal(CLOUD_CLASSIFY_MODEL, 'claude-haiku-5-5');
  assert.deepEqual(CLASSIFY_SCHEMA.properties.category.enum, CATEGORIAS);
  assert.deepEqual(CATEGORIAS, ['photo', 'xray', 'document', 'consent', 'other']);
  assert.match(read('supabase/migrations/20261116170000_smyl_cloud_v1.sql'), /category in \('photo', 'xray', 'document', 'consent', 'other'\)/);
  assert.equal(CLASSIFY_SCHEMA.additionalProperties, false);
});

test('solo se acepta una copia JPEG reducida en base64 puro y acotada', () => {
  const jpeg = '/9j/' + 'A'.repeat(200);
  assert.equal(imagenValida(jpeg), true);
  assert.equal(imagenValida('data:image/jpeg;base64,' + jpeg), false);
  assert.equal(imagenValida('iVBOR' + 'A'.repeat(200)), false);
  assert.equal(imagenValida('/9j/' + 'A'.repeat(900001)), false);
  assert.equal(imagenValida(''), false);
  assert.equal(imagenValida(null), false);
});

test('la respuesta del modelo se valida; lo que no cumple el contrato se descarta', () => {
  assert.deepEqual(leerSugerencia('{"category":"xray","confidence":"high","reason":"  Panorámica\\nvisible  "}'), { category: 'xray', confidence: 'high', reason: 'Panorámica visible' });
  assert.equal(leerSugerencia('{"category":"diagnostico","confidence":"high","reason":"x"}'), null);
  assert.equal(leerSugerencia('{"category":"xray","confidence":"seguro","reason":"x"}'), null);
  assert.equal(leerSugerencia('no es json'), null);
  assert.equal(leerSugerencia('[1,2]'), null);
  assert.equal(leerSugerencia('{"category":"photo","confidence":"low","reason":"' + 'a'.repeat(500) + '"}').reason.length, 160);
});

test('los topes diario y mensual se leen del entorno y frenan el gasto', () => {
  const topes = topesDeEntorno({ get: (k) => ({ CLOUD_CLASSIFY_DAILY_LIMIT: '5' }[k]) });
  assert.deepEqual(topes, { diario: 5, mensual: 3000 });
  assert.equal(evaluarTopeClasificacion(4, 10, topes).permitido, true);
  assert.equal(evaluarTopeClasificacion(5, 10, topes).permitido, false);
  assert.equal(evaluarTopeClasificacion(1, 3000, topes).permitido, false);
});

test('la función exige sesión, cloud.manage y poder ver el archivo; solo sugiere y mide el consumo', () => {
  assert.match(fn, /requireUser\(req, CORS\)/);
  assert.match(fn, /p_permission: "cloud\.manage"/);
  assert.match(fn, /asUser\.from\("smyl_cloud_files"\)/);
  assert.match(fn, /feature: "cloud_classify"/);
  assert.match(fn, /output_config: \{ format: \{ type: "json_schema", schema: CLASSIFY_SCHEMA \} \}/);
  assert.doesNotMatch(fn, /\.update\(|\.delete\(|smyl_cloud_update_file/);
  assert.doesNotMatch(fn, /display_name|patient_id/);
  assert.match(read('supabase/config.toml'), /\[functions\.cloud-classify\]\s+verify_jwt = true/);
  assert.match(read('supabase/migrations/20261116230000_smyl_cloud_classify.sql'), /'mila_exam_dictation', 'cloud_classify'/);
});

test('la pantalla solo sugiere: confirmar es una acción explícita y la pista de paciente no vincula sola', () => {
  assert.match(ui, /functions\.invoke\(name, \{ body: body \}\)|invokeFn\('cloud-classify'/);
  assert.match(ui, /La IA solo sugiere\. Nada cambia hasta que lo confirmes\./);
  assert.match(ui, /btn\('Confirmar: ' \+ CATEGORY_LABEL\[suggestion\.category\][^)]*function \(\) \{ patchFile\(file\.id, \{ category: suggestion\.category \}\)/);
  assert.match(ui, /Es solo una pista\. Elige a la persona correcta o ignórala\./);
  assert.match(ui, /sin nombre ni datos del paciente/);
  assert.doesNotMatch(ui.slice(ui.indexOf('async function suggestType'), ui.indexOf('async function suggestMany')), /patchFile|smyl_cloud_update_file/);
  for (const file of ['smyl-cloud.js', 'smyl-cloud.css', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
  assert.match(read('app.html'), /smyl-cloud\.js\?v=3/);
});
