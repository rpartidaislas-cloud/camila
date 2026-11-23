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
test('migración y cableado de la pantalla', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261126200000_smyl_compliance.sql', import.meta.url), 'utf8');
  for (const f of ['smyl_log_sterilization', 'smyl_log_rpbi', 'smyl_set_compliance_item', 'smyl_compliance_overview']) assert.match(sql, new RegExp(f));
  assert.match(sql, /enable row level security/i);
  const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(app, /smyl-compliance-model\.js\?v=1/);
  assert.match(app, /smyl-compliance\.js\?v=1/);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /cumplimiento-carpeta-v1/);
  assert.match(fs.readFileSync(new URL('../smyl-navigation.js', import.meta.url), 'utf8'), /'cumplimiento'/);
  for (const f of ['smyl-compliance.js', 'smyl-compliance-model.js', 'smyl-compliance.css', 'sw.js', 'app.html'])
    assert.equal(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), fs.readFileSync(new URL('../mobile/www/' + f, import.meta.url), 'utf8'), f);
});
