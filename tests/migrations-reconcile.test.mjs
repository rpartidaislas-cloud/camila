import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reconciliar, resumen, versionDeArchivo } from '../scripts/compare-migrations.mjs';

test('versionDeArchivo reconoce versiones de 12-14 dígitos y descarta el esquema base', () => {
  assert.equal(versionDeArchivo('20261012190000_smyl_clinic_core.sql'), '20261012190000');
  assert.equal(versionDeArchivo('202609110001_legacy_remote_placeholder.sql'), '202609110001');
  assert.equal(versionDeArchivo('camila_tenants.sql'), null);
});

test('reconciliar separa faltantes, sobrantes, placeholders y esquema sin versión', () => {
  const r = reconciliar(
    ['20260101000000_a.sql', '20260102000000_b.sql', '20260103000000_legacy_remote_placeholder.sql', 'camila_x.sql', 'notas.md'],
    ['20260101000000', '20260103000000', '20269999999999'],
  );
  assert.deepEqual(r.faltanEnProduccion, [{ version: '20260102000000', archivo: '20260102000000_b.sql' }]);
  assert.deepEqual(r.soloEnProduccion, ['20269999999999']);
  assert.deepEqual(r.placeholders, ['20260103000000']);
  assert.deepEqual(r.sinVersion, ['camila_x.sql']);
  assert.match(resumen(r), /NO aplicadas en producción: 1/);
});

test('sin diferencias: nada faltante ni sobrante', () => {
  const r = reconciliar(['20260101000000_a.sql'], ['20260101000000']);
  assert.equal(r.faltanEnProduccion.length + r.soloEnProduccion.length, 0);
});

test('el repo no tiene dos migraciones con la misma versión', () => {
  const vistos = new Map();
  for (const f of fs.readdirSync(new URL('../supabase/migrations/', import.meta.url))) {
    const v = versionDeArchivo(f);
    if (!v) continue;
    assert.ok(!vistos.has(v), `versión duplicada ${v}: ${vistos.get(v)} y ${f}`);
    vistos.set(v, f);
  }
});

test('el workflow de reconciliación es de solo lectura', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/smyl-migraciones-reconciliar.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /select version from supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(wf, /migration repair|insert into|delete from|drop |alter table/i);
});

test('sentinelas: cada migración pendiente conocida tiene regla y las desconocidas no se registran', async () => {
  const { SENTINELAS, planificar } = await import('../scripts/migration-sentinels.mjs');
  for (const [v, r] of Object.entries(SENTINELAS)) assert.ok(r.reapply || /^select /i.test(r.sentinel), v);
  assert.deepEqual(planificar(['20261106100000'], () => true), [{ version: '20261106100000', accion: 'registrar' }]);
  assert.deepEqual(planificar(['20261106100000'], () => false), [{ version: '20261106100000', accion: 'no_aplicada' }]);
  assert.equal(planificar(['20269999999999'], () => true)[0].accion, 'desconocida');
  assert.equal(planificar(['20261031140000'], () => false)[0].accion, 'reaplicar_y_registrar');
});

test('los workflows que registran el historial soportan la CLI nueva (--remote) y la anterior (--linked)', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  for (const f of fs.readdirSync(dir)) {
    const wf = fs.readFileSync(new URL(f, dir), 'utf8');
    if (!/supabase migration repair/.test(wf)) continue;
    assert.match(wf, /REPAIR_FLAG=--linked/, f);
    assert.match(wf, /grep -q -- '--remote'/, f);
    assert.match(wf, /REPAIR_FLAG="--remote --yes"/, f);
    assert.doesNotMatch(wf, /supabase migration repair --status/, f);
  }
});
