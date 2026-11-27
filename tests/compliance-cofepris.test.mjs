import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../smyl-compliance-model.js');
const now = new Date('2026-11-23T12:00:00Z');
const base = { sterilization: { cycles: 3, last_bio_at: '2026-11-13T12:00:00Z', last_bio_result: 'negative', positives: 0 }, rpbi: { collections: 1, kg: 2 }, items: [], activity: { signed_notes: 4, draft_notes: 0, visits: 5 } };

test('testigo biológico reciente y negativo está al día', () => {
  const ev = M.evaluate(base, now);
  assert.equal(ev.groups[0].rows.find(r => r.key === 'bio').status, 'ok');
});
test('sin testigo biológico falta', () => {
  const ev = M.evaluate({ ...base, sterilization: { cycles: 0 } }, now);
  assert.notEqual(ev.groups[0].rows.find(r => r.key === 'bio').status, 'ok');
  assert.ok(ev.summary.pending > 0);
});
test('requisitos manuales: tengo cuenta como al día', () => {
  const key = M.ITEMS[0].key;
  const ev = M.evaluate({ ...base, items: [{ key, status: 'have', reference: 'F-1' }] }, now);
  const all = ev.groups.flatMap(g => g.rows);
  assert.equal(all.find(r => r.key === key).status, 'ok');
});
test('validaciones de captura', () => {
  assert.ok(M.rpbiError({ manifest: '' }));
  assert.equal(M.rpbiError({ manifest: 'M-1' }), '');
});
test('la revisión diaria es opcional y conserva una selección masiva sin certificar cumplimiento', () => {
  const key = M.dailyReviewKey(now);
  const review = M.dailyReview({ ...base, items: [{ key, status: 'have', notes: 'daily_cleaning,daily_sterilization' }] }, now);
  assert.equal(review.key, 'daily_review_20261123');
  assert.equal(review.summary.reviewed, 2);
  assert.equal(review.rows.find(r => r.key === 'daily_cleaning').reviewed, true);
  assert.equal(review.rows.find(r => r.key === 'daily_patients').reviewed, false);
});
test('migración y cableado de la pantalla', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261126200000_smyl_compliance.sql', import.meta.url), 'utf8');
  for (const f of ['smyl_log_sterilization', 'smyl_log_rpbi', 'smyl_set_compliance_item', 'smyl_compliance_overview']) assert.match(sql, new RegExp(f));
  assert.match(sql, /enable row level security/i);
  const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /smyl-compliance-model\.js\?v=4/);
  assert.match(app, /smyl-compliance\.js\?v=4/);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /cumplimiento-carpeta-v1/);
  assert.match(fs.readFileSync(new URL('../smyl-navigation.js', import.meta.url), 'utf8'), /'cumplimiento'/);
  for (const f of ['smyl-compliance.js', 'smyl-compliance-model.js', 'smyl-compliance.css', 'sw.js', 'app.html'])
    assert.equal(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), fs.readFileSync(new URL('../mobile/www/' + f, import.meta.url), 'utf8'), f);
});

test('la bitácora diaria registra cada equipo o área sin preconfirmar su realización', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261127180000_smyl_daily_sanitation_log.sql', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../smyl-compliance.js', import.meta.url), 'utf8');
  for (const table of ['smyl_sanitation_assets', 'smyl_sanitation_logs']) assert.match(migration, new RegExp('create table if not exists public\\.' + table));
  for (const rpc of ['smyl_daily_sanitation_overview', 'smyl_save_daily_sanitation', 'smyl_configure_sanitation_asset']) assert.match(migration, new RegExp(rpc));
  assert.match(migration, /status in \('done', 'incident', 'not_applicable'\)/);
  assert.match(migration, /responsible_name/);
  assert.match(migration, /captured_at timestamptz not null default now\(\)/);
  assert.match(migration, /smyl_sanitation_logs_guard/);
  assert.match(migration, /p_local_date date, p_local_time time/);
  assert.doesNotMatch(migration, /default\s+'done'/i);
  assert.match(ui, /Nada se marca por ti/);
  assert.match(ui, /Seleccionar pendientes/);
  assert.match(ui, /Agregar equipo o área/);
  assert.match(ui, /Comprobaciones automáticas/);
  assert.match(ui, /Los registros anteriores no se sobrescriben/);
});

test('la experiencia separa revisión diaria opcional y Guía COFEPRIS', () => {
  const ui = fs.readFileSync(new URL('../smyl-compliance.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-compliance.css', import.meta.url), 'utf8');
  for (const cadence of ['setup', 'routine', 'periodic', 'automatic']) assert.match(fs.readFileSync(new URL('../smyl-compliance-model.js', import.meta.url), 'utf8'), new RegExp("cadence: '" + cadence + "'"));
  assert.match(ui, /Revisión diaria/);
  assert.match(ui, /Guía COFEPRIS/);
  assert.match(ui, /No bloquea la atención ni modifica tu estado regulatorio/);
  assert.match(ui, /Seleccionar todo/);
  assert.match(ui, /Guardar significa “revisado hoy”; no certifica cumplimiento/);
  assert.match(ui, /Documentos y condiciones de la clínica/);
  assert.match(ui, /Controles periódicos y vencimientos/);
  assert.match(ui, /Lo que SMYL registra automáticamente/);
  assert.match(fs.readFileSync(new URL('../smyl-compliance-model.js', import.meta.url), 'utf8'), /dailyReview/);
  assert.match(css, /\.cp-dialog\{position:fixed;inset:0;margin:auto/);
});

test('MILA prepara borradores pero exige revisión antes de guardar', () => {
  const ui = fs.readFileSync(new URL('../smyl-compliance.js', import.meta.url), 'utf8');
  const edge = fs.readFileSync(new URL('../supabase/functions/compliance-assistant/index.ts', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261129110000_smyl_compliance_assistant_usage.sql', import.meta.url), 'utf8');
  assert.match(ui, /functions\.invoke\('compliance-assistant'/);
  assert.match(ui, /Confirmo que revisé los datos seleccionados/);
  assert.match(ui, /MILA sólo preparó el borrador/);
  assert.match(edge, /no inventas folios/i);
  assert.match(edge, /requirePermission\(auth, cors, 'settings\.manage'\)/);
  assert.match(edge, /p_resource: 'ai_credits'/);
  assert.match(edge, /feature, model/);
  assert.match(migration, /'compliance_assistant'/);
});
