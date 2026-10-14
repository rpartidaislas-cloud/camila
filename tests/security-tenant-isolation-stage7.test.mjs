import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts/two-tenant-isolation.mjs'), 'utf8');

test('el arnés rechaza producción y exige confirmación explícita', () => {
  assert.match(source, /PRODUCTION_PROJECT_REF\s*=\s*'rpxshsiwoxdbuevjjpfw'/);
  assert.match(source, /DISPOSABLE_TWO_TENANT_PROJECT/);
  assert.match(source, /baseUrl\.includes\(PRODUCTION_PROJECT_REF\)/);
});

test('las credenciales sólo se leen del entorno y nunca se imprimen', () => {
  assert.match(source, /SMYL_ISOLATION_USER_A_PASSWORD/);
  assert.match(source, /SMYL_ISOLATION_USER_B_PASSWORD/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:password|token|email)/i);
  assert.match(source, /project_fingerprint/);
});

test('cubre lectura, escritura, tenant falsificado y RPC clínica', () => {
  assert.match(source, /expectHidden\('camila_pacientes'/);
  assert.match(source, /expectCrossUpdateBlocked\('camila_pacientes'/);
  assert.match(source, /expectForeignInsertBlocked\('camila_pacientes'/);
  assert.match(source, /smyl_save_clinical_plan_v2/);
  assert.match(source, /smyl_inventory_items/);
});

test('Realtime exige control positivo antes de afirmar aislamiento', () => {
  assert.match(source, /evento propio de control/);
  assert.match(source, /if \(ownRealtime\.status === 'PASS'\)/);
  assert.match(source, /Sin control positivo no se afirma aislamiento Realtime/);
});

test('Storage no se aprueba sin un objeto limpio de control', () => {
  assert.match(source, /SMYL_ISOLATION_CLEAN_OBJECT_B/);
  assert.match(source, /Falta una ruta limpia sintética/);
  assert.match(source, /own\.ok && !foreign\.ok/);
});
