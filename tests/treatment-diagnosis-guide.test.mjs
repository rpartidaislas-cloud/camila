import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('migración: constancia inmutable de «seguí sin completar el diagnóstico»', () => {
  const sql = read('supabase/migrations/20261201400000_smyl_diagnosis_waivers.sql');
  assert.match(sql, /create table if not exists public\.smyl_diagnosis_waivers/);
  assert.match(sql, /unique \(tenant_id, patient_id, plan_revision\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /clinical\.write/);
  assert.match(sql, /before update or delete on public\.smyl_diagnosis_waivers/);
  assert.doesNotMatch(sql, /grant execute[^;]*to anon/);
});

test('la ruta guía y no bloquea: el diagnóstico pendiente deja continuar y registra la decisión', () => {
  const ws = read('smyl-case-workspace.js'), tr = read('smyl-treatments.js');
  assert.match(ws, /Pendiente · seguiste sin completarlo/);
  assert.match(ws, /skipped:\{evaluation:!evaluationComplete&&!!clinical\?\.ready\}/);
  assert.doesNotMatch(ws, /Terminar diagnóstico'\);ctx\.planNext/);
  assert.match(ws, /window\.SmylTreatments\?\.waiveDiagnosis\?\.\(ctx\.patient,clinical\.revision/);
  // El espacio de trabajo clínico no consulta la base: la constancia sale por Tratamientos.
  assert.doesNotMatch(ws, /smyl_waive_diagnosis|\.rpc\(/);
  assert.match(tr, /smyl_waive_diagnosis/);
  assert.match(ws, /Se habilita al aceptar el presupuesto/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-case-workspace.js', 'smyl-case-workspace.css', 'smyl-treatments.js', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-case-workspace\.js\?v=55/);
  assert.match(read('sw.js'), /diagnostico-guia-v1/);
});
