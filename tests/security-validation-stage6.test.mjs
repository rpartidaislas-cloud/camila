import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runSecurityReleaseGate } from '../scripts/security-release-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('la puerta automática de seguridad queda en verde', () => {
  const result = runSecurityReleaseGate();
  assert.equal(result.ok, true, result.checks.filter((item) => !item.pass).map((item) => item.name).join(', '));
  assert.ok(result.checks.length >= 7);
});

test('la corrección de inventario elimina la columna ambigua', () => {
  const sql = read('supabase/migrations/20261014180000_smyl_security_validation_fixes.sql');
  assert.match(sql, /select c\.loc,c\.item_id,c\.lot_id,sum\(c\.qty\)/);
  assert.doesNotMatch(sql, /lot_balance as \(select loc,item_id,lot_id/);
});

test('el reporte diario usa aritmética temporal válida', () => {
  const sql = read('supabase/migrations/20261014180000_smyl_security_validation_fixes.sql');
  assert.match(sql, /d\.day\+interval '1 day'/);
  assert.doesNotMatch(sql, /\(d\.day\+1\)::timestamptz/);
});

test('la huella de exportación resuelve pgcrypto sin ampliar search_path', () => {
  const sql = read('supabase/migrations/20261014180000_smyl_security_validation_fixes.sql');
  assert.match(sql, /set search_path=pg_catalog,public/);
  assert.match(sql, /extensions\.digest\(convert_to/);
});

test('la matriz y la puerta de lanzamiento no afirman un pentest inexistente', () => {
  const gate = read('docs/SMYL_SECURITY_RELEASE_GATE.md');
  const matrix = read('docs/SMYL_SECURITY_ABUSE_MATRIX.md');
  assert.match(gate, /NO AUTORIZADO/i);
  assert.match(gate, /pentest externo/i);
  assert.match(matrix, /entre clínicas/i);
  assert.match(matrix, /IDOR/i);
});
