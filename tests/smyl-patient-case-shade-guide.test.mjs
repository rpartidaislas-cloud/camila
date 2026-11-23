import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('la ficha acepta la guía de color que manda el simulador', () => {
  const model = read('../smyl-case-model.js');
  const sql = read('../supabase/migrations/20261122120000_smyl_patient_case_shade_guide.sql');
  // Todas las llaves de settings que manda el simulador deben estar permitidas por la función.
  const sent = model.match(/settings: \{([^}]*)\}/)[1].match(/\b(\w+):/g).map((k) => k.slice(0, -1));
  const allowed = sql.match(/settings-array\[([^\]]*)\]/)[1].match(/'(\w+)'/g).map((k) => k.slice(1, -1));
  for (const key of sent) assert.ok(allowed.includes(key), `la función rechazaría «${key}»`);
  assert.match(sql, /settings \? 'shadeGuide' and coalesce\(settings->>'shadeGuide',''\) not in \('classical','bleached'\)/);
  assert.match(sql, /create or replace function public\.smyl_save_patient_case\(p_id uuid,p_patient_id uuid,p_new_patient jsonb,p_document jsonb\)/);
  assert.match(sql, /grant execute on function public\.smyl_save_patient_case\(uuid,uuid,jsonb,jsonb\) to authenticated/);
  // El resto de la validación se conserva.
  for (const guard of ['Case access denied', 'Foreign asset path', 'Asset unavailable', 'Case requires result', 'Patient unavailable']) {
    assert.ok(sql.includes(guard), guard);
  }
});
