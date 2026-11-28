import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('el editor de presupuesto se puede montar dentro de la pestaña Tratamiento', () => {
  const proposals = read('smyl-proposals.js'), ws = read('smyl-case-workspace.js'), clinic = read('smyl-clinic.js');
  assert.match(proposals, /function rootEl\(\)/);
  assert.match(proposals, /mount:function\(host,options\)/);
  assert.match(proposals, /← Volver al paciente/);
  assert.match(proposals, /if\(route==='propuestas'\)\{embed=null;loadList\(\);\}/);
  assert.match(ws, /api\.mount\(ctx\.quoteHost/);
  assert.match(ws, /function openQuote\(patient\)/);
  assert.match(clinic, /SmylCaseWorkspace\.openQuote\(current\.patient\)/);
  // El espacio de trabajo clínico sigue sin consultar la base.
  assert.doesNotMatch(ws, /\.rpc\(|\.from\(/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-proposals.js', 'smyl-proposals.css', 'smyl-case-workspace.js', 'smyl-clinic.js', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-proposals\.js\?v=34/);
  assert.match(read('sw.js'), /presupuesto-incrustado-v1/);
});

test('cotizar a un paciente abre su pestaña Tratamiento y cae a Cotizaciones solo si no se puede', () => {
  const proposals = read('smyl-proposals.js'), ws = read('smyl-case-workspace.js'), clinic = read('smyl-clinic.js');
  assert.match(proposals, /function quoteInPatient\(patientId\)/);
  assert.match(proposals, /forPatient:function\(patientId,options\)\{if\(!\(options&&options\.page\)&&quoteInPatient\(patientId\)\)return;/);
  assert.match(proposals, /p360\.open\('treatment'\);result=ws\.openQuote\(patientId\)/);
  assert.match(ws, /null = el expediente aún no termina de montarse/);
  assert.match(ws, /if\(!valid\(ctx\)\|\|ctx\.patient!==patient\|\|!ctx\.quoteButton\|\|!ctx\.routeFlags\)return null/);
  assert.match(clinic, /forPatient\(current\.patient, \{ page: true \}\)/);
  for (const f of ['smyl-proposals.js', 'smyl-case-workspace.js', 'smyl-clinic.js', 'app.html', 'sw.js']) assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('sw.js'), /cotizar-en-paciente-v1/);
});
