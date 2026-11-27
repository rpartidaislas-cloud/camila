import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('migración: avance del tratamiento de solo lectura, con importes solo para finanzas', () => {
  const sql = read('supabase/migrations/20261201500000_smyl_treatment_progress.sql');
  assert.match(sql, /create or replace function public\.smyl_treatment_progress\(p_patient_id uuid, p_treatment_id uuid default null\)/);
  assert.match(sql, /\bstable\b/);
  assert.match(sql, /smyl_has_permission\(v_tenant, 'proposal\.read'\)/);
  assert.match(sql, /v_fin := public\.smyl_has_permission\(v_tenant, 'finance\.read'\)/);
  assert.match(sql, /case when v_fin then/);
  assert.match(sql, /a\.status = 'completed'/);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\s+(into|from)?\s*public\./i);
  assert.doesNotMatch(sql, /grant execute[^;]*to anon/);
});

test('la etapa En tratamiento muestra el avance y el cierre avisa lo pendiente sin bloquear', () => {
  const tr = read('smyl-treatments.js'), ws = read('smyl-case-workspace.js');
  assert.match(tr, /smyl_treatment_progress/);
  assert.match(tr, /function attachProgress\(ctx\)/);
  assert.match(tr, /ctx\.activeStage !== 'followup'/);
  assert.match(tr, /Antes de cerrar: /);
  assert.match(tr, /Puedes cerrar igual/);
  assert.match(ws, /window\.SmylTreatments\?\.attachProgress\?\.\(ctx\)/);
  assert.match(ws, /window\.SmylTreatments\?\.syncProgress\?\.\(ctx\)/);
  // El espacio de trabajo clínico sigue sin consultar la base.
  assert.doesNotMatch(ws, /\.rpc\(|\.from\(/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-treatments.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-treatments\.js\?v=6/);
  assert.match(read('sw.js'), /avance-tratamiento-v1/);
});
