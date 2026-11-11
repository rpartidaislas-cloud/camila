import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../smyl-dental-record.js', import.meta.url), 'utf8');
const addFile = source.slice(source.indexOf('async function addFile(ctx,file)'), source.indexOf('async function save(ctx)'));

test('la carga bloquea un duplicado activo por SHA antes de crear identidad o ruta', () => {
  const fingerprint = addFile.indexOf('M.hash(await file.arrayBuffer())');
  const lookup = addFile.indexOf('activeDuplicate(ctx,sha256)');
  const identity = addFile.indexOf('crypto.randomUUID()');
  const asset = addFile.indexOf('M.asset(file,ctx.tenant,ctx.patient,id)');
  const append = addFile.indexOf('ctx.doc.studies.push');

  assert.ok(fingerprint >= 0, 'debe calcular la huella del archivo');
  assert.ok(fingerprint < lookup, 'la huella debe existir antes de buscar duplicados');
  assert.ok(lookup < identity, 'la búsqueda debe ocurrir antes de crear un UUID');
  assert.ok(identity < asset && asset < append, 'sólo un archivo nuevo crea activo y estudio');
  assert.match(addFile, /if\(duplicate\)\{[^}]*No se creó otra copia;[^}]*return;/);
});

test('el bloqueo considera sólo estudios activos y lleva al original existente', () => {
  assert.match(source, /function activeDuplicate\(ctx,sha256\)\{return activeStudies\(ctx\)\.find\(study=>study\.asset\?\.sha256===sha256\)\|\|null;\}/);
  assert.match(source, /function activeStudies\(ctx\)\{return \(ctx\.doc\.studies\|\|\[\]\)\.filter\(study=>!archived\(ctx,study\.id\)\);\}/);
  assert.match(source, /function focusStudy\(ctx,studyId\)[\s\S]*?\.dr-study-actions button/);
  assert.match(source, /if\(duplicateId\)focusStudy\(ctx,duplicateId\)/);
});

test('formatos y tamaño se validan antes de leer la huella', () => {
  const validation = addFile.indexOf("!['image/jpeg','image/png'].includes(file.type)");
  const fingerprint = addFile.indexOf('M.hash(await file.arrayBuffer())');
  assert.ok(validation >= 0 && validation < fingerprint);
  assert.match(addFile, /file\.size<16\|\|file\.size>20971520/);
});
