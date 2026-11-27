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
  assert.match(read('app.html'), /smyl-proposals\.js\?v=32/);
  assert.match(read('sw.js'), /presupuesto-incrustado-v1/);
});
