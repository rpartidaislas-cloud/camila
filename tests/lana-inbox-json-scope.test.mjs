import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/lana-inbox/index.ts'), 'utf8');

// Regresión 2026-11-16: desde el 2026-10-21 `json` solo existía dentro de Deno.serve y 14 funciones auxiliares
// (vincular paciente, contexto clínico, agenda, revisión de fotos…) fallaban con ReferenceError → 500 genérico.
test('las funciones auxiliares de lana-inbox tienen un json() de módulo', () => {
  const moduleJson = source.indexOf('\nfunction json(status: number, body: Record<string, unknown>): Response {');
  assert.ok(moduleJson > 0, 'falta json() a nivel de módulo');
  const firstHelperUse = source.indexOf('json(', source.indexOf('\nasync function '));
  assert.ok(moduleJson < firstHelperUse, 'json() de módulo debe declararse antes de las funciones que lo usan');
});

test('Deno.serve agrega CORS a toda respuesta que no lo traiga', () => {
  assert.match(source, /async function handleInbox\(req: Request\): Promise<Response> \{\n  const CORS = inboxCors\(req\);/);
  const serve = source.slice(source.indexOf('Deno.serve('));
  assert.match(serve, /const response = await handleInbox\(req\);/);
  assert.match(serve, /Object\.entries\(inboxCors\(req\)\)\.filter\(\(\[name\]\) => !response\.headers\.has\(name\)\)/);
  assert.equal((source.match(/Deno\.serve\(/g) || []).length, 1);
});

test('el paquete para el panel de Supabase está al día con la corrección', () => {
  const bundle = fs.readFileSync(path.join(root, 'docs/bundles/lana-inbox.single-file.ts'), 'utf8');
  assert.match(bundle, /async function handleInbox\(req: Request\)/);
  assert.match(bundle, /\nfunction json\(status: number, body: Record<string, unknown>\): Response \{/);
});
