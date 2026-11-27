#!/usr/bin/env node
// Corre las pruebas CRÍTICAS del chat y la mensajería (permisos, aislamiento por clínica y sucursal, envíos,
// idempotencia, vinculación de pacientes, ventanas de WhatsApp) y FALLA si alguna se omite.
// En la suite normal una prueba se omite sola cuando falta Chromium o PGlite; aquí eso no es aceptable:
// una prueba de seguridad omitida es una prueba que no protege nada.
//
//   Local:  SMYL_PGLITE_DIR=/ruta/con/node_modules node scripts/run-critical-tests.mjs
//   CI:     npm i --no-save @electric-sql/pglite playwright && npx playwright install chromium && node scripts/run-critical-tests.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');

// Patrones de nombre de archivo. Agregar aquí toda prueba nueva de permisos, aislamiento o envío del chat.
export const CRITICAL = [
  /^lana-inbox-/, /^lana-stage[367]-/, /^smyl-chat-/, /^smyl-inbox-thread-assignment/, /^smyl-inbox-message-actions-browser/,
  /^smyl-branch-scope/, /^chat-por-sucursal/, /^chat-finance-scopes/, /^privacidad-chat/, /^appointment-negotiation/,
  /^smyl-confirmation-messages/, /^vincular-paciente-chat/, /^smyl-lana-/, /^inbox-confirmacion-completa/, /^lista-espera/,
  /^cobros-chat-link/, /^smyl-inbox-ficha360-v4/
];

export function criticalFiles(dir = testsDir) {
  return fs.readdirSync(dir).filter((name) => /\.test\.mjs$/.test(name) && CRITICAL.some((rule) => rule.test(name))).sort().map((name) => path.join('tests', name));
}

export function summarize(tap) {
  const read = (label) => Number((tap.match(new RegExp(`^# ${label} (\\d+)`, 'm')) || [])[1] || 0);
  const failed = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const skipped = [...tap.matchAll(/^\s*ok \d+ - (.+?) # SKIP\b.*$/gm)].map((m) => m[1]);
  return { tests: read('tests'), pass: read('pass'), fail: read('fail'), skipped: read('skipped'), failed, skippedNames: skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = criticalFiles();
  if (!files.length) { console.error('No se encontraron pruebas críticas.'); process.exit(2); }
  console.log(`Pruebas críticas: ${files.length} archivos.`);
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, SMYL_REQUIRE_PGLITE: '1' }
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  const result = summarize(output);
  console.log(`tests ${result.tests} · aprobadas ${result.pass} · fallidas ${result.fail} · omitidas ${result.skipped}`);
  let bad = false;
  if (result.fail || run.status) { bad = true; console.error('\nFALLAN pruebas críticas:\n- ' + (result.failed.join('\n- ') || '(ver salida)')); }
  if (result.skipped) { bad = true; console.error(`\nSe OMITIERON ${result.skipped} pruebas críticas (falta Chromium o PGlite). Una prueba de seguridad omitida no protege nada:\n- ` + (result.skippedNames.join('\n- ') || '(ver salida)')); }
  if (!result.tests) { bad = true; console.error('\nNo se ejecutó ninguna prueba.'); }
  if (bad) { if (process.env.SMYL_SHOW_OUTPUT === '1') console.error(output); process.exit(1); }
  console.log('Todas las pruebas críticas se ejecutaron y pasaron.');
}
