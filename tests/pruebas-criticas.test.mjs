import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { criticalFiles, summarize, CRITICAL } from '../scripts/run-critical-tests.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('la lista crítica cubre permisos, aislamiento, sucursales, envíos y vínculos del chat', () => {
  const files = criticalFiles().map((f) => f.replace(/^tests\//, ''));
  for (const expected of [
    'smyl-chat-access-pglite.test.mjs', 'smyl-chat-appointment-pipeline-pglite.test.mjs', 'smyl-inbox-thread-assignment.test.mjs',
    'smyl-branch-scope.test.mjs', 'vincular-paciente-chat-sin-salir.test.mjs', 'privacidad-chat-arco.test.mjs'
  ]) assert.ok(files.includes(expected), `${expected} debe ser crítica`);
  assert.ok(files.length >= 25, 'no se debe encoger sin querer');
  assert.ok(CRITICAL.every((rule) => files.some((f) => rule.test(f))), 'cada patrón debe encontrar al menos un archivo (sin patrones muertos)');
});

test('el resumen cuenta fallas y omisiones del reporte TAP', () => {
  const tap = ['ok 1 - a', 'not ok 2 - b falla', 'ok 3 - c # SKIP Se necesita Chromium.', '    ok 4 - d # SKIP', '# tests 4', '# pass 1', '# fail 1', '# skipped 2'].join('\n');
  const out = summarize(tap);
  assert.deepEqual({ tests: out.tests, pass: out.pass, fail: out.fail, skipped: out.skipped }, { tests: 4, pass: 1, fail: 1, skipped: 2 });
  assert.deepEqual(out.failed, ['b falla']);
  assert.ok(out.skippedNames.includes('c') && out.skippedNames.includes('d'));
});

test('la integración continua corre las críticas con PGlite y Chromium, sin permitir omisiones ni fallar en silencio', () => {
  const workflow = read('.github/workflows/pruebas.yml');
  const job = workflow.slice(workflow.indexOf('  criticas:'), workflow.indexOf('  # Prueba del editor REAL'));
  assert.match(job, /@electric-sql\/pglite/);
  assert.match(job, /playwright install --with-deps chromium/);
  assert.match(job, /node scripts\/run-critical-tests\.mjs/);
  assert.doesNotMatch(job, /continue-on-error/, 'es obligatoria: no puede fallar en silencio');
  const script = read('scripts/run-critical-tests.mjs');
  assert.match(script, /SMYL_REQUIRE_PGLITE: '1'/);
  assert.match(script, /result\.skipped/);
  assert.match(script, /process\.exit\(1\)/);
});
