import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const dictation = require('../smyl-dental-dictation.js');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../smyl-dental-dictation.js');
const record = read('../smyl-dental-record.js');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-dental-dictation.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('interpreta una frase clínica breve sin inventar datos', () => {
  assert.deepEqual(dictation.parse('Pieza 16, oclusal, caries'), {
    transcript: 'Pieza 16, oclusal, caries',
    tooth: '16',
    toothCandidates: ['16'],
    surface: 'O',
    surfaceLabel: 'Oclusal',
    condition: 'Caries',
    complete: true,
    ambiguous: false
  });
  const spoken = dictation.parse('dieciséis, cara oclusal, caries');
  assert.equal(spoken.tooth, '16');
  assert.equal(spoken.surface, 'O');
  assert.equal(spoken.condition, 'Caries');
});

test('normaliza sinónimos de superficies y conserva una frase editable', () => {
  const vestibular = dictation.parse('diente 21 bucal restauración defectuosa');
  assert.equal(vestibular.surface, 'V');
  assert.equal(vestibular.condition, 'Restauración defectuosa');
  assert.equal(dictation.format(vestibular), 'Vestibular: Restauración defectuosa.');

  const palatal = dictation.parse('pieza 24 palatina lesión');
  assert.equal(palatal.surface, 'L');
  assert.equal(dictation.format(palatal), 'Lingual / palatina: Lesión.');

  const semantic = dictation.parse('pieza 16 oclusal restauración con pérdida de estructura');
  assert.equal(semantic.condition, 'Restauración con pérdida de estructura');
  assert.equal(dictation.format(semantic), 'Oclusal: Restauración con pérdida de estructura.');
});

test('una frase incompleta, inválida o ambigua nunca se confirma por inferencia', () => {
  assert.equal(dictation.parse('pieza 19 oclusal caries').complete, false);
  assert.equal(dictation.parse('pieza 16 caries').complete, false);
  const ambiguous = dictation.parse('pieza 16 y pieza 26 oclusal caries');
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.tooth, '');
  assert.equal(dictation.format(ambiguous), '');

  const measured = dictation.parse('pieza 16 oclusal lesión de 12 mm');
  assert.equal(measured.tooth, '16');
  assert.deepEqual(measured.toothCandidates, ['16']);
  assert.equal(measured.condition, 'Lesión de 12 mm');
});

test('el reconocimiento sólo prepara la vista previa y nunca guarda', () => {
  const resultHandler = source.slice(source.indexOf('recognition.onresult='), source.indexOf('recognition.onerror='));
  assert.match(resultHandler, /const result=parse/);
  assert.match(resultHandler, /fill\(result\)/);
  assert.doesNotMatch(resultHandler, /onApply|dirty\(|save\(|\.rpc\(|localStorage|sessionStorage/);
  assert.match(source, /recognition\.lang='es-MX'/);
  assert.match(source, /recognition\.continuous=false/);
  assert.match(source, /recognition\.interimResults=false/);
  assert.match(source, /recognition\?\.abort/);
  assert.doesNotMatch(source, /console\.|MediaRecorder|localStorage|sessionStorage|indexedDB/);
  assert.match(source, /SMYL no guarda el audio ni el texto provisional/);
  assert.match(source, /dialog\.showModal\(\);return/);
  assert.doesNotMatch(source, /dialog\.showModal\(\);start\(\)/);
});

test('confirmar alimenta el borrador canónico y conserva el único guardado versionado', () => {
  const voice = record.slice(record.indexOf('openVoice(tenant,patient'), record.indexOf('},openStudy(tenant,patient'));
  assert.match(voice, /appendFinding\(ctx,\{/);
  assert.match(voice, /capture:'voice'/);
  assert.doesNotMatch(voice, /smyl_save_dental_record|\.rpc\(|save\(ctx\)/);
  assert.match(record, /smyl_save_dental_record/);
  assert.match(record, /p_expected_revision:ctx\.revision/);
  assert.match(record, /findings\.events\.push\(event\)/);
  assert.match(record, /dirty\(ctx\);renderTeeth\(ctx\)/);
  assert.match(record, /reason:'draft'/);
});

test('la voz aparece como una sola acción secundaria dentro del odontograma', () => {
  assert.equal((workspace.match(/Dictar hallazgo/g) || []).length, 1);
  assert.match(workspace, /cw-clinical-map-head-actions/);
  assert.match(workspace, /SmylDentalProgress\?\.openVoice/);
  assert.match(workspace, /snapshot\?\.canWrite/);
  assert.match(workspace, /SmylDentalDictation\?\.supported/);
  assert.doesNotMatch(workspace, /data-module=['"]voice|Dictado clínico.*cw-module/i);
});

test('la interfaz conserva accesibilidad, móvil y movimiento reducido', () => {
  assert.match(source, /aria-live/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /aria-describedby/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /\.dvd-review\[hidden\],\.dvd-heard\[hidden\]\{display:none\}/);
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /#0b1b2e/);
  assert.match(styles, /#0f766e/);
});

test('web, PWA y móvil incluyen la misma integración', () => {
  for (const asset of ['smyl-dental-dictation.css?v=2', 'smyl-dental-dictation.js?v=2', 'smyl-dental-record.js?v=31', 'smyl-case-workspace.css?v=29', 'smyl-case-workspace.js?v=40']) {
    assert.match(app, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(worker, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(worker, /clinical-dictation-v1/);
  for (const file of ['app.html','sw.js','smyl-dental-dictation.js','smyl-dental-dictation.css','smyl-dental-record.js','smyl-case-workspace.js','smyl-case-workspace.css']) {
    assert.equal(read('../'+file), read('../mobile/www/'+file));
  }
});
